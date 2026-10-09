// ============================================================
// 课程接口（Day 17 GET 读 + Day 18 POST 导入写 + Day 22 PATCH 改，契约 3.2/3.3/3.4）
// Day 19 分层重构：本文件只保留「接口层」职责——接请求（读参数/请求体、校验）、
// 调数据访问层函数、返响应（统一 { ok, data, error } 包络，契约 2.1）。
// 所有数据库操作已迁至 repositories/（本文件不再出现网关 URL 和 fetch）：
//   rdbClient.js              网关低层：URL/鉴权头/超时/错误包装
//   coursesRepository.js      courses 主表查/删/写 + 数据库行↔契约对象映射
//   courseWeeksRepository.js  course_weeks 子表批量写
// 数据来源：CloudBase PostgreSQL courses + course_weeks 两表（Day 16 建），
// 经 PG HTTP 网关（PostgREST 语法）访问——免费版无直连地址，详见 rdbClient.js 注释
// Day 18 导入：整体替换 + 整批校验，替换分三步（删旧→插主表→插子表），
//   中途失败会记日志并如实返回，见 handleImport 内注释
// ============================================================
const http = require('http');
const { hasApiKey } = require('./repositories/rdbClient');
const {
  fetchCourses,
  fetchCourseById,
  patchCourse,
  deleteCourseById,
  toCourse,
  toDbRow,
  deleteAllCourses,
  insertCourses,
} = require('./repositories/coursesRepository');
const { insertWeeks, deleteWeeksByCourseId } = require('./repositories/courseWeeksRepository');

// 监听端口必须与控制台「函数配置 → 监听端口」一致（Day 15 实测：不一致网关 65 秒超时返回 450）
const PORT = 9000;

// limit 查询参数上限（余力加练，契约 3.2）
const LIMIT_MAX = 500;

// ---------- 响应工具（统一包络，契约 2.1） ----------

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    // CORS 交给网关侧「跨域设置」统一回显（Day 20 拍板方案 A）。
    // 此前函数自带的 ACAO:* 会与网关回显叠加成 "<Origin>,*"——
    // 该值不符合 CORS 规范（这个头不允许逗号列表），浏览器直接拒收，
    // courses/import 两条路由因此全被拦（health 函数没写过 CORS 头，一直正常）。
    // 网关侧实测（Day 20）：白名单来源回显精确单值、陌生来源不给 ACAO 头、
    // OPTIONS 预检由网关应答（204 + allow-methods/headers 按请求回显）。
  });
  res.end(JSON.stringify(body));
}

function ok(res, data) {
  send(res, 200, { ok: true, data });
}

function fail(res, status, code, message) {
  send(res, status, { ok: false, error: { code, message } });
}

// ---------- 业务逻辑 ----------
// （原「数据层：PG HTTP 网关查询」一段——fetchCourses/toCourse——已迁至
//   repositories/coursesRepository.js，Day 19）

// 解析 limit 查询参数（Day 17 余力加练，契约 3.2）
// 合法：正整数 1–LIMIT_MAX；不传 = 返回全部；非法返回 null 由调用方按 BAD_REQUEST 拒绝
function parseLimit(searchParams) {
  const raw = searchParams.get('limit');
  if (raw === null) return { limit: null };
  if (!/^\d+$/.test(raw)) return { limit: null, invalid: true };
  const n = Number(raw);
  if (n < 1 || n > LIMIT_MAX) return { limit: null, invalid: true };
  return { limit: n };
}

async function handleCourses(res, searchParams) {
  const { limit, invalid } = parseLimit(searchParams);
  if (invalid) {
    fail(res, 400, 'BAD_REQUEST', `limit 必须是 1-${LIMIT_MAX} 的整数`);
    return;
  }
  if (!hasApiKey()) {
    fail(res, 500, 'SERVER_ERROR', '服务端未配置数据库凭据（RDB_API_KEY）');
    return;
  }

  const rows = await fetchCourses(limit);
  const courses = rows.map(toCourse);
  ok(res, { courses, count: courses.length });
}

// ============================================================
// Day 18：POST /api/courses/import —— 导入课表（整体替换，契约 3.3）
// ============================================================

// 规模上限（契约 3.3）
const IMPORT_MAX_COURSES = 500;
const BODY_MAX_BYTES = 512 * 1024; // 512KB

// ---------- 请求体读取 ----------

// 流式收集请求体，超过上限立刻掐断，防止恶意大包撑爆内存
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_MAX_BYTES) {
        const err = new Error('请求体超过 512KB 上限');
        err.statusCode = 400;
        err.code = 'BAD_REQUEST';
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- 校验（错误信息全中文，指明第几条、缺什么） ----------

// 字段定义表：契约 2.3 必填字段 + 可选字段的长度上限（与数据库列宽一致，提前拦截避免数据库报错）
const REQUIRED_FIELDS = {
  id: { max: 128, label: 'id' },
  name: { max: 64, label: '课程名 name' },
};
const REQUIRED_NUMBERS = {
  weekday: { min: 1, max: 7, label: '星期 weekday' },
};
const OPTIONAL_STRINGS = {
  location: 64,
  teacher: 64,
  className: 64,
  scheduleDate: 32,
  courseOrder: 32,
  type: 32,
};

// 校验单条课程，不合法返回中文错误信息字符串，合法返回 null
function validateCourseItem(item, index) {
  const nth = `第 ${index + 1} 条课程`;
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return `${nth}必须是对象`;
  }
  for (const [field, { max, label }] of Object.entries(REQUIRED_FIELDS)) {
    const value = item[field];
    if (typeof value !== 'string' || value.trim() === '') {
      return `${nth}缺少必填字段 ${field}（${label}）`;
    }
    if (value.length > max) {
      return `${nth}的 ${field} 超过 ${max} 字上限`;
    }
  }
  for (const [field, { min, max, label }] of Object.entries(REQUIRED_NUMBERS)) {
    const value = item[field];
    if (!Number.isInteger(value) || value < min || value > max) {
      return `${nth}的 ${field}（${label}）必须是 ${min}-${max} 的整数`;
    }
  }
  // periods：非空数组，每个是正整数
  if (!Array.isArray(item.periods) || item.periods.length === 0) {
    return `${nth}缺少必填字段 periods（节次，非空数组）`;
  }
  if (!item.periods.every((p) => Number.isInteger(p) && p >= 1)) {
    return `${nth}的 periods 必须是正整数数组，如 [6,7]`;
  }
  // weeks：非空数组，每个是 1-30 整数（与 course_weeks 表 CHECK 约束一致）
  if (!Array.isArray(item.weeks) || item.weeks.length === 0) {
    return `${nth}缺少必填字段 weeks（周次，非空数组）`;
  }
  if (!item.weeks.every((w) => Number.isInteger(w) && w >= 1 && w <= 30)) {
    return `${nth}的 weeks 必须是 1-30 的整数数组`;
  }
  // 可选字段：出现则必须是字符串且不超长
  for (const [field, max] of Object.entries(OPTIONAL_STRINGS)) {
    const value = item[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      return `${nth}的 ${field} 必须是字符串`;
    }
    if (value.length > max) {
      return `${nth}的 ${field} 超过 ${max} 字上限`;
    }
  }
  return null;
}

// 整批校验：契约 3.3 要求「任一条不合法则整批拒绝」，所以只返回第一条错误即可
// 防重复（Day 18 拍板）：同批重复 id 整批拒绝
function validateImportBody(courses) {
  if (!Array.isArray(courses)) {
    return 'courses 必须是数组';
  }
  if (courses.length === 0) {
    return 'courses 不能为空数组（防止误清空全部课程）';
  }
  if (courses.length > IMPORT_MAX_COURSES) {
    return `courses 超过单批 ${IMPORT_MAX_COURSES} 条上限（当前 ${courses.length} 条）`;
  }
  const seenIds = new Map(); // id -> 首次出现的下标，重复时能报出两条的位置
  for (let i = 0; i < courses.length; i++) {
    const err = validateCourseItem(courses[i], i);
    if (err) return err;
    const id = courses[i].id;
    if (seenIds.has(id)) {
      return `同一批内课程 id 重复: ${id}（第 ${seenIds.get(id) + 1} 条与第 ${i + 1} 条重复），请去重后重新提交`;
    }
    seenIds.set(id, i);
  }
  return null;
}

// ---------- 写入：数据库操作已迁至 repositories/coursesRepository.js（Day 19） ----------

// ---------- 导入处理主流程 ----------

async function handleImport(req, res) {
  const raw = await readBody(req);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(res, 400, 'BAD_REQUEST', '请求体不是合法的 JSON');
    return;
  }
  const courses = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed.courses
    : undefined;
  if (courses === undefined) {
    fail(res, 400, 'BAD_REQUEST', '请求体缺少 courses 字段');
    return;
  }

  const invalidReason = validateImportBody(courses);
  if (invalidReason) {
    console.log(`[import] 校验拒绝: ${invalidReason}`);
    fail(res, 400, 'BAD_REQUEST', invalidReason);
    return;
  }
  console.log(`[import] 收到导入请求: ${courses.length} 条，校验通过`);

  if (!hasApiKey()) {
    fail(res, 500, 'SERVER_ERROR', '服务端未配置数据库凭据（RDB_API_KEY）');
    return;
  }

  // 已知风险（计划里向主人说明过）：两步不是数据库事务，中间失败会写一半。
  // 缓解：校验已全部前置通过，此处只剩网关故障级别的意外；失败时如实告知进度
  try {
    await deleteAllCourses();
    console.log('[import] 旧课程已删除（course_weeks 级联清空）');
  } catch (err) {
    console.error(`[import] 失败于删除阶段: ${err.message}`);
    fail(res, 500, 'SERVER_ERROR', `数据替换失败（旧数据未动）: ${err.message}`);
    return;
  }

  try {
    const dbRows = courses.map(toDbRow);
    await insertCourses(dbRows);
    console.log(`[import] 写入完成: ${dbRows.length} 条课程`);
    ok(res, { imported: dbRows.length });
  } catch (err) {
    console.error(`[import] 失败于写入阶段: ${err.message}`);
    fail(res, 500, 'SERVER_ERROR', `旧课程已清空但新课程写入失败，请重新导入: ${err.message}`);
  }
}

// ============================================================
// Day 22：PATCH /api/courses/:id —— 修改课程（部分更新，契约 3.4）
// ============================================================

// 可修改字段白名单（契约 3.4）：除 id 外的全部字段。
// 字符串字段带长度上限（与导入校验一致，防超长打穿数据库列宽）
const PATCHABLE_STRINGS = {
  name: 64,
  location: 64,
  teacher: 64,
  className: 64,
  scheduleDate: 32,
  courseOrder: 32,
  type: 32,
};
const PATCHABLE_HINT = 'name, weekday, periods, location, teacher, weeks, className, scheduleDate, courseOrder, type';

// 校验 PATCH 请求体：必须是对象、至少一个字段、字段都在白名单内、类型合法。
// 不合法返回中文错误信息，合法返回 null
function validatePatchBody(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return '请求体必须是 JSON 对象，如 { "location": "教A-105" }';
  }
  const keys = Object.keys(body);
  if (keys.length === 0) {
    return '请求体不能为空，至少传一个要修改的字段';
  }
  for (const key of keys) {
    if (key === 'id') {
      return 'id 不可修改（id 是课程标识，改动会使外部引用失效）';
    }
    if (key in PATCHABLE_STRINGS) {
      const value = body[key];
      if (typeof value !== 'string') {
        return `字段 ${key} 必须是字符串`;
      }
      if (value.length > PATCHABLE_STRINGS[key]) {
        return `字段 ${key} 超过 ${PATCHABLE_STRINGS[key]} 字上限`;
      }
    } else if (key === 'weekday') {
      if (!Number.isInteger(body[key]) || body[key] < 1 || body[key] > 7) {
        return '字段 weekday（星期）必须是 1-7 的整数';
      }
    } else if (key === 'periods') {
      const value = body[key];
      if (!Array.isArray(value) || value.length === 0) {
        return '字段 periods（节次）必须是非空数组';
      }
      if (!value.every((p) => Number.isInteger(p) && p >= 1)) {
        return '字段 periods 必须是正整数数组，如 [6,7]';
      }
    } else if (key === 'weeks') {
      const value = body[key];
      if (!Array.isArray(value) || value.length === 0) {
        return '字段 weeks（周次）必须是非空数组';
      }
      if (!value.every((w) => Number.isInteger(w) && w >= 1 && w <= 30)) {
        return '字段 weeks 必须是 1-30 的整数数组';
      }
    } else {
      return `不支持修改字段 ${key}（可修改: ${PATCHABLE_HINT}）`;
    }
  }
  return null;
}

// 请求体（契约 camelCase）→ 数据库行形状（snake_case）的子集。
// weeks 不进主表：它拆存在 course_weeks 子表，由 handlePatch 走「删旧插新」
function toDbPatch(body) {
  const row = {};
  if (body.name !== undefined) row.name = body.name;
  if (body.weekday !== undefined) row.weekday = body.weekday;
  if (body.periods !== undefined) row.periods = body.periods;
  if (body.location !== undefined) row.location = body.location;
  if (body.teacher !== undefined) row.teacher = body.teacher;
  if (body.className !== undefined) row.class_name = body.className;
  if (body.scheduleDate !== undefined) row.schedule_date = body.scheduleDate;
  if (body.courseOrder !== undefined) row.course_order = body.courseOrder;
  if (body.type !== undefined) row.type = body.type;
  return row;
}

async function handlePatch(req, res, id) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    fail(res, 400, 'BAD_REQUEST', '请求体不是合法的 JSON');
    return;
  }

  const invalidReason = validatePatchBody(body);
  if (invalidReason) {
    console.log(`[patch ${id}] 校验拒绝: ${invalidReason}`);
    fail(res, 400, 'BAD_REQUEST', invalidReason);
    return;
  }

  if (!hasApiKey()) {
    fail(res, 500, 'SERVER_ERROR', '服务端未配置数据库凭据（RDB_API_KEY）');
    return;
  }

  // 先验 id 存在性（契约 3.4：不存在的 id 返回 NOT_FOUND）
  const existing = await fetchCourseById(id);
  if (!existing) {
    fail(res, 404, 'NOT_FOUND', `课程不存在: ${id}，请确认 id 是否正确`);
    return;
  }

  // 主表字段与 weeks 分开处理：
  //   主表 → 一条 PATCH；weeks → 子表删旧插新（嵌套更新网关不支持，同 Day 18 拆步）
  const mainFields = toDbPatch(body);
  try {
    if (Object.keys(mainFields).length > 0) {
      await patchCourse(id, mainFields);
    }
    if (body.weeks !== undefined) {
      await deleteWeeksByCourseId(id);
      const weekRows = body.weeks.map((week) => ({ course_id: id, week }));
      await insertWeeks(weekRows);
    }
    console.log(`[patch ${id}] 更新完成: ${Object.keys(body).join(', ')}`);
  } catch (err) {
    console.error(`[patch ${id}] 更新失败: ${err.message}`);
    fail(res, 500, 'SERVER_ERROR', `课程修改失败: ${err.message}`);
    return;
  }

  // 读回完整对象返回（PATCH 本身网关回空体，取不到更新后的值）
  const updatedRow = await fetchCourseById(id);
  ok(res, { updated: toCourse(updatedRow) });
}

// ============================================================
// Day 22：DELETE /api/courses/:id —— 删除课程（契约 3.5）
// ============================================================

// 删除比修改危险（删错没有撤销键），所以同样先验 id 存在性，不存在的 id 返回 404。
// course_weeks 子表由外键级联删除，这里只删主表一行
async function handleDelete(res, id) {
  if (!hasApiKey()) {
    fail(res, 500, 'SERVER_ERROR', '服务端未配置数据库凭据（RDB_API_KEY）');
    return;
  }

  const existing = await fetchCourseById(id);
  if (!existing) {
    fail(res, 404, 'NOT_FOUND', `课程不存在: ${id}，请确认 id 是否正确`);
    return;
  }

  try {
    await deleteCourseById(id);
    console.log(`[delete ${id}] 删除完成（course_weeks 已级联删除）`);
  } catch (err) {
    console.error(`[delete ${id}] 删除失败: ${err.message}`);
    fail(res, 500, 'SERVER_ERROR', `课程删除失败: ${err.message}`);
    return;
  }

  ok(res, { deletedId: id });
}

// ---------- HTTP 路由 ----------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // 去掉尾部斜杠，/api/courses/ 与 /api/courses 等价
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    send(res, 204, null);
    return;
  }

  if (path === '/api/courses') {
    if (req.method !== 'GET') {
      fail(res, 405, 'METHOD_NOT_ALLOWED', '本接口只接受 GET 请求');
      return;
    }
    handleCourses(res, url.searchParams).catch((err) => {
      console.error('[courses] upstream error:', err.message);
      fail(res, 500, 'SERVER_ERROR', '数据库读取失败，请稍后重试');
    });
    return;
  }

  // Day 18：导入课表（契约 3.3）
  if (path === '/api/courses/import') {
    if (req.method !== 'POST') {
      fail(res, 405, 'METHOD_NOT_ALLOWED', '本接口只接受 POST 请求');
      return;
    }
    handleImport(req, res).catch((err) => {
      // readBody 超限时已带 400 语义，直接透传；其余按服务端异常兜底
      if (err.code === 'BAD_REQUEST' && err.statusCode === 400) {
        fail(res, 400, 'BAD_REQUEST', err.message);
        return;
      }
      console.error('[import] unexpected error:', err.message);
      fail(res, 500, 'SERVER_ERROR', '服务端异常，请稍后重试');
    });
    return;
  }

  // Day 22：/api/courses/:id —— PATCH 修改 / DELETE 删除（契约 3.4 / 3.5）。id 从路径段取，需 URL 解码
  const courseIdMatch = path.match(/^\/api\/courses\/([^/]+)$/);
  if (courseIdMatch) {
    const id = decodeURIComponent(courseIdMatch[1]);
    if (req.method === 'PATCH') {
      handlePatch(req, res, id).catch((err) => {
        if (err.code === 'BAD_REQUEST' && err.statusCode === 400) {
          fail(res, 400, 'BAD_REQUEST', err.message);
          return;
        }
        console.error('[patch] unexpected error:', err.message);
        fail(res, 500, 'SERVER_ERROR', '服务端异常，请稍后重试');
      });
      return;
    }
    if (req.method === 'DELETE') {
      handleDelete(res, id).catch((err) => {
        console.error('[delete] unexpected error:', err.message);
        fail(res, 500, 'SERVER_ERROR', '服务端异常，请稍后重试');
      });
      return;
    }
    fail(res, 405, 'METHOD_NOT_ALLOWED', '本路径只接受 PATCH 或 DELETE 请求');
    return;
  }

  fail(res, 404, 'NOT_FOUND', `未知路径: ${path}`);
});

server.listen(PORT, () => {
  console.log(`[courses] listening on port ${PORT}`);
});
