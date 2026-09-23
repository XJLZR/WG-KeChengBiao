/* ============================================================
   ui-home.js —— 首页：视图切换与渲染
   对应：TECH_DESIGN.md 第 2 节 js/ui-home.js、PRD.md 第 4 节 P1（V1.1–V1.6）

   分层约定（TECH_DESIGN 第 2 节）：界面层只调用 schedule.js 这类逻辑函数，
   不直接碰 IndexedDB 或 localStorage。所有「算」的活都在 schedule.js，
   本文件只管「把算出来的东西画到页面上」。
   ============================================================ */

/* 星期名称：下标 0 对应周一，与 Course.weekday（1–7，1 = 周一）差 1 */
const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/* 每天节次数：PRD F3「每天 12 节」 */
const PERIOD_COUNT = 12;

/* 课程配色的数量，对应 css/pages.css 里的 .course-color-1 ～ .course-color-8 */
const COURSE_COLOR_COUNT = 8;

/* 状态标签的中文。内部用英文代号，显示时才翻译（TECH_DESIGN 6.1：
   「用户看懂的，和开发看懂的，分开」） */
const STATUS_TEXT = {
  ended: '已结束',
  ongoing: '正在上课',
  upcoming: '未开始',
};

/* ---------- 小工具 ---------- */

/** 把课程名里的 < > & " 转义，避免将来真实数据里的特殊字符把页面结构弄坏 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 按课程名算一个固定的配色编号（1～8）。
 * 用简易哈希而不是随机数：同一门课每次刷新、在今日列表和周视图里颜色都一致，
 * 用户才能靠颜色认课（PRD 第 10 节「课程配色」）。
 *
 * ⚠️ 这里用的是 djb2 哈希，不是随手写的 hash*31 —— 试过 5 种写法，
 *    hash*31 会让今天的「大学英语（三）」和「体育（羽毛球）」撞成同一个颜色（都拿到 4 号），
 *    而 djb2 在「同一个星期里的课」上撞色最少（今天 4 门各不相同）。
 *    它不保证永不撞色：颜色只有 8 种，课多了必然会重复，够用即可。
 */
function getCourseColorIndex(name) {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash + name.charCodeAt(i)) >>> 0;   // hash * 33 + 字符编码
  }
  return (hash % COURSE_COLOR_COUNT) + 1;
}

/** 节次数组 → 中文：如 [1,2] → 第1–2节，[6] → 第6节 */
function formatPeriods(periods) {
  const min = Math.min(...periods);
  const max = Math.max(...periods);
  return min === max ? `第${min}节` : `第${min}–${max}节`;
}

/** Date → "HH:MM" */
function formatTimeLabel(date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/* ---------- 顶部信息条 ---------- */

/**
 * 顶部信息条（PRD V1.1 第①项）：第 N 周 · 今天日期 · 当前时间
 * ⚠️ 时间是「页面打开那一刻」算出来的，不会自己走；刷新页面即重新计算。
 */
function renderWeekbar(week, now) {
  document.getElementById('weekbar-week').textContent =
    week === null ? '不在教学周' : `第 ${week} 周`;
  document.getElementById('weekbar-date').textContent =
    `${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAY_NAMES[getWeekday(now) - 1]} ${formatTimeLabel(now)}`;
}

/* ---------- 今日视图：一张课程卡片 ---------- */

/**
 * 生成一张课程卡片（PRD V1.1 第③项里的「每条」）。
 * 单独抽成函数就是为了可复用：课程管理页（T4）、以后周视图点开的详情，
 * 都能直接用同一张卡片。
 */
function renderCourseCard(course, settings, now) {
  const status = getCourseStatus(course, settings, now);
  const colorIndex = getCourseColorIndex(course.name);

  const metaParts = [formatPeriods(course.periods), course.location || '—'];
  if (course.teacher) metaParts.push(course.teacher);   // 教师为空时该位置留空，不放占位符（PRD 5.1）

  return (
    `<article class="course-card course-color-${colorIndex}` +
    `${status === 'ongoing' ? ' is-ongoing' : ''}">` +
    `<div class="course-card__main">` +
    `<p class="course-card__name">${escapeHtml(course.name)}</p>` +
    `<p class="course-card__meta">${escapeHtml(metaParts.join(' · '))}</p>` +
    `</div>` +
    `<span class="course-card__status course-card__status--${status}">${STATUS_TEXT[status]}</span>` +
    `</article>`
  );
}

/* ---------- 今日视图：五个视图挑一个显示 ---------- */

/**
 * 按 PRD P1 的规则决定显示哪个视图，并把内容画出来：
 *   一条课程都没有       → V1.5 空课表
 *   不在教学周           → V1.3 还没开学 / 已放假
 *   今天有课             → V1.1 今日有课（下一节课条 + 课程列表）
 *   本周整周没课         → V1.4 本周没有课
 *   其余（今天恰好没课） → V1.2 今天没有课
 *
 * ⚠️ 「本周没课」必须排在「今天没课」前面判断：本周没课时今天必然也没课，
 *    顺序写反的话 V1.4 永远显示不到。
 */
function renderTodayView(courses, settings, now) {
  const week = getWeekNumber(settings, now);
  const todayWeekday = getWeekday(now);
  const isInTerm = week !== null && week <= getTermLastWeek(courses);

  let visibleId = 'state-empty';        // 默认 V1.5
  let todayCourses = [];

  if (courses.length === 0) {
    visibleId = 'state-empty';
  } else if (!isInTerm) {
    visibleId = 'state-off-term';
  } else {
    todayCourses = getCoursesOfDay(courses, todayWeekday, week);
    if (todayCourses.length > 0) {
      visibleId = 'course-list';
    } else if (getCoursesOfWeek(courses, week).length === 0) {
      visibleId = 'state-no-week';
    } else {
      visibleId = 'state-no-today';
    }
  }

  // 五个容器：是当前视图的显示，其余藏起来
  ['state-empty', 'state-off-term', 'state-no-week', 'state-no-today', 'course-list'].forEach((id) => {
    document.getElementById(id).classList.toggle('is-hidden', id !== visibleId);
  });

  // 「下一节课」信息条只跟 V1.1 一起出现
  const isTodayView = visibleId === 'course-list';
  document.getElementById('next-card').classList.toggle('is-hidden', !isTodayView);

  if (isTodayView) {
    renderNextCard(getNextCourse(todayCourses, settings, now), settings);
    document.getElementById('course-list').innerHTML = todayCourses
      .map((course) => renderCourseCard(course, settings, now))
      .join('');
  }
}

/**
 * 「下一节课」信息条（PRD V1.1 第②项 / 验收 B4）。
 * 有下一节 → 显示课程名 + 节次 + 开始时间 + 地点；
 * 今天的课全上完 → 只显示「今天的课都上完了」，不留空白卡片。
 */
function renderNextCard(nextCourse, settings) {
  const nameEl = document.getElementById('next-name');
  const metaEl = document.getElementById('next-meta');
  const doneEl = document.getElementById('next-done');

  if (nextCourse) {
    const range = getCourseTimeRange(nextCourse, settings);
    nameEl.textContent = nextCourse.name;
    metaEl.textContent =
      `${formatPeriods(nextCourse.periods)} · ${range.start} 开始 · ${nextCourse.location || '—'}`;
  }

  nameEl.classList.toggle('is-hidden', !nextCourse);
  metaEl.classList.toggle('is-hidden', !nextCourse);
  doneEl.classList.toggle('is-hidden', Boolean(nextCourse));
}

/* ---------- 周视图 ---------- */

/**
 * 生成周视图网格（PRD V1.6）：周一至周日 × 第 1–12 节。
 *
 * 为什么每个格子都要写 style="grid-row:…; grid-column:…"：
 *   连堂课要跨行（PRD 验收 C3：第 1–4 节的课要跨 4 行）。
 *   CSS 的自动排列做不到跨行，必须让每个格子自己声明在第几行第几列。
 *   格子本来就是脚本生成的，把坐标写进 style 不费事。
 *
 * ⚠️ 假设：一门课的多个节次是连续的（如 01020304 → 第 1–4 节）。
 *    真实数据若出现「第 1、3 节」这种跳号，这里会把它画成跨 3 行；
 *    要处理得按节次逐段画，属 T2 解析阶段的边界问题。
 */
function renderWeekGrid(courses, week, todayWeekday) {
  const grid = document.getElementById('week-grid');
  if (!grid) return;

  let html = '';

  // 第 1 行：左上角空格 + 7 个星期表头（今天那一列加 is-today 高亮）
  html += '<div class="week-grid__corner" style="grid-row:1;grid-column:1"></div>';
  WEEKDAY_NAMES.forEach((name, index) => {
    const weekday = index + 1;
    const cls = weekday === todayWeekday ? 'week-grid__head is-today' : 'week-grid__head';
    html += `<div class="${cls}" style="grid-row:1;grid-column:${weekday + 1}">${name}</div>`;
  });

  // 左起第一列：第 1–12 节
  for (let period = 1; period <= PERIOD_COUNT; period++) {
    html += `<div class="week-grid__period" style="grid-row:${period + 1};grid-column:1">第${period}节</div>`;
  }

  // 本周要画的课：周次集合里包含本周（PRD 验收 C2）
  const visibleCourses = week === null ? [] : getCoursesOfWeek(courses, week);

  // 先记下哪些格子会被课占住，这些格子就不用再画空格子了
  const occupied = new Set();
  visibleCourses.forEach((course) => {
    course.periods.forEach((period) => occupied.add(`${period}-${course.weekday}`));
  });

  // 空格子
  for (let period = 1; period <= PERIOD_COUNT; period++) {
    for (let weekday = 1; weekday <= 7; weekday++) {
      if (occupied.has(`${period}-${weekday}`)) continue;
      const cls = weekday === todayWeekday ? 'week-grid__cell is-today' : 'week-grid__cell';
      html += `<div class="${cls}" style="grid-row:${period + 1};grid-column:${weekday + 1}"></div>`;
    }
  }

  // 课程块：一块占一列宽，用 span 跨过它占的节数
  visibleCourses.forEach((course) => {
    const startPeriod = Math.min(...course.periods);
    const span = Math.max(...course.periods) - startPeriod + 1;
    const colorIndex = getCourseColorIndex(course.name);
    html +=
      `<div class="week-grid__course course-color-${colorIndex}"` +
      ` style="grid-row:${startPeriod + 1} / span ${span};grid-column:${course.weekday + 1}">` +
      `<span class="week-grid__course-name">${escapeHtml(course.name)}</span>` +
      `<span class="week-grid__course-loc">${escapeHtml(course.location || '—')}</span>` +
      `</div>`;
  });

  grid.innerHTML = html;
}

/* ---------- 视图切换 ---------- */

/**
 * 「今日 / 周视图」切换。
 * 按钮上写 data-view="today" / "week"，与视图容器的 id（view-today / view-week）
 * 一一对应，所以按钮值改了就自动对上，不需要写 if 分支。
 */
function initViewSwitch() {
  const switchBox = document.getElementById('view-switch');
  if (!switchBox) return;

  const buttons = switchBox.querySelectorAll('.view-switch__btn');
  const views = document.querySelectorAll('.view');

  switchBox.addEventListener('click', (event) => {
    const btn = event.target.closest('.view-switch__btn');
    if (!btn) return;

    const targetId = `view-${btn.dataset.view}`;

    // 按钮：只高亮被点的那一个
    buttons.forEach((b) => b.classList.toggle('is-active', b === btn));

    // 视图：只显示被点的那一个
    views.forEach((v) => v.classList.toggle('is-hidden', v.id !== targetId));
  });
}

/* ---------- 启动 ---------- */

/**
 * 页面加载时跑一次。
 *
 * ⚠️ 将来接真实数据时，只需要把下面两行换成：
 *      const courses = await storage.getCourses();
 *      const settings = storage.getSettings();
 *    再删掉 index.html 里 mock-data.js 那行 <script>，其余不用动。
 */
function init() {
  const courses = MOCK_COURSES;
  const settings = MOCK_SETTINGS;
  const now = new Date();

  const week = getWeekNumber(settings, now);

  renderWeekbar(week, now);
  renderTodayView(courses, settings, now);
  renderWeekGrid(courses, week, getWeekday(now));
  initViewSwitch();
}

init();
