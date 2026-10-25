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

   Day 29「A 方案：别名 + 值容错」：
     表头不再要求字面量完全一致，改为字段别名表 + 三级匹配
     （课程名/课程名称/教学班/科目…、周次/上课周次/起止周…）；
     单元格取值也放宽（1 / 一 / 星期一、1-16周 / 1-8,10-16 / 单双周、
     0102 / 第1-2节 / [01-02]节）。目标：换一所学校、换一种导出写法，
     不改代码也能导入。认不出的行仍然只跳过本行，不整体失败。

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

/* ============================================================
   Day 29：宽容取值函数（列表式 A 方案的「值容错」部分）
   ------------------------------------------------------------
   为什么需要：各校教务导出的「同一个字段」写法差别很大——
     星期：1 / 一 / 星期一 / 周一 / Mon
     周次：1 / 1-16周 / 1-8,10-16 / 1-16(单) / 第1-16周
     节次：0102 / 1-2 / 第1-2节 / [01-02]节 / 1,2
   原来的实现只认「纯单个整数」，换个学校就整行被跳过，
   用户看到的是「解析出 0 条记录」，却不知道为什么。
   下面三个函数就是为了把这些差异吃掉。

   关于「为什么不跟 grid-parser.js 共用一个文件」：
     两个解析器各自要在 Node 里单独 require 做单测，互相依赖会让
     单文件测试还得连带加载另一个文件。项目里已有同类先例
     （ui-home.js 与 ui-import.js 各放一份 WEEKDAY_NAMES）。
     代价是同一段逻辑存在两处，改的时候要一起改——记在这里。
   ============================================================ */

const PARSER_WEEKDAY_CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const PARSER_WEEKDAY_EN = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

/** 星期单元格 → 1..7；认不出返回 null */
function parseWeekdayValue(value) {
  const t = String(value == null ? '' : value).replace(/\s+/g, '').trim();
  if (!t) return null;
  const cn = t.match(/(?:星期|周|礼拜)([一二三四五六日天])/);
  if (cn) return PARSER_WEEKDAY_CN[cn[1]];
  if (/^[一二三四五六日天]$/.test(t)) return PARSER_WEEKDAY_CN[t];
  const en = t.match(/^(mon|tue|wed|thu|fri|sat|sun)/i);
  if (en) return PARSER_WEEKDAY_EN[en[1].toLowerCase()];
  if (/^[1-7]$/.test(t)) return Number(t);
  return null;
}

/**
 * 周次单元格 → 升序去重数组；认不出返回 null。
 *   1            → [1]
 *   1-16周       → [1..16]
 *   1-8,10-16    → [1..8, 10..16]
 *   1-16(单)     → [1,3,5,…,15]
 *   第1-16周     → [1..16]
 * 与 grid-parser 的差别：这里不强制要求带「周」字——列表式里
 * 列名已经写着「周次」，格子里只写「1-16」也是合理的。
 */
function parseWeeksValue(value) {
  let t = String(value == null ? '' : value).replace(/\s/g, '');
  if (!t) return null;

  let mode = null;
  if (/单/.test(t)) mode = 'odd';
  else if (/双/.test(t)) mode = 'even';

  t = t.replace(/[\[\]【】（）()<>《》]/g, '')
       .replace(/^第/, '')
       .replace(/周次|周/g, '')
       .replace(/[单双]/g, '');

  if (!/^[\d,\-]+$/.test(t)) return null;

  const out = new Set();
  for (const part of t.split(',')) {
    if (!part) continue;
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      if (a > b) { const tmp = a; a = b; b = tmp; }
      if (a < 1 || b > 30) return null;
      for (let i = a; i <= b; i++) out.add(i);
    } else if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n < 1 || n > 30) return null;
      out.add(n);
    } else {
      return null;
    }
  }

  let weeks = [...out].sort((a, b) => a - b);
  if (mode === 'odd') weeks = weeks.filter((n) => n % 2 === 1);
  if (mode === 'even') weeks = weeks.filter((n) => n % 2 === 0);
  return weeks.length ? weeks : null;
}

/**
 * 节次单元格 → 升序去重数组；认不出返回 null。
 *   0102      → [1,2]（两位一节，本校口径）
 *   08        → [8]
 *   第1-2节   → [1,2]
 *   [01-02]节 → [1,2]
 *   1,2       → [1,2]
 *   101112    → [10,11,12]
 */
function parsePeriodsValue(value) {
  let t = String(value == null ? '' : value).replace(/\s/g, '');
  if (!t) return null;
  t = t.replace(/[\[\]【】]/g, '').replace(/^第/, '').replace(/节$/, '');
  if (!t) return null;

  /* 逗号列举：1,2,3 */
  if (/^[\d,]+$/.test(t) && t.includes(',')) {
    const parts = t.split(',').filter(Boolean).map(Number);
    if (parts.length && parts.every((n) => n >= 1 && n <= 12)) {
      return [...new Set(parts)].sort((a, b) => a - b);
    }
    return null;
  }

  /* 连字符区间：1-2 / 3-4-5 */
  if (/^[\d\-]+$/.test(t) && t.includes('-')) {
    const parts = t.split('-').filter(Boolean).map(Number);
    if (parts.length && parts.every((n) => n >= 1 && n <= 12)) {
      return [...new Set(parts)].sort((a, b) => a - b);
    }
    return null;
  }

  /* 纯数字串：优先两位一节，退而单字切（与 splitPeriods 兼容） */
  if (/^\d+$/.test(t)) {
    if (t.length % 2 === 0) {
      const paired = [];
      let ok = true;
      for (let i = 0; i < t.length; i += 2) {
        const n = Number(t.slice(i, i + 2));
        if (n < 1 || n > 12) { ok = false; break; }
        paired.push(n);
      }
      if (ok) return [...new Set(paired)].sort((a, b) => a - b);
    }
    const single = [...t].map(Number);
    if (single.every((n) => n >= 1 && n <= 9)) {
      return [...new Set(single)].sort((a, b) => a - b);
    }
  }
  return null;
}

/**
 * 在表头行里为一个字段找列下标。
 * 三级匹配，从严格到宽松：
 *   ① 完全相等（「周次」对「周次」）
 *   ② 以别名开头（「周次(起止)」对「周次」）
 *   ③ 包含别名（「上课周次」对「周次」）
 * 找不到返回 -1。usedCols 防止两个字段抢同一列。
 */
function findFieldColumn(cells, aliases, usedCols) {
  for (const alias of aliases) {
    for (let i = 0; i < cells.length; i++) {
      if (usedCols.has(i)) continue;
      if (cells[i] === alias) return i;
    }
  }
  for (const alias of aliases) {
    for (let i = 0; i < cells.length; i++) {
      if (usedCols.has(i)) continue;
      if (cells[i].startsWith(alias)) return i;
    }
  }
  for (const alias of aliases) {
    for (let i = 0; i < cells.length; i++) {
      if (usedCols.has(i)) continue;
      if (cells[i].includes(alias)) return i;
    }
  }
  return -1;
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
 * 字段别名表（Day 29 提到文件级，供 ui-import.js 的手动映射预填下拉框复用）。
 * 顺序即优先级：越靠前的别名越具体，匹配时先试。
 */
const PARSER_HEADER_FIELDS = [
  {
    key: 'name', required: true, label: '课程名称',
    aliases: ['课程名称', '课程名', '课程', '教学班', '科目', '课名'],
  },
  {
    key: 'weeks', required: true, label: '周次',
    aliases: ['周次', '上课周次', '起止周', '周数', '教学周'],
  },
  {
    key: 'weekday', required: true, label: '星期',
    aliases: ['星期', '周几', '上课星期', '星期几'],
  },
  {
    key: 'periods', required: true, label: '节次',
    aliases: ['节次', '上课节次', '节数', '课节', '节'],
  },
  {
    key: 'location', required: false, label: '上课地点',
    aliases: ['上课地点', '地点', '教室', '上课教室', '场地'],
  },
  {
    key: 'teacher', required: false, label: '教师',
    aliases: ['任课教师', '授课教师', '教师', '老师', '主讲'],
  },
  {
    key: 'scheduleDate', required: false, label: '排课日期',
    aliases: ['排课日期', '上课日期'],
  },
];

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
     Day 29 起按「字段别名表」定位列：不同学校的表头文字不一样
     （课程名 / 课程名称 / 上课周次 / 节次 / 上课节次 / 教室…），
     写死一套字面量换个学校就全盘失败。
     每个字段给一组候选词，按「完全相等 → 开头相同 → 包含」三级匹配，
     命中的列不再参与后续匹配，避免两个字段抢同一列。
     课程名称 / 周次 / 星期 / 节次 四列仍为必需；
     上课地点 / 教师 / 排课日期 找不到就按「无此列」处理。 */
  const HEADER_FIELDS = PARSER_HEADER_FIELDS;

  let headerIndex = -1;
  let colMap = null;
  for (let i = 0; i < rows.length; i++) {
    const cells = [...rows[i].querySelectorAll('td, th')].map(normalizeCellText);
    /* 判断「这行像不像表头」：只要有任意一个课程名别名出现就试一次 */
    const nameAliases = HEADER_FIELDS[0].aliases;
    if (!cells.some((c) => nameAliases.some((alias) => c.includes(alias)))) {
      continue;
    }

    const usedCols = new Set();
    const map = {};
    let missing = null;
    for (const field of HEADER_FIELDS) {
      const idx = findFieldColumn(cells, field.aliases, usedCols);
      if (idx >= 0) {
        map[field.key] = idx;
        usedCols.add(idx);
      } else if (field.required) {
        missing = field.label;
      }
    }
    if (missing) {
      return {
        ok: false,
        error: {
          code: 'NOT_COURSE_FILE',
          message: `文件像课表但缺少「${missing}」列，请确认导出的是「学生个人课表」的完整文件。`,
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
        message: '这不是可识别的课表文件：既没找到课程表头，也没找到「星期一…星期日」这样的表格布局。请从教务系统「学生个人课表」重新导出一份。',
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

    /* Day 29：取值改为宽容解析——「星期一 / 周一 / 1」「1-16周 / 1-8,10-16」
       「第1-2节 / [01-02]节 / 0102」都认。认不出的行仍然只跳过本行。 */
    const weekday = parseWeekdayValue(weekdayStr);
    if (weekday === null) {
      skippedRows++;
      continue;
    }
    const weeks = parseWeeksValue(weekStr);
    if (!weeks) {
      skippedRows++;
      continue;
    }
    const periods = parsePeriodsValue(periodStr);
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
      /* Day 29：一行的周次可能本身就是多周（1-16周），逐周并进去 */
      for (const w of weeks) {
        if (!draft.weeks.includes(w)) {
          draft.weeks.push(w);
        }
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
        weeks: weeks.slice(),
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
  module.exports = {
    parseCourseTable,
    splitPeriods,
    stableHash,
    parseWeekdayValue,
    parseWeeksValue,
    parsePeriodsValue,
    findFieldColumn,
    PARSER_HEADER_FIELDS,
  };
}
