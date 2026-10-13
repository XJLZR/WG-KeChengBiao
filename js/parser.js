/* ============================================================
   parser.js —— 教务课表文件解析器（Day 25 · T2 第一步）
   对应：PRD F1 / 5.1 数据规则 / V2.3 失败分类，research.md 第四节格式特征

   为什么单独放一个文件：
     和 schedule.js 同一个理由——它只做「文本进、数据出」的纯转换，
     不认识 DOM 事件、不认识网络、不认识存储。好处：
     ① 可以在 Node 里单测，不用开浏览器；
     ② 导入页（T3）和将来任何要用课表文件的地方都能复用。

   输入输出：
     输入 = 教务导出的课表文件**文本内容**（浏览器用 FileReader 读出）。
       ⚠️ 实测（Day 25）：这个文件扩展名是 .xls，但文件头实为 UTF-8 的
       HTML 表格（Excel「网页格式」导出），所以按 HTML 解析即可，
       不需要任何二进制 XLS 库。
     输出 = { ok, courses, stats } 或 { ok:false, error }，
       courses 每条严格符合 api-contract.md 3.3 的字段要求。

   数据规则（PRD 5.1，文档定死不留猜）：
     合并：同课程名 + 同星期 + 同节次 + 同地点 → 周次取并集合为一条；
           地点不同不合并（避免把「同一门课换教室」错并掉）。
     冲突：同时间段两门不同课程都保留，不做裁决（本文件不涉及）。

   错误三分类（PRD V2.3，code 大写下划线与首页错误码同风格）：
     FILE_EMPTY      文件内容为空 / 全是空白
     NOT_COURSE_FILE 找不到「课程名称」表头，不是可识别的课表文件
     ZERO_RECORDS    有表头但解析出 0 条有效记录
     单行字段不合法不算整体失败：跳过该行、计入 stats.skippedRows，
     预览时提示「跳过 N 行无效数据」即可——教务文件里本来就有尾部空行。

   Node 单测入口见文件尾注。
   ============================================================ */

/**
 * 节次字符串切分：按「两位一节」切成数字数组（research.md 4.2）。
 *   '0102'    → [1, 2]
 *   '08'      → [8]        （单节也是两位，如数据里真实存在的第 8 节）
 *   '01020304'→ [1, 2, 3, 4]
 *   '030405'  → [3, 4, 5]
 * 不合法（奇数位 / 含非数字 / 某段超出 1–12）返回 null，由调用方跳过该行。
 * 结果升序去重——正常数据本来就有序，排序只是防御，代价为零。
 */
function splitPeriods(periodStr) {
  const s = String(periodStr).trim();
  if (!/^\d+$/.test(s) || s.length % 2 !== 0 || s.length === 0) {
    return null;
  }
  const periods = [];
  for (let i = 0; i < s.length; i += 2) {
    const n = Number(s.slice(i, i + 2));
    if (n < 1 || n > 12) {
      return null;
    }
    periods.push(n);
  }
  return [...new Set(periods)].sort((a, b) => a - b);
}

/**
 * djb2 变体稳定哈希（与 ui-home.js 课程配色同一思路）：
 * 同一输入永远得到同一输出 → 同一文件重复导入，课程 id 不变，
 * 正好契合接口「重复导入 = 整体替换、合法」的语义。
 * 输出 32 位无符号整数，转 base36 后拼上前缀 c 当课程 id。
 */
function stableHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** 把单元格文字压成「单空格 + 去首尾」的标准形态，避免换行/多空格干扰 */
function normalizeCellText(el) {
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
}

/**
 * 主入口：课表文件文本 → 符合 API 契约的课程数组。
 *
 * 返回（成功）：
 *   { ok: true,
 *     courses: [{ id, name, weekday, periods, weeks, location?, teacher? }],
 *     stats: { rawRows, validRows, skippedRows, firstScheduleDate } }
 * 返回（失败）：
 *   { ok: false, error: { code, message } }   —— code 见文件头三分类
 *
 * ⚠️ 依赖浏览器全局 DOMParser（所有主流浏览器都有）。
 * Node 单测环境里由测试脚本先注入 jsdom 的 DOMParser 再 require 本文件。
 */
function parseCourseTable(htmlText) {
  /* ---- 分类一：文件为空（V2.3 ③） ---- */
  if (typeof htmlText !== 'string' || htmlText.trim() === '') {
    return {
      ok: false,
      error: { code: 'FILE_EMPTY', message: '文件内容是空的，请重新从教务系统导出一次。' },
    };
  }

  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const rows = [...doc.querySelectorAll('tr')];

  /* ---- 分类二：找不到表头（V2.3 ①） ----
     按表头文字定位列下标，而不是写死「第 5 列是周次」：
     教务哪天调整列序，解析器也不用跟着改。六个目标列里，
     课程名称 / 周次 / 星期 / 节次 四列必须有，缺一个就不认；
     上课地点 / 教师 是可空列，找不到就按「无此列」处理。 */
  const HEADER_KEYS = [
    { key: 'name', label: '课程名称', required: true },
    { key: 'weeks', label: '周次', required: true },
    { key: 'weekday', label: '星期', required: true },
    { key: 'periods', label: '节次', required: true },
    { key: 'location', label: '上课地点', required: false },
    { key: 'teacher', label: '教师', required: false },
    { key: 'scheduleDate', label: '排课日期', required: false },
  ];

  let headerIndex = -1;
  let colMap = null;
  for (let i = 0; i < rows.length; i++) {
    const cells = [...rows[i].querySelectorAll('td, th')].map(normalizeCellText);
    if (!cells.some((c) => c.includes('课程名称'))) {
      continue;
    }
    const map = {};
    let missing = null;
    for (const { key, label, required } of HEADER_KEYS) {
      const idx = cells.findIndex((c) => c.includes(label));
      if (idx >= 0) {
        map[key] = idx;
      } else if (required) {
        missing = label;
      }
    }
    if (missing) {
      return {
        ok: false,
        error: {
          code: 'NOT_COURSE_FILE',
          message: `文件像课表但缺少「${missing}」列，请确认导出的是「学生个人课表-列表展示」格式。`,
        },
      };
    }
    headerIndex = i;
    colMap = map;
    break;
  }
  if (headerIndex === -1) {
    return {
      ok: false,
      error: {
        code: 'NOT_COURSE_FILE',
        message: '这不是可识别的课表文件：没找到课程表头。请从教务系统「学生个人课表 → 列表展示 → 导出」重新导出。',
      },
    };
  }

  /* ---- 逐行解析：关键字段缺一跳过该行，不整体失败 ---- */
  const merged = new Map(); // 合并 key → 课程草稿
  const usedIds = new Set(); // 哈希碰撞检测（不同 key 撞出同 id 时加后缀）
  let rawRows = 0;
  let validRows = 0;
  let skippedRows = 0;
  let firstScheduleDate = null;

  const cellAt = (cells, idx) => (idx === undefined ? '' : normalizeCellText(cells[idx] || ''));

  for (let i = headerIndex + 1; i < rows.length; i++) {
    rawRows++;
    const cells = [...rows[i].querySelectorAll('td, th')];

    const name = cellAt(cells, colMap.name);
    const weekStr = cellAt(cells, colMap.weeks);
    const weekdayStr = cellAt(cells, colMap.weekday);
    const periodStr = cellAt(cells, colMap.periods);
    const location = cellAt(cells, colMap.location);
    const teacher = cellAt(cells, colMap.teacher);
    const dateStr = cellAt(cells, colMap.scheduleDate);

    /* 整行全空（教务文件尾部常见）或课程名为空：静默跳过 */
    if (!name || !weekStr || !weekdayStr || !periodStr) {
      skippedRows++;
      continue;
    }

    const weekday = Number(weekdayStr);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      skippedRows++;
      continue;
    }
    const week = Number(weekStr);
    if (!Number.isInteger(week) || week < 1 || week > 30) {
      skippedRows++;
      continue;
    }
    const periods = splitPeriods(periodStr);
    if (!periods) {
      skippedRows++;
      continue;
    }

    validRows++;
    /* 排课日期取最小值（ISO 格式字符串比较即日期比较），放进 stats 供预览提示用 */
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      if (firstScheduleDate === null || dateStr < firstScheduleDate) {
        firstScheduleDate = dateStr;
      }
    }

    /* PRD 5.1 合并规则：同课程名+星期+节次+地点 → 周次并集；地点不同不合并 */
    const mergeKey = `${name}|${weekday}|${periods.join(',')}|${location}`;
    if (merged.has(mergeKey)) {
      const draft = merged.get(mergeKey);
      if (!draft.weeks.includes(week)) {
        draft.weeks.push(week);
      }
      /* 教师不在合并 key 里：取组内第一条非空的 */
      if (!draft.teacher && teacher) {
        draft.teacher = teacher;
      }
    } else {
      /* id = 稳定哈希（合并 key）→ 同一文件重复导入 id 不变 */
      const base = 'c' + stableHash(mergeKey).toString(36);
      let id = base;
      let n = 2;
      while (usedIds.has(id)) {
        id = `${base}-${n}`;
        n++;
      }
      usedIds.add(id);
      merged.set(mergeKey, {
        id,
        name,
        weekday,
        periods,
        weeks: [week],
        location,
        teacher,
      });
    }
  }

  /* ---- 分类三：表头在但一条都没解析出来（V2.3 ②） ---- */
  if (merged.size === 0) {
    return {
      ok: false,
      error: {
        code: 'ZERO_RECORDS',
        message: `从文件里解析出 0 条课程记录（共 ${rawRows} 行数据）。请确认导出的是课表列表而不是空白表格。`,
      },
    };
  }

  const courses = [...merged.values()].map((draft) => {
    draft.weeks.sort((a, b) => a - b);
    const course = {
      id: draft.id,
      name: draft.name,
      weekday: draft.weekday,
      periods: draft.periods,
      weeks: draft.weeks,
    };
    /* 后端可选字符串字段：空串合法，但省略更干净，GET 回来的数据也以「无」呈现 */
    if (draft.location) course.location = draft.location;
    if (draft.teacher) course.teacher = draft.teacher;
    return course;
  });
  courses.sort((a, b) => a.weekday - b.weekday || a.periods[0] - b.periods[0] || (a.name < b.name ? -1 : 1));

  return {
    ok: true,
    courses,
    stats: {
      rawRows,
      validRows,
      skippedRows,
      firstScheduleDate,
    },
  };
}

/* Node 单测入口：浏览器里 module 未定义，这段不执行、零副作用；
   Node 里 require 本文件后拿到 { parseCourseTable, splitPeriods } 做断言。
   顶层 function 声明在浏览器自动挂 window，ui-import.js 直接用全局名调用。 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseCourseTable, splitPeriods, stableHash };
}
