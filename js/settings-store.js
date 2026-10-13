/* ============================================================
   settings-store.js —— 设置数据存取共享模块（Day 25 · T8；Day 26 改上云）
   对应：PRD F6、api-contract.md 2.6 / 3.6 / 3.7。

   【Day 26 变更】设置的正本从浏览器 localStorage 改到云端 settings 表
   （按课表口令隔离）。推翻原拍板的原因：微信内置浏览器与系统浏览器是
   两个独立浏览器，localStorage 互不相通——设置存本机导致「微信里调好、
   换浏览器又要重调」。本文件的 localStorage 从「正本」降级为「缓存」：
   - 云端有设置 → 读写走云（ui-settings.js 的 PUT / GET），同时 saveSettings 写缓存；
   - 云端没存过（settings: null）→ 用缓存/默认值兜底，绝不报错。
   校验规则（isValidSettings）与云函数 validateSettingsBody 是同一套。

   数据形状（api-contract.md 2.6 + schemaVersion 本地扩展）：
     {
       semesterStart: 'YYYY-MM-DD',   // 学期第一周周一（周数计算基准）
       periodTimes: [ { start:'HH:MM', end:'HH:MM' } × 12 ],
       schemaVersion: 1,              // 仅本地缓存/备份带，接口体不带
     }

   读取策略：没缓存 / 缓存坏了 / 字段不全 → 一律返回默认值，**不抛错**。
     理由：设置坏了只影响「第几周 / 状态标签」算得准不准，
     不该把整个首页打入 V1.8 读取失败——那套是给课表数据用的。
   ============================================================ */

/* 默认设置（原在 ui-home.js，T8 搬入此处统一管理）。
   数值与原 mock 版一致：一版通用作息，真实作息可在设置页逐节改。 */
const DEFAULT_SETTINGS = {
  semesterStart: '2026-08-31',   // 学期第一周周一
  periodTimes: [
    { start: '08:00', end: '08:45' },  // 第 1 节
    { start: '08:50', end: '09:35' },  // 第 2 节
    { start: '09:50', end: '10:35' },  // 第 3 节
    { start: '10:40', end: '11:25' },  // 第 4 节
    { start: '14:00', end: '14:45' },  // 第 5 节
    { start: '14:50', end: '15:35' },  // 第 6 节
    { start: '15:50', end: '16:35' },  // 第 7 节
    { start: '16:40', end: '17:25' },  // 第 8 节
    { start: '19:00', end: '19:45' },  // 第 9 节
    { start: '19:50', end: '20:35' },  // 第 10 节
    { start: '20:40', end: '21:25' },  // 第 11 节
    { start: '21:30', end: '22:15' },  // 第 12 节
  ],
  schemaVersion: 1,
};

/* localStorage 键名（TECH_DESIGN 3.2 计划键名） */
const SETTINGS_STORAGE_KEY = 'wg.settings';

/** 时间字符串格式：HH:MM（24 小时制） */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 单条节次校验：start/end 都是合法时间且 start < end */
function isValidPeriod(p) {
  return Boolean(p) &&
    typeof p.start === 'string' && TIME_PATTERN.test(p.start) &&
    typeof p.end === 'string' && TIME_PATTERN.test(p.end) &&
    p.start < p.end;
}

/**
 * 整份设置校验：semesterStart 是 YYYY-MM-DD 且确实是周一，
 * periodTimes 恰好 12 条且每条合法。全过返回 true。
 * 「必须是周一」：getWeekNumber 以学期起点为第一周周一推算周数，
 * 选别的星期几会让全学期周数错位，这里一并拦下。
 */
function isValidSettings(s) {
  if (!s || typeof s !== 'object') return false;
  if (typeof s.semesterStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.semesterStart)) {
    return false;
  }
  const d = new Date(s.semesterStart + 'T00:00:00');
  if (isNaN(d.getTime()) || d.getDay() !== 1) return false;
  if (!Array.isArray(s.periodTimes) || s.periodTimes.length !== 12) return false;
  return s.periodTimes.every(isValidPeriod);
}

/**
 * 读设置：合法就用存的；没存过 / 坏了 → 返回默认值（深拷贝，
 * 防止调用方改了返回值把默认值也改了）。绝不抛错（见文件头策略）。
 */
function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidSettings(parsed)) return parsed;
    }
  } catch (err) {
    /* 存的字符串不是合法 JSON 等：按没存过处理 */
  }
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

/** 写本地缓存。正本在云端（Day 26）；调用方应在云端保存成功后再调它 */
function saveSettings(settings) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

/** 清除本地缓存（「恢复默认」「清空全部数据」用），下次读即得默认值 */
function resetSettings() {
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
}
