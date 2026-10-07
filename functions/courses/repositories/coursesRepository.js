// ============================================================
// coursesRepository —— courses 主表的数据访问层（Day 19 从 index.js 迁出）
// 职责：查课程、删全部课程、写课程主表，以及数据库行 ↔ 契约对象的字段映射。
// 只跟网关/数据库打交道，不做 HTTP 响应、不做请求校验（那些留在接口层）。
// ============================================================
const { rdbRequest } = require('./rdbClient');
const { insertWeeks } = require('./courseWeeksRepository');

// 查课程。PostgREST 语法：
//   select=*,course_weeks(week)        —— 按外键 course_weeks.course_id → courses.id 嵌套带出周次
//   order=weekday.asc,periods.asc,...  —— 与原 SQL 的 ORDER BY 一致
//   limit=N                            —— 参数化分页（URL 参数，无字符串拼接进查询体）
async function fetchCourses(limit) {
  const query = {
    select: '*,course_weeks(week)',
    order: 'weekday.asc,periods.asc,name.asc',
  };
  if (limit) query.limit = String(limit);

  return rdbRequest('courses', { method: 'GET', query });
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

// 删除全部旧课程。外键 course_weeks.course_id ON DELETE CASCADE（Day 16 建表），
// 删 courses 一张表即级联清空 course_weeks。
// 加恒真过滤 id=not.is.null：显式表明意图，也防网关/PostgREST 拒绝无过滤的全表 DELETE
async function deleteAllCourses() {
  await rdbRequest('courses?id=not.is.null', {
    method: 'DELETE',
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

module.exports = { fetchCourses, toCourse, toDbRow, deleteAllCourses, insertCourses };
