// ============================================================
// courseWeeksRepository —— course_weeks 周次子表的数据访问层（Day 19 从 index.js 迁出）
// 职责：批量写周次行。
// 查询侧不需要单独查这张表：读课程时由网关按外键嵌套带出
// （见 coursesRepository.fetchCourses 的 select=*,course_weeks(week)）
// ============================================================
const { rdbRequest } = require('./rdbClient');

// 批量插入周次行 [{course_id, week}]，一次 POST 全部
async function insertWeeks(weekRows) {
  await rdbRequest('course_weeks', {
    method: 'POST',
    body: weekRows,
    errorPrefix: '写入 course_weeks 失败',
  });
}

module.exports = { insertWeeks };
