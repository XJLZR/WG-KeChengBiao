/* ============================================================
   grid-parser.js —— 网格式课表解析器（Day 29 · 多格式支持第一步）
   ------------------------------------------------------------
   为什么要单独一个文件（不塞进 parser.js）：
     parser.js 解决的是「列表式」课表——一行一条课，每列一个字段。
     本文件解决的是「网格式」课表——行是节次、列是星期，
     一门课的全部信息挤在一个单元格里。两者输入结构完全不同，
     混在一个文件里会让两套规则互相干扰、单测也难写。
     所以拆开：parser.js 管列表式，grid-parser.js 管网格式，
     上层（ui-import.js）负责先判断该交给哪个。

   输入：二维数组（由 SheetJS 读二进制 .xls/.xlsx 得到，或由 HTML 表格转换）。
         每一行是字符串数组，缺的单元格由调用方补 ''。
   输出：{ ok, courses, stats } 或 { ok:false, error }，字段与 parser.js 保持一致，
         这样上层保存逻辑完全不用改。

   实测样本（2026-10-25，同学的武汉工程大学个人课表）结构：
     [0] 标题行：  "武汉工程大学 XXX 学生个人课表"
     [1] 信息行：  "学年学期：... 班级：... 打印日期：..."
     [2] 表头行：  ["", "星期一", "星期二", ... "星期日"]
     [3..] 数据行：["第12节\n08:00-09:35", 单元格, 单元格, ...]
     末尾可能有一行「备注：...」

     单元格内多门课用空行隔开，每门课形如：
       大学物理B(下)     ← 课程名（可能占多行，如「大学体育(3)」+「(乒乓球B)」）
       李海霞            ← 教师
       1-8[周]           ← 周次
       L1208             ← 地点
       [01-02]节         ← 节次（格子自带，优先用它而不是行首的「第12节」）

   容错原则（照搬 parser.js 的思路）：
     单门课解析失败不整体报错，跳过并计入 stats.skippedRows；
     只有「认不出是网格式」或「一门课都没解析出来」才算整体失败。

   Node 单测入口见文件尾。
   ============================================================ */

/* ---------- 1. 基础文本处理 ---------- */

/** 统一换行/不间断空格，避免全角空格导致后续正则失配 */
function gridNormalize(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\u3000/g, ' ');
}

/* ---------- 2. 星期 ---------- */

const GRID_WEEKDAY_CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const GRID_WEEKDAY_EN = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

/**
 * 表头单元格 → 星期数字（1=周一 … 7=周日）。
 * 支持「星期一 / 周一 / 礼拜一 / 一 / 1 / Mon / Monday」等写法。
 * 认不出返回 null（调用方据此判断这一列是不是星期列）。
 */
function parseGridWeekday(text) {
  const t = gridNormalize(text).trim();
  if (!t) return null;
  const cn = t.match(/(?:星期|周|礼拜)\s*([一二三四五六日天])/);
  if (cn) return GRID_WEEKDAY_CN[cn[1]];
  if (/^[一二三四五六日天]$/.test(t)) return GRID_WEEKDAY_CN[t];
  const en = t.match(/^(mon|tue|wed|thu|fri|sat|sun)/i);
  if (en) return GRID_WEEKDAY_EN[en[1].toLowerCase()];
  if (/^[1-7]$/.test(t)) return Number(t);
  return null;
}

/* ---------- 3. 周次 ---------- */

/**
 * 周次文本 → 周次数组（升序去重）。
 *   '1-8[周]'        → [1..8]
 *   '1-6,8-16[周]'   → [1..6, 8..16]
 *   '14[周]'         → [14]
 *   '1-16周(单)'     → [1,3,5,…,15]
 *   '1-16周(双)'     → [2,4,6,…,16]
 * 认不出返回 null（该门课跳过）。
 */
function parseGridWeeks(text) {
  let t = gridNormalize(text).replace(/\s/g, '');
  if (!/周/.test(t)) return null;

  let mode = null;
  if (/单/.test(t)) mode = 'odd';
  else if (/双/.test(t)) mode = 'even';

  /* 去掉所有修饰字符，只留数字、逗号、连字符 */
  t = t.replace(/[\[\]【】（）()<>《》]/g, '')
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
      /* 防御：跨度超出 1–30 说明不是正常周次，整门课判为无效 */
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

/* ---------- 4. 节次 ---------- */

/**
 * 节次文本 → 节次数组（升序去重）。
 *   '[01-02]节'    → [1, 2]
 *   '[03-04-05]节' → [3, 4, 5]
 *   '第1-2节'      → [1, 2]
 *   '0102'         → [1, 2]（两位一节，与列表式同一规则）
 *   '345'          → [3, 4, 5]（奇数位按单字切）
 * 认不出返回 null。
 */
function parseGridPeriods(text) {
  let t = gridNormalize(text).replace(/\s/g, '');
  if (!t) return null;
  t = t.replace(/[\[\]【】]/g, '').replace(/^第/, '').replace(/节$/, '');
  if (!t) return null;

  if (/^[\d\-]+$/.test(t) && t.includes('-')) {
    const parts = t.split('-').filter(Boolean).map(Number);
    if (parts.length && parts.every((n) => n >= 1 && n <= 12)) {
      return [...new Set(parts)].sort((a, b) => a - b);
    }
    return null;
  }

  if (/^\d+$/.test(t)) {
    /* 偶数位优先按「两位一节」切（'0102'→1,2；'101112'→10,11,12） */
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
    /* 退而按单字切（'345'→3,4,5） */
    const single = [...t].map(Number);
    if (single.every((n) => n >= 1 && n <= 9)) {
      return [...new Set(single)].sort((a, b) => a - b);
    }
  }
  return null;
}

/* ---------- 5. 结构识别 ---------- */

/**
 * 在二维数组里找「星期表头行」。
 * 判定标准：某一行里至少有 3 个单元格能解析成星期，且星期不重复。
 * 找到返回 { headerIndex, weekdayCols: { 1: 列下标, ..., 7: 列下标 } }；
 * 找不到返回 null（说明不是网格式表格）。
 */
function detectGridLayout(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const weekdayCols = {};
    let count = 0;
    for (let c = 0; c < row.length; c++) {
      const wd = parseGridWeekday(row[c]);
      if (wd && weekdayCols[wd] === undefined) {
        weekdayCols[wd] = c;
        count++;
      }
    }
    if (count >= 3) return { headerIndex: i, weekdayCols };
  }
  return null;
}

/* ---------- 6. 单元格拆分 ---------- */

/** 是否为「节次行」：以「节」结尾，或形如 [01-02] 的方括号写法 */
function isPeriodLine(line) {
  const t = gridNormalize(line).trim();
  if (!t) return false;
  if (/节\s*$/.test(t)) return true;
  return /^\[\s*\d{2}(?:\s*-\s*\d{2})*\s*\]$/.test(t);
}

/**
 * 一个单元格 → 若干门课的文本块。
 * 切分依据：每门课以「节次行」收尾（实测样本 100% 成立）；
 * 若某门课没写节次，则以「第二条第周次行」作为上一门课的结束信号兜底。
 */
function splitGridBlocks(cellText) {
  const lines = gridNormalize(cellText)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const blocks = [];
  let current = [];
  let seenWeeks = false;

  for (const line of lines) {
    /* 新一门课的开始信号：已经有周次了又来一条周次行 */
    if (seenWeeks && /周/.test(line) && parseGridWeeks(line)) {
      blocks.push(current);
      current = [];
      seenWeeks = false;
    }
    current.push(line);
    if (/周/.test(line) && parseGridWeeks(line)) seenWeeks = true;
    if (isPeriodLine(line)) {
      blocks.push(current);
      current = [];
      seenWeeks = false;
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

/* ---------- 7. 单个文本块 → 课程 ---------- */

/** 教师名启发：2–4 个汉字（可含间隔号），且不含数字/括号 */
function looksLikeTeacherName(line) {
  return /^[\u4e00-\u9fa5·]{2,4}$/.test(line);
}

/**
 * 解析一门课。
 * 定位锚点：周次行、节次行——它们的形态在各校样本里最稳定；
 * 课程名 = 周次行之前的若干行（去掉最后一行疑似教师名）；
 * 地点   = 周次行与节次行之间的内容。
 * 解析失败返回 null。
 */
function parseGridBlock(lines, weekday, rowPeriods) {
  if (!lines || !lines.length) return null;

  /* 7.1 周次行 */
  let weeks = null;
  let weeksIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!/周/.test(lines[i])) continue;
    const w = parseGridWeeks(lines[i]);
    if (w) { weeks = w; weeksIdx = i; break; }
  }
  if (!weeks) return null;

  /* 7.2 节次行：从后往前找，跳过周次行本身 */
  let periods = null;
  let periodsIdx = -1;
  for (let i = lines.length - 1; i > weeksIdx; i--) {
    const p = parseGridPeriods(lines[i]);
    if (p && isPeriodLine(lines[i])) { periods = p; periodsIdx = i; break; }
  }
  if (!periods) periods = rowPeriods;   /* 格子没写就用行首「第12节」兜底 */
  if (!periods) return null;

  /* 7.3 课程名 + 教师 */
  const head = lines.slice(0, weeksIdx);
  if (!head.length) return null;
  let teacher = '';
  let nameLines = head;
  if (head.length >= 2 && looksLikeTeacherName(head[head.length - 1])) {
    teacher = head[head.length - 1];
    nameLines = head.slice(0, -1);
  }
  const name = nameLines.join('');
  if (!name) return null;

  /* 7.4 地点：周次行之后、节次行之前 */
  let location = '';
  if (periodsIdx > weeksIdx) {
    location = lines.slice(weeksIdx + 1, periodsIdx).join(' ').trim();
    /* 那一段若混进了别的字段（如备注），过长就只取第一段 */
    if (location.length > 40) location = location.split(/\s+/)[0];
  }

  return {
    name,
    weekday,
    periods,
    weeks,
    ...(location ? { location } : {}),
    ...(teacher ? { teacher } : {}),
  };
}

/* ---------- 8. 稳定哈希（与 parser.js 同思路，独立实现避免耦合） ---------- */

function gridHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

/* ---------- 9. 主入口 ---------- */

/**
 * 网格式课表二维数组 → 课程数组（字段与 api-contract 3.3 一致）。
 *
 * 返回（成功）：
 *   { ok: true, courses: [...], stats: { format:'grid', rawRows, validRows, skippedRows } }
 * 返回（失败）：
 *   { ok: false, error: { code, message } }
 *     NOT_COURSE_FILE —— 找不到星期表头，不是网格式课表
 *     ZERO_RECORDS    —— 有表头但一门课都没解析出来
 */
function parseGridTable(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, error: { code: 'FILE_EMPTY', message: '表格是空的，没有可读取的内容。' } };
  }

  const layout = detectGridLayout(rows);
  if (!layout) {
    return {
      ok: false,
      error: {
        code: 'NOT_COURSE_FILE',
        message: '没有找到「星期一…星期日」这样的表头，这不像网格式课表。',
      },
    };
  }

  const merged = new Map();
  const usedIds = new Set();
  let rawRows = 0;
  let validRows = 0;
  let skippedRows = 0;

  for (let r = layout.headerIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const firstCell = gridNormalize(row[0] || '').trim();

    /* 行首节次（格子没写节次时兜底）：取第一行，如「第12节」 */
    const rowPeriods = parseGridPeriods(firstCell.split('\n')[0] || '');

    /* 整行空白 → 跳过 */
    if (!firstCell && row.every((c) => !gridNormalize(c).trim())) continue;

    /* 表尾备注 / 说明行 → 跳过（实测样本里备注正好落在星期一那一列，
       不排除掉会被当成一门课去解析，最后计成「跳过 1 块」） */
    const isFooterRow = row.some((c) => /^\s*(备注|说明|注[:：]|注意事项)/.test(gridNormalize(c)));
    if (isFooterRow && !rowPeriods) continue;

    /* 既没有行首节次、也没有任何单元格自带节次标记的行，不是数据行
       （正常数据行必然有其一；两者都没有的多半是标题/说明残留） */
    const hasPeriodMarker = Object.keys(layout.weekdayCols).some((k) => {
      const t = gridNormalize(row[layout.weekdayCols[k]] || '');
      return t.split('\n').some((line) => isPeriodLine(line.trim()));
    });
    if (!firstCell && !rowPeriods && !hasPeriodMarker) continue;

    rawRows++;

    let rowHadCourse = false;

    for (const wdKey of Object.keys(layout.weekdayCols)) {
      const weekday = Number(wdKey);
      const colIdx = layout.weekdayCols[wdKey];
      const cellText = gridNormalize(row[colIdx] || '');
      if (!cellText.trim()) continue;

      for (const block of splitGridBlocks(cellText)) {
        const course = parseGridBlock(block, weekday, rowPeriods);
        if (!course) {
          skippedRows++;
          continue;
        }
        validRows++;
        rowHadCourse = true;

        const mergeKey = `${course.name}|${course.weekday}|${course.periods.join(',')}|${course.location || ''}`;
        if (merged.has(mergeKey)) {
          const draft = merged.get(mergeKey);
          for (const w of course.weeks) if (!draft.weeks.includes(w)) draft.weeks.push(w);
          if (!draft.teacher && course.teacher) draft.teacher = course.teacher;
        } else {
          const base = 'c' + gridHash(mergeKey).toString(36);
          let id = base;
          let n = 2;
          while (usedIds.has(id)) { id = `${base}-${n}`; n++; }
          usedIds.add(id);
          merged.set(mergeKey, {
            id,
            name: course.name,
            weekday: course.weekday,
            periods: course.periods.slice(),
            weeks: course.weeks.slice(),
            location: course.location || '',
            teacher: course.teacher || '',
          });
        }
      }
    }
    if (!rowHadCourse) { /* 节次行没有课是正常的（空白时段），不计入跳过 */ }
  }

  if (merged.size === 0) {
    return {
      ok: false,
      error: {
        code: 'ZERO_RECORDS',
        message: `认出了星期表头，但没能从 ${rawRows} 行里解析出任何一门课。可能这份课表的格子内容和常见格式不一样。`,
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
    if (draft.location) course.location = draft.location;
    if (draft.teacher) course.teacher = draft.teacher;
    return course;
  });

  courses.sort((a, b) =>
    a.weekday - b.weekday || a.periods[0] - b.periods[0] || (a.name < b.name ? -1 : 1));

  return {
    ok: true,
    courses,
    stats: { format: 'grid', rawRows, validRows, skippedRows },
  };
}

/* Node 单测入口：浏览器里 module 未定义，这段不执行 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseGridTable,
    detectGridLayout,
    parseGridWeekday,
    parseGridWeeks,
    parseGridPeriods,
    splitGridBlocks,
    parseGridBlock,
  };
}
