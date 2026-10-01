/* ============================================================
   ui-home.js —— 首页：视图切换与渲染
   对应：TECH_DESIGN.md 第 2 节 js/ui-home.js、PRD.md 第 4 节 P1（V1.1–V1.8）

   分层约定（TECH_DESIGN 第 2 节）：界面层只调用 schedule.js 这类逻辑函数，
   不直接碰 IndexedDB 或 localStorage。所有「算」的活都在 schedule.js，
   本文件只管「把算出来的东西画到页面上」。

   Day 12 新增「本周课程搜索」：筛选条 + 搜索结果区（见下方同名一节）。
   它搜的是整周的课，所以筛选条挂在两个视图外面（index.html 里在视图切换器下方）。
   ============================================================ */

/* 星期名称：下标 0 对应周一，与 Course.weekday（1–7，1 = 周一）差 1 */
const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/* 每天节次数：PRD F3「每天 12 节」 */
const PERIOD_COUNT = 12;

/* 课程配色的数量，对应 css/pages.css 里的 .course-color-1 ～ .course-color-8 */
const COURSE_COLOR_COUNT = 8;

/* 「加载中」延迟显示的毫秒数（PRD V1.7）：读取耗时超过它才显示加载页 */
const LOADING_DELAY_MS = 250;

/* 首页级过程状态的容器 id（PRD V1.7 / V1.8）：同一时间最多显示一个 */
const PAGE_STATE_IDS = ['state-loading', 'state-error'];

/* 读取成功时才显示的正常内容 —— 过程状态出现时，这些全部藏起来。
   Day 12 把筛选条与搜索结果区也归进「正常内容」：读取中 / 读取失败时
   必须一起藏掉，否则它们会残留在错误页上方。
   至于正常态里具体显示哪几块，交由 applyDisplayState() 细分。 */
const NORMAL_IDS = ['weekbar', 'view-switch', 'course-filter', 'search-panel', 'view-today', 'view-week'];

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

/**
 * 课程配色 class 名（如 "course-color-7"）。
 * 单独收一层，是因为「course-color- + 编号」这个拼法在今日卡片和周视图课程块里
 * 各写一遍，改配色规则时容易漏掉一处，两边就不一致了。
 */
function getCourseColorClass(name) {
  return `course-color-${getCourseColorIndex(name)}`;
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
 *
 * options.showWeekday（Day 12，搜索结果专用）打开后：
 *   ① 信息行末尾补上星期 —— 结果跨天，只说「第 3–4 节」不知道是星期几；
 *   ② 不显示「已结束 / 正在上课 / 未开始」—— 那套状态是拿「此刻」算的，
 *      套在别的星期的课上会答错（周四去搜周三的课，它必然显示「已结束」，
 *      这个结论对用户毫无意义）。
 *
 * ⚠️ Day 14 改动（用户测试反馈「搜索内容里的老师删掉，改成周几」）：
 *   搜索结果里星期比教师有用，所以那一行改成「节次 · 地点 · 星期」，
 *   且不再单独占一行标签（原来在卡片上方，占掉一行高度还没信息量）。
 *   今日视图的卡片不受影响，教师照旧显示。
 */
function renderCourseCard(course, settings, now, options) {
  const opts = options || {};
  const isSearchResult = Boolean(opts.showWeekday);

  const metaParts = [formatPeriods(course.periods), course.location || '—'];
  if (isSearchResult) {
    /* 搜索结果：第三格放星期（不给教师留位置） */
    metaParts.push(WEEKDAY_NAMES[course.weekday - 1]);
  } else if (course.teacher) {
    metaParts.push(course.teacher);   // 教师为空时该位置留空，不放占位符（PRD 5.1）
  }

  let ongoingCls = '';
  let statusTag = '';
  if (!isSearchResult) {
    const status = getCourseStatus(course, settings, now);
    ongoingCls = status === 'ongoing' ? ' is-ongoing' : '';
    statusTag = `<span class="course-card__status course-card__status--${status}">${STATUS_TEXT[status]}</span>`;
  }

  return (
    `<article class="course-card ${getCourseColorClass(course.name)}${ongoingCls}">` +
    `<div class="course-card__main">` +
    `<p class="course-card__name">${escapeHtml(course.name)}</p>` +
    `<p class="course-card__meta">${escapeHtml(metaParts.join(' · '))}</p>` +
    `</div>` +
    statusTag +
    `</article>`
  );
}

/**
 * 课程列表组件：一批课程 → 一串卡片 HTML。
 * 今日视图直接用它；T3 导入预览（「解析出 N 门课」）和 T4 课程管理页
 * 要列课程时，调的是同一个函数，不用再写一遍「map 一遍再 join」。
 * options 一路传给 renderCourseCard（Day 12 后被搜索结果复用）。
 */
function renderCourseList(courses, settings, now, options) {
  return courses.map((course) => renderCourseCard(course, settings, now, options)).join('');
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
    document.getElementById('course-list').innerHTML = renderCourseList(todayCourses, settings, now);
  }

  /* V1.2 的说明文字是算出来的：告诉用户「本周还有哪几天有课」，
     比写死一句「今天没有排课」有用（Day 13） */
  if (visibleId === 'state-no-today') {
    document.getElementById('state-no-today-desc').textContent =
      buildNoTodayDesc(courses, settings, week, todayWeekday);
  }
}

/**
 * V1.2「今天没有课」的说明文字（Day 13）。
 *
 * 为什么要算：原来写死一句「今天没有排课」，跟标题「今天没有课」是同一个意思，
 *   等于没说。用户真正想知道的是「那我哪天有课」。
 *
 * 规则：
 *   ① 先看本周还没过的日子（todayWeekday 之后）里有没有课 → 「本周周三、周四还有课」
 *   ② 后面没有了，再看本周已经过去的（todayWeekday 之前）→ 「本周的课都上完了」
 *   ③ 整周确无安排 → 让用户去看周视图自己确认
 *
 * @param {Array} courses 全部课程
 * @param {Object} settings 设置（要有 periodTimes / semesterStart）
 * @param {number} week 本周周次
 * @param {number} todayWeekday 今天星期几（1=周一 … 7=周日）
 * @returns {string} 一句中文说明
 */
function buildNoTodayDesc(courses, settings, week, todayWeekday) {
  const weekCourses = getCoursesOfWeek(courses, week);

  /* 本周「星期几」这一列有课：把 weekday 收成一个集合，方便判断前后 */
  const daysWithCourse = new Set(weekCourses.map((c) => c.weekday));

  const laterDays = [];
  const earlierDays = [];
  daysWithCourse.forEach((wd) => {
    if (wd > todayWeekday) laterDays.push(wd);
    else if (wd < todayWeekday) earlierDays.push(wd);
  });
  laterDays.sort((a, b) => a - b);
  earlierDays.sort((a, b) => a - b);

  const nameOf = (wd) => WEEKDAY_NAMES[wd - 1];

  if (laterDays.length > 0) {
    return `今天没有排课，本周${laterDays.map(nameOf).join('、')}还有课`;
  }
  if (earlierDays.length > 0) {
    return `今天没有排课，本周的课都上完了`;
  }
  return '今天没有排课，可以看看周视图了解本周安排';
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
 * 周视图里的一个课程块：一列宽，用 grid-row 的 span 跨过它占的节数。
 *
 * ⚠️ 假设：一门课的多个节次是连续的（如 01020304 → 第 1–4 节）。
 *    真实数据若出现「第 1、3 节」这种跳号，这里会把它画成跨 3 行；
 *    要处理得按节次逐段画，属 T2 解析阶段的边界问题。
 *
 * 坐标写在 style 里而不是靠 CSS 自动排列：CSS 做不到跨行，
 * 而连堂课必须跨行（PRD 验收 C3）。格子本来就是脚本生成的，写坐标不费事。
 */
function renderWeekCourseBlock(course) {
  const startPeriod = Math.min(...course.periods);
  const span = Math.max(...course.periods) - startPeriod + 1;

  return (
    `<div class="week-grid__course ${getCourseColorClass(course.name)}"` +
    ` style="grid-row:${startPeriod + 1} / span ${span};grid-column:${course.weekday + 1}">` +
    `<span class="week-grid__course-name">${escapeHtml(course.name)}</span>` +
    `<span class="week-grid__course-loc">${escapeHtml(course.location || '—')}</span>` +
    `</div>`
  );
}

/**
 * 生成周视图网格（PRD V1.6）：周一至周日 × 第 1–12 节。
 * 课程块本身由 renderWeekCourseBlock() 画，本函数只负责摆格子和表头。
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
    html += renderWeekCourseBlock(course);
  });

  grid.innerHTML = html;
}

/* ---------- 视图切换 ---------- */

/** 当前选中的视图：'today'（今日，PRD V1.1–V1.5）| 'week'（周视图，PRD V1.6） */
let activeView = 'today';

/**
 * 把「正常态下该显示哪几块」一次算清楚。
 *
 * 为什么收在一个函数里：现在三个维度会互相牵扯，分开判断必然打架 ——
 *   ① 搜索态：有搜索词时只显示搜索结果区，今日视图与周视图都藏起来；
 *   ② 视图态：没在搜索时，按 activeView 显示今日或周视图；
 *   ③ 筛选条：本周有课、且当前在今日视图时才给。
 * 读取中与读取失败不在这里判断 —— showPageState() 会先把正常内容整体藏掉。
 *
 * Day 12 之前这个函数只管 ②，那时叫 applyView()。
 *
 * ⚠️ Day 14 改动（用户测试反馈「把周视图的搜索栏删掉」）：
 *   条件 ③ 增加了 activeView === 'today'。原因：用户实测时在周视图里
 *   看到搜索框，以为它能搜「周三下午有没有课」（搜时间），结果搜不到 ——
 *   搜索框出现在周视图里给了它「按表格查」的错误暗示。
 *   现在周视图不显示搜索框，搜索只在今日视图提供。
 *   注意：搜索框隐藏不等于搜索功能被砍（F9 仍在），
 *   它只是不再出现在周视图里 —— 切回今日视图仍然可用。
 */
function applyDisplayState() {
  const isSearching = searchKeyword !== '';

  document.getElementById('view-today').classList.toggle('is-hidden', isSearching || activeView !== 'today');
  document.getElementById('view-week').classList.toggle('is-hidden', isSearching || activeView !== 'week');
  document.getElementById('search-panel').classList.toggle('is-hidden', !isSearching);

  /* 筛选条要等数据到手才算得出「本周有没有课」；还没读到数据就先藏起来。
     Day 14：再加一道「必须在今日视图」—— 周视图下不给搜索框。 */
  let hasWeekCourses = false;
  if (currentCourses && currentSettings) {
    const week = getWeekNumber(currentSettings, new Date());
    hasWeekCourses = week !== null && getCoursesOfWeek(currentCourses, week).length > 0;
  }
  const showFilter = hasWeekCourses && activeView === 'today';
  document.getElementById('course-filter').classList.toggle('is-hidden', !showFilter);
}

/**
 * 「今日 / 周视图」切换。
 * 按钮上写 data-view="today" / "week"，与 applyDisplayState() 的判断一一对应，
 * 按钮值改了就自动对上，不需要写 if 分支。
 */
function initViewSwitch() {
  const switchBox = document.getElementById('view-switch');
  if (!switchBox) return;

  switchBox.addEventListener('click', (event) => {
    const btn = event.target.closest('.view-switch__btn');
    if (!btn) return;

    activeView = btn.dataset.view;

    /* 点视图切换器 = 「我要看视图」，顺手退出搜索态。
       不这么做的话这一下点了毫无反应（结果区盖在视图上），看着像坏了。 */
    if (searchKeyword !== '') {
      searchKeyword = '';
      const input = document.getElementById('filter-input');
      if (input) input.value = '';
    }

    // 按钮：只高亮被点的那一个
    switchBox.querySelectorAll('.view-switch__btn').forEach((b) => {
      b.classList.toggle('is-active', b === btn);
    });

    applyDisplayState();
  });
}

/* ---------- 本周课程搜索（Day 12） ----------
   搜的是「本周」的课，不是只有今天。三个要点：
     ① 匹配范围：课程名 / 地点 / 教师，任意一个命中就算
     ② 排序：先星期（周一在前），同一天里按节次从早到晚
     ③ 搜索态与视图态互斥：有搜索词时今日视图、周视图都藏起来
   搜索结果复用 renderCourseList()，所以卡片样式与今日列表完全一致。
   ------------------------------------------------------------------ */

/* 当前搜索词。空字符串 = 没在搜索，页面按「今日 / 周视图」显示 */
let searchKeyword = '';

/* 最近一次读到的数据。
   搜索是「敲一个字就重算一次」，输入事件里拿不到 bootstrap() 的局部变量，
   所以渲染完成后把数据留在模块级，供搜索与筛选条判断使用。 */
let currentCourses = null;
let currentSettings = null;

/**
 * 按关键词筛课程：课程名 / 地点 / 教师三个字段任意命中就算，忽略大小写。
 * 数据量是「一周几十条」，纯字符串比较就够，不需要防抖，也不需要索引。
 */
function filterCoursesByKeyword(courses, keyword) {
  const key = keyword.trim().toLowerCase();
  if (key === '') return [];

  return courses.filter((course) => {
    const haystack = `${course.name} ${course.location} ${course.teacher}`.toLowerCase();
    return haystack.includes(key);
  });
}

/** 搜索结果排序：先星期（周一在前），同一天内按节次从早到晚 */
function sortSearchResults(courses) {
  return courses.slice().sort((a, b) => {
    if (a.weekday !== b.weekday) return a.weekday - b.weekday;
    return Math.min(...a.periods) - Math.min(...b.periods);
  });
}

/**
 * 按当前的 searchKeyword 把搜索结果画一遍（不改搜索词）。
 * 单独抽出来是因为「刷新课表」之后数据变了，结果也要跟着重画一次。
 *
 * ⚠️ 结果是 0 条时显示的是「本周没有匹配的课程」，不是 V1.2「今天没有课」——
 *    前者是「有课、被筛掉了」，后者是「今天确实没排课」，含义不同不能混用。
 */
function renderSearchPanel() {
  const countEl = document.getElementById('search-count');
  const listEl = document.getElementById('search-list');
  const noMatchEl = document.getElementById('state-no-match');
  if (!countEl || !listEl || !noMatchEl) return;

  const now = new Date();
  const week = getWeekNumber(currentSettings, now);

  /* 搜索范围 = 本周：不在本周的课不参与匹配（非教学周时 week 为 null，结果自然是空） */
  const weekCourses = week === null ? [] : getCoursesOfWeek(currentCourses, week);
  const matched = sortSearchResults(filterCoursesByKeyword(weekCourses, searchKeyword));
  const hasResult = matched.length > 0;

  countEl.textContent = hasResult ? `本周匹配 ${matched.length} 门课` : '';
  countEl.classList.toggle('is-hidden', !hasResult);

  listEl.innerHTML = hasResult
    ? renderCourseList(matched, currentSettings, now, { showWeekday: true })
    : '';
  listEl.classList.toggle('is-hidden', !hasResult);

  noMatchEl.classList.toggle('is-hidden', hasResult);
}

/**
 * 应用搜索：记下关键词 → 重画结果 → 让 applyDisplayState() 决定显示哪几块。
 * 传空字符串 = 退出搜索，回到原来的视图。
 */
function applySearch(keyword) {
  searchKeyword = keyword.trim();
  if (searchKeyword !== '') renderSearchPanel();
  applyDisplayState();
}

/**
 * 退出搜索：清空输入框与搜索态。
 * ⚠️ 清空按钮点完把焦点还给输入框，否则键盘用户想再搜一次得重新 Tab 找回来。
 */
function exitSearch() {
  searchKeyword = '';
  const input = document.getElementById('filter-input');
  if (input) input.value = '';
  applyDisplayState();
}

/** 接上筛选条的输入与「清空」 */
function initCourseFilter() {
  const input = document.getElementById('filter-input');
  const clearBtn = document.getElementById('filter-clear');
  if (!input || !clearBtn) return;

  input.addEventListener('input', () => applySearch(input.value));

  clearBtn.addEventListener('click', () => {
    exitSearch();
    input.focus();
  });
}

/* ---------- 首页级过程状态（PRD V1.7 加载中 / V1.8 读取失败） ---------- */

/**
 * 显示某个过程状态，或传 null 回到正常内容。
 * 依据 PRD 第 4 节补充规则 1：过程状态出现时，今日视图与周视图的内容都不显示。
 *
 * 这里连顶部信息条和视图切换也一起藏起来，理由：「第 N 周 · 日期」是用读到的设置
 * 算出来的，读取还没完成（或已经失败）时那一行只能显示「—」，留着反而像页面坏了。
 */
function showPageState(stateId) {
  PAGE_STATE_IDS.forEach((id) => {
    document.getElementById(id).classList.toggle('is-hidden', id !== stateId);
  });

  const isNormal = stateId === null;
  NORMAL_IDS.forEach((id) => {
    document.getElementById(id).classList.toggle('is-hidden', !isNormal);
  });

  // 恢复正常时再细分：按搜索态 / 视图态 / 本周有没有课，决定具体显示哪几块
  if (isNormal) applyDisplayState();
}

/* 读取失败的原因文案（TECH_DESIGN 6.1 第 1 条：用户看中文说明，
   技术细节只进 console.error）。code 由数据层抛出，「重试」也修不好的情况
   才这样写；其余情况落到兜底文案。 */
const READ_ERROR_TEXT = {
  DATA_CORRUPT: '本机保存的数据结构不完整，可能被改动过',
  DATA_VERSION_UNSUPPORTED: '本机数据的版本比当前页面新，请刷新页面或更新程序',
};

/**
 * V1.8 读取失败：显示一句原因 + 「重试」按钮。
 * ⚠️ 绝不能落到 V1.5 的「还没有课表数据」——两者含义不同，
 *    读取失败说成「没有数据」，用户会以为自己的课表丢了（PRD V1.8 明文要求）。
 */
function showReadError(error) {
  console.error('[首页] 读取本机数据失败：', error);

  document.getElementById('state-error-reason').textContent =
    (error && READ_ERROR_TEXT[error.code]) || '读取本机数据时出错，请稍后重试';

  showPageState('state-error');
}

/* ---------- 启动 ---------- */

/** 「加载中」用的定时器；数据读回来后要清掉，否则它会把已经显示出的内容盖住 */
let loadingTimer = null;

/**
 * 读取本机数据，返回 { courses, settings }。
 *
 * ⚠️ 现在返回的是 mock 假数据（同步）。T4 接上本机存储后，把函数体换成
 *      const courses = await storage.getCourses();
 *      return { courses, settings: storage.getSettings() };
 *    即可——数据层返回 Promise 也照样能用，其余代码一行不用动，
 *    同时删掉 index.html 里 mock-data.js 那行 <script>。
 *    （两个函数的签名见 TECH_DESIGN.md 4.2「模块间接口」）
 *
 * ⚠️ 读取失败时**必须抛出错误**，不要吞掉后返回空数组：
 *    空数组会被当成「从未导入过」，首页就落到 V1.5 空课表，
 *    用户会以为课表丢了（PRD 第 7 节 T4 已写明这条约束）。
 */
async function readLocalData() {
  return { courses: MOCK_COURSES, settings: MOCK_SETTINGS };
}

/** 读取成功后，把首页三块内容都画出来 */
function renderPage(courses, settings) {
  const now = new Date();
  const week = getWeekNumber(settings, now);

  /* 留一份给搜索用：输入事件触发时拿不到这里的局部变量（Day 12） */
  currentCourses = courses;
  currentSettings = settings;

  renderWeekbar(week, now);
  renderTodayView(courses, settings, now);
  renderWeekGrid(courses, week, getWeekday(now));

  /* 正在搜索时，新数据也要重新过一遍筛选（刷新后结果跟着更新，不留在旧结果上） */
  if (searchKeyword !== '') renderSearchPanel();
}

/**
 * 首页启动流程：读数据 → 画页面。打开页面时跑一次，「重试」按钮也调它。
 *
 * 为什么加载页要「延迟 250ms 才显示」（PRD V1.7）：
 *   本机读取通常只要几十毫秒，一进入就显示加载页的话，用户看到的是白页闪一下
 *   ——那比不显示更糟。所以先挂一个 250ms 的定时器，数据读回来就撤销它，
 *   读不完才让加载页出现。
 */
async function bootstrap() {
  showPageState(null);
  clearTimeout(loadingTimer);
  loadingTimer = setTimeout(() => showPageState('state-loading'), LOADING_DELAY_MS);

  try {
    const data = await readLocalData();
    clearTimeout(loadingTimer);

    renderPage(data.courses, data.settings);
    showPageState(null);           // 读取成功 → 收掉过程状态，显示课表
  } catch (error) {
    clearTimeout(loadingTimer);
    showReadError(error);
  }
}

/** 「重试」按钮：重新走一遍读取流程（PRD V1.8 要求能重新读取） */
function initRetryButton() {
  const btn = document.getElementById('state-error-retry');
  if (!btn) return;

  btn.addEventListener('click', bootstrap);
}

/* ---------- 刷新课表（Day 11 新增） ---------- */

/* 模拟刷新耗时：太短弹窗一闪而过，太长像卡死，取 1.2 秒 */
const REFRESH_DELAY_MS = 1200;

/* 处理期间防连点：disabled 管 UI，这个标志管逻辑（与导入页同一套做法） */
let isRefreshing = false;

/**
 * 刷新 = 重新读数据 + 重新渲染（复用 readLocalData / renderPage / showReadError）。
 *
 * 流程（Day 11 任务）：点「刷新」→ 立刻弹「刷新中」（按钮同时禁用）→
 * 约 1.2 秒后按读取结果弹「刷新成功 / 刷新失败」。
 *
 * ⚠️ 为什么不复用 bootstrap()：bootstrap 把读取失败 catch 在内部、转成页面级
 *    V1.8 错误页，调用方拿不到「成功还是失败」——用它的话，读取失败也会弹
 *    「刷新成功」，弹窗就说了谎。这里自己 try/catch，成败才能分流到两个弹窗。
 *
 * ⚠️ 演示版（Day 11 拍板的 B 方案）：mock 数据是同步返回、必成功，
 *    catch 分支今天到不了（失败弹窗代码已写好、不触发）；
 *    T4 接上真实存储后，readLocalData 失败会真的抛错，这个分支自然生效。
 */
function initRefreshButton() {
  const btn = document.getElementById('refresh-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (isRefreshing) return;

    isRefreshing = true;
    btn.disabled = true;
    showStatusModal({ type: 'loading', title: '正在刷新课表…' });

    setTimeout(async () => {
      try {
        const data = await readLocalData();
        renderPage(data.courses, data.settings);
        showStatusModal({
          type: 'success',
          title: '刷新成功',
          desc: '课表已按当前数据重新计算。',
        });
      } catch (error) {
        /* 读取失败：页面交给 V1.8 错误页，弹窗再补一句可理解的失败提示 */
        showReadError(error);
        showStatusModal({
          type: 'error',
          title: '刷新失败',
          desc: '没能重新读取课表，请稍后再试。',
        });
      }

      isRefreshing = false;
      btn.disabled = false;
    }, REFRESH_DELAY_MS);
  });
}

/* 页面加载时：先接好「不需要数据」的线，再走一次读取流程 */
initViewSwitch();
initCourseFilter();
initRetryButton();
initRefreshButton();
bootstrap();
