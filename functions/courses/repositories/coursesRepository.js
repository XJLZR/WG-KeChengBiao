// ============================================================
// coursesRepository —— courses 主表的数据访问层（Day 19 从 index.js 迁出）
// 职责：查课程、删课程、写课程主表，以及数据库行 ↔ 契约对象的字段映射。
// 只跟网关/数据库打交道，不做 HTTP 响应、不做请求校验（那些留在接口层）。
// Day 25 课表口令：全部查询/写入都带 code 条件——读按口令过滤，
// 写入的 id 由服务端加口令前缀（同班同学同文件 id 相同，防全局主键相撞）。
// ============================================================
const { rdbRequest } = require('./rdbClient');
const { insertWeeks } = require('./courseWeeksRepository');

// 查课程（限定口令）。PostgREST 语法：
//   select=*,course_weeks(week)        —— 按外键 course_weeks.course_id → courses.id 嵌套带出周次
//   code=eq.XXX                        —— 只返回该口令名下的课程（Day 25）
//   order=weekday.asc,periods.asc,...  —— 与原 SQL 的 ORDER BY 一致
//   limit=N                            —— 参数化分页（URL 参数，无字符串拼接进查询体）
async function fetchCourses(limit, code) {
  const query = {
    select: '*,course_weeks(week)',
    code: `eq.${code}`,
    order: 'weekday.asc,periods.asc,name.asc',
  };
  if (limit) query.limit = String(limit);

  return rdbRequest('courses', { method: 'GET', query });
}

// 按 id 查单条课程（限定口令；Day 22 PATCH 用：改前验存在性、改后读回完整对象）。
// id + code 双条件：其他口令名下即使存在同内容课程也查不到。
// 查不到返回 null，由接口层转成 NOT_FOUND
async function fetchCourseById(id, code) {
  const rows = await rdbRequest('courses', {
    method: 'GET',
    query: { select: '*,course_weeks(week)', id: `eq.${id}`, code: `eq.${code}` },
  });
  return rows.length > 0 ? rows[0] : null;
}

// 按 id 部分更新主表字段（限定口令；Day 22 PATCH，契约 3.4）。
// patch 是数据库行形状的子集（调用方已完成白名单校验和 camelCase→snake_case 映射）。
// 返回值不解析（网关对 PATCH 成功回空体，同 DELETE/POST），改后的数据由调用方重新 GET 读回
async function patchCourse(id, code, patch) {
  await rdbRequest('courses', {
    method: 'PATCH',
    query: { id: `eq.${id}`, code: `eq.${code}` },
    body: patch,
    errorPrefix: '更新课程失败',
  });
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

// 契约对象 → 数据库行（snake_case，契约 2.4 要点 2 的反向映射）。
// Day 25：id 加口令前缀（CODE-原id）+ code 列——两处都由服务端统一处理，
// 前端提交的原始 id 保持不变（同口令重复导入 id 稳定）。
// course_weeks 以嵌套数组随行携带，由 insertCourses 拆出后单独批量插入
// （嵌套插入实测不被网关支持，Day 18 PGRST204）
function toDbRow(course, code) {
  return {
    id: `${code}-${course.id}`,
    code,
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

// 按 id 删除单条课程（限定口令；Day 22 DELETE，契约 3.5）。
// 子表 course_weeks 靠外键 ON DELETE CASCADE（Day 16 建表）自动级联删除，无需单独删。
// 是否真删了由接口层先验存在性再调用本函数保证（网关对删 0 行也回 200，无法靠返回值区分）
async function deleteCourseById(id, code) {
  await rdbRequest('courses', {
    method: 'DELETE',
    query: { id: `eq.${id}`, code: `eq.${code}` },
    errorPrefix: '删除课程失败',
  });
}

// 删除某口令名下的全部旧课程（Day 25：从「删全库」收窄到「删该口令」，
// 导入整体替换的新范围，契约 2.5）。外键 course_weeks.course_id ON DELETE CASCADE
// （Day 16 建表）自动级联清空该口令的周次明细，其他口令的数据不动。
async function deleteCoursesByCode(code) {
  await rdbRequest('courses', {
    method: 'DELETE',
    query: { code: `eq.${code}` },
    errorPrefix: '删除旧数据失败',
  });
}

// 写入一批课程。分两步插入（Day 18 实测：嵌套插入不被网关支持，PGRST204 把嵌套键当列名找）。
// 先父表后子表，满足外键约束；写子表走 courseWeeksRepository
async function insertCourses(dbRows) {
  const courseRows = dbRows.map(({ course_weeks, ...row }) => row);
  await rdbRequest('courses', {
    method: 'POST',
    body: courseRows,
    errorPrefix: '写入 courses 失败',
  });

  const weekRows = dbRows.flatMap((row) =>
    row.course_weeks.map((w) => ({ course_id: row.id, week: w.week }))
  );
  if (weekRows.length > 0) {
    await insertWeeks(weekRows);
  }
}

module.exports = { fetchCourses, fetchCourseById, patchCourse, deleteCourseById, toCourse, toDbRow, deleteCoursesByCode, insertCourses };
