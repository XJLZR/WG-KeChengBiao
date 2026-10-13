// ============================================================
// settingsRepository —— settings 表的数据访问层（Day 26 新增，契约 2.6）
// 职责：按口令读设置、按口令 upsert 设置，数据库行 ↔ 契约对象映射。
// 与 coursesRepository 同一分工：只跟网关打交道，不做 HTTP 响应与校验。
// 设置独立于课程存在：口令名下没课也能存设置，清课不动设置。
// ============================================================
const { rdbRequest } = require('./rdbClient');

// 数据库行 → 契约对象（2.6：camelCase）。
// period_times 在 PG HTTP 网关返回的 JSON 里已是数组，直接透传
function toSettings(row) {
  return {
    semesterStart: row.semester_start,
    periodTimes: row.period_times,
  };
}

// 按口令查设置。没存过返回 null（由接口层转成 settings: null，契约 3.6——
// 「还没设置过」不是错误）
async function fetchSettingsByCode(code) {
  const rows = await rdbRequest('settings', {
    method: 'GET',
    query: { select: 'semester_start,period_times', code: `eq.${code}` },
  });
  return rows.length > 0 ? toSettings(rows[0]) : null;
}

// 按口令 upsert（契约 3.7）：settings.code 是主键，PostgREST 的
// resolution=merge-duplicates 让主键冲突时自动改走更新——一条请求完成
// 「有旧设置则整体覆盖，没有则新建」，不需要先查再分Insert/Update两步。
// updated_at 显式带上：merge 路径不会触发数据库 DEFAULT，不写就停在旧值
async function upsertSettings(code, semesterStart, periodTimes) {
  await rdbRequest('settings', {
    method: 'POST',
    body: {
      code,
      semester_start: semesterStart,
      period_times: periodTimes,
      updated_at: new Date().toISOString(),
    },
    extraHeaders: { Prefer: 'return=minimal,resolution=merge-duplicates' },
    errorPrefix: '保存设置失败',
  });
}

module.exports = { fetchSettingsByCode, upsertSettings, toSettings };
