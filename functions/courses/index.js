// ============================================================
// 课程接口（Day 17 GET 读 + Day 18 POST 导入写，契约 api-contract.md 3.2 / 3.3）
// 数据来源：CloudBase PostgreSQL courses + course_weeks 两表（Day 16 建）
// 访问方式：PG HTTP 网关（PostgREST 语法），走平台内部链路
//   —— 免费体验版共享集群无内网/外网直连地址（Day 17 实测：配置页内网地址为"-"、
//      外网 IPv4 关闭），pg 协议直连不可行，故改走 HTTP 网关（官方兜底路径）
// 响应统一 { ok, data, error } 包络（契约 2.1）
// Day 18 导入：整体替换 + 整批校验，替换分三步（删旧→插主表→插子表），
//   中途失败会记日志并如实返回，见 handleImport 内注释
// ============================================================
const http = require('http');

// 监听端口必须与控制台「函数配置 → 监听端口」一致（Day 15 实测：不一致网关 65 秒超时返回 450）
const PORT = 9000;

// 环境 ID 不是秘密（公网 URL 里可见），可直接写；API Key 是服务端密钥，必须走环境变量
const ENV_ID = 'wg-kechengbiao-d9gi92b9ma9e7f71c';
const RDB_BASE = process.env.RDB_BASE_URL || `https://${ENV_ID}.api.tcloudbasegateway.com`;
const API_KEY = process.env.RDB_API_KEY;

if (!API_KEY) {
  console.error('[courses] 缺少环境变量 RDB_API_KEY，所有请求将返回 SERVER_ERROR');
}

// limit 查询参数上限（余力加练，契约 3.2）
const LIMIT_MAX = 500;

// ---------- 响应工具（统一包络，契约 2.1） ----------

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    // 前端部署在 tcloudbaseapp.com，与函数域名不同源，为 Day 18 前端接线预留 CORS
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

function ok(res, data) {
  send(res, 200, { ok: true, data });
}

function fail(res, status, code, message) {
  send(res, status, { ok: false, error: { code, message } });
}

// ---------- 数据层：PG HTTP 网关查询 ----------

// PostgREST 语法：
//   select=*,course_weeks(week)        —— 按外键 course_weeks.course_id → courses.id 嵌套带出周次
//   order=weekday.asc,periods.asc,...  —— 与原 SQL 的 ORDER BY 一致
//   limit=N                            —— 参数化分页（URL 参数，无字符串拼接进查询体）
async function fetchCourses(limit) {
  const params = new URLSearchParams();
  params.set('select', '*,course_weeks(week)');
  params.set('order', 'weekday.asc,periods.asc,name.asc');
  if (limit) params.set('limit', String(limit));

  const url = `${RDB_BASE}/v1/rdb/rest/courses?${params.toString()}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`RDB 网关 ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// 网关行 → 契约 2.3 课程对象：snake_case 列名映射回 camelCase（契约 2.4 要点 2），
// 嵌套的 course_weeks 数组拍平成 weeks
function toCourse(row) {
  const weeks = (row.course_weeks || []).map((w) => w.week).sort((a, b) => a - b);
  return {
    id: row.id,
    name: row.name,
    weekday: row.weekday,
    periods: row.periods,
    location: row.location,
    teacher: row.teacher,
    className: row.class_name,
    scheduleDate: row.schedule_date,
    courseOrder: row.course_order,
    type: row.type,
    weeks,
  };
}

// ---------- 业务逻辑 ----------

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
  if (!API_KEY) {
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

// ---------- 写入：PG HTTP 网关（PostgREST 语法） ----------

// 删除全部旧课程。外键 course_weeks.course_id ON DELETE CASCADE（Day 16 建表），
// 删 courses 一张表即级联清空 course_weeks。
// 加恒真过滤 id=not.is.null：显式表明意图，也防网关/PostgREST 拒绝无过滤的全表 DELETE
async function deleteAllCourses() {
  const url = `${RDB_BASE}/v1/rdb/rest/courses?id=not.is.null`;
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${API_KEY}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`删除旧数据失败 RDB 网关 ${resp.status}: ${text.slice(0, 200)}`);
  }
}

// 契约对象 → 数据库行（snake_case，契约 2.4 要点 2 的反向映射）。
// course_weeks 以嵌套数组随行携带，由 insertCourses 拆出后单独批量插入
// （嵌套插入实测不被网关支持，Day 18 PGRST204）
function toDbRow(course) {
  return {
    id: course.id,
    name: course.name,
    weekday: course.weekday,
    periods: course.periods,
    location: course.location ?? '',
    teacher: course.teacher ?? '',
    class_name: course.className ?? '',
    schedule_date: course.scheduleDate ?? '',
    course_order: course.courseOrder ?? '',
    type: course.type ?? '',
    course_weeks: course.weeks.map((week) => ({ week })),
  };
}

async function insertCourses(dbRows) {
  // 分两步插入（Day 18 实测：嵌套插入不被网关支持，PGRST204 把嵌套键当列名找）。
  // 先父表后子表，满足外键约束；weekRows 一次批量 POST 全部周次行
  const courseRows = dbRows.map(({ course_weeks, ...row }) => row);
  await postRows('courses', courseRows);
  const weekRows = dbRows.flatMap((row) =>
    row.course_weeks.map((w) => ({ course_id: row.id, week: w.week }))
  );
  if (weekRows.length > 0) {
    await postRows('course_weeks', weekRows);
  }
}

async function postRows(table, rows) {
  const url = `${RDB_BASE}/v1/rdb/rest/${table}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`写入 ${table} 失败 RDB 网关 ${resp.status}: ${text.slice(0, 200)}`);
  }
}

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

  if (!API_KEY) {
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

  fail(res, 404, 'NOT_FOUND', `未知路径: ${path}`);
});

server.listen(PORT, () => {
  console.log(`[courses] listening on port ${PORT}`);
});
