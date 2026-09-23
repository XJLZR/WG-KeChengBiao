/* ============================================================
   schedule.js —— 课表计算（纯逻辑，不碰界面）
   对应：PRD 第 7 节 T5 / T6、TECH_DESIGN.md 第 4.2 节「模块间接口」

   为什么单独放一个文件：
     这些函数只做数学——给一个日期和一份设置，算出「第几周」「今天的课」
     「这节课的状态」「下一节课」。它们不认识 DOM，也不认识 IndexedDB。
     好处是将来换数据来源（mock → IndexedDB）时，本文件一行都不用改；
     而且这些函数可以单独测，不用开浏览器。

   函数签名严格照 TECH_DESIGN 4.2 表，没有自己加名字。
   ============================================================ */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 把 "YYYY-MM-DD" 解析成「本地时区当天的 0 点」。
 *
 * ⚠️ 为什么不直接 new Date('2026-08-31')：
 *    按 ECMAScript 规范，这种「只有日期、没有时间」的字符串会被当成 **UTC** 零点，
 *    在东八区就变成了 8 月 31 日 08:00。跨天相减时会差出一整天，周数就算错。
 *    手工拆成年/月/日再传给 Date 构造函数，拿到的才是本地 0 点。
 */
function parseDate(str) {
  const parts = str.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/** 取某天的 0 点，用来按「整天的差」相减 */
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * 星期几，返回 1–7（1 = 周一）。
 * JS 原生的 date.getDay() 是 0–6 且 0 = 周日，这里把周日从 0 改成 7。
 */
function getWeekday(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/** 把 "HH:MM" 换算成「当天第几分钟」，方便直接比大小 */
function timeToMinutes(hhmm) {
  const parts = hhmm.split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

/**
 * 今天第几周？（TECH_DESIGN 4.2）
 * 算法：今天 与「学期第一周周一」相差几天 → 除以 7 向下取整 → 再加 1。
 *   例：起始日 2026-08-31，今天 2026-09-23 → 相差 23 天 → 23/7 = 3（向下取整）→ 第 4 周
 * 还没到开学日 → 返回 null（属 PRD V1.3 非教学周）。
 */
function getWeekNumber(settings, date) {
  const semesterStart = parseDate(settings.semesterStart);
  const diffDays = Math.floor((startOfDay(date) - semesterStart) / MS_PER_DAY);
  if (diffDays < 0) return null;
  return Math.floor(diffDays / 7) + 1;
}

/**
 * 学期最后一周是第几周？
 * 依据 TECH_DESIGN 第 10 节待确认项 2 的临时假设：
 *   取所有课程 weeks 里的最大值；课表为空时按 20 周兜底。
 * 用途：判断「已放假」（PRD V1.3）。
 */
function getTermLastWeek(courses) {
  let last = 0;
  courses.forEach((course) => {
    course.weeks.forEach((week) => {
      if (week > last) last = week;
    });
  });
  return last || 20;
}

/**
 * 某一天的课程（TECH_DESIGN 4.2），按节次从早到晚排。
 * 两道过滤：① 星期对得上 ② 周次集合里包含本周。
 */
function getCoursesOfDay(courses, weekday, week) {
  return courses
    .filter((course) => course.weekday === weekday && course.weeks.includes(week))
    .sort((a, b) => Math.min(...a.periods) - Math.min(...b.periods));
}

/** 某一周的全部课程（周视图用；也是 V1.4「本周没课」的判断依据） */
function getCoursesOfWeek(courses, week) {
  return courses.filter((course) => course.weeks.includes(week));
}

/**
 * 一节课的起止时间。
 * 一门课可能占多个节次（如第 6–7 节），取「第一节的开始」到「最后一节的结束」。
 * 例：periods [6,7] → 第 6 节 14:50 开始，第 7 节 16:35 结束
 *     （periodTimes 是数组，下标 0 对应第 1 节，所以要减 1）
 */
function getCourseTimeRange(course, settings) {
  const firstPeriod = settings.periodTimes[Math.min(...course.periods) - 1];
  const lastPeriod = settings.periodTimes[Math.max(...course.periods) - 1];
  return { start: firstPeriod.start, end: lastPeriod.end };
}

/**
 * 一节课现在的状态（TECH_DESIGN 4.2）："ended" 已结束 / "ongoing" 正在上课 / "upcoming" 未开始
 */
function getCourseStatus(course, settings, now) {
  const range = getCourseTimeRange(course, settings);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (nowMinutes < timeToMinutes(range.start)) return 'upcoming';
  if (nowMinutes > timeToMinutes(range.end)) return 'ended';
  return 'ongoing';
}

/**
 * 下一节课（TECH_DESIGN 4.2）：今天「还没开始」的第一节课。
 * 今天没课、或今天的课全上完了 → 返回 null，
 * 此时页面显示「今天的课都上完了」，不显示空白卡片（PRD 验收 B4）。
 */
function getNextCourse(list, settings, now) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return (
    list.find((course) => timeToMinutes(getCourseTimeRange(course, settings).start) > nowMinutes) ||
    null
  );
}
