/* ============================================================
   ui-import.js —— 导入页交互（Day 25 重写 · T3 接线完成 · Day 29 多格式）
   对应：PRD V2.1 / V2.2 / V2.3，F1「解析结果先预览、确认后才替换」

   真实流程：
     选文件 → 读字节 → 判断文件类型 → 交给对应解析器（纯前端，不上传）
       ├─ 失败（分类错误码）→ 状态弹窗说明原因，回到可重选状态
       └─ 成功 → V2.2 预览区：统计 + 课程卡片 +「保存并使用」
            → GET 云端课表：有数据才弹「将替换现有课表」确认
            → 规模预检（契约 3.3：≤500 门、≤512KB，超限不发请求）
            → POST /api/courses/import（整体替换）
            → 成功弹窗（报服务端实数）→ 回首页自动拉新数据

   Day 29 新增「多格式」，因为不同学校的导出文件差别很大：
     · 文本类（.htm/.html，以及伪装成 .xls 的网页格式）→ 读成文本
         → 先按列表式解析（parser.js）
         → 不行再把里面的表格转成二维数组，按网格式解析（grid-parser.js）
     · 二进制类（真正的 .xls 是 OLE2 容器、.xlsx 是 zip 包）→ 交给 SheetJS 读成二维数组
         → 有星期表头 → 网格式
         → 有「课程名称」表头 → 转成等价 HTML 表格后复用列表式解析
     这样「两种文件容器 × 两种表结构」的四种组合都能覆盖。

   隐私口径（页面文案同步）：文件只在本机解析，确认保存前不上传。
   ============================================================ */

/** 星期名：与 ui-home.js 同一份（1 = 周一）。两页各放一份是现状的最小改动。 */
const IMPORT_WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/* 云函数公网地址：与 ui-home.js 的 API_BASE_URL 同值（两页各放一份，最小改动）。
   跨域由网关侧 CORS 白名单放行（含本地调试 http://127.0.0.1:8012），
   禁止 * 通配符（Day 20 拍板），本文件不写任何自定义 CORS 头。 */
const IMPORT_API_BASE_URL =
  'https://wg-kechengbiao-d9gi92b9ma9e7f71c-1501303146.ap-shanghai.app.tcloudbase.com';

/* 接口规模上限（api-contract.md 3.3）：前端先拦，超限不发请求 */
const IMPORT_MAX_COURSES = 500;
const IMPORT_MAX_BODY_BYTES = 512 * 1024;

/* 保存成功后停留多久跳回首页：太短看不清成功提示，太长像卡死 */
const SAVE_REDIRECT_DELAY_MS = 1500;

/* ============================================================
   Day 29：文件类型识别与读取
   为什么不只看扩展名：教务系统导出的「.xls」有两种完全不同的东西——
     ① 真正的 Excel 二进制文件，文件头是 OLE2 容器标识 D0 CF 11 E0；
     ② Excel「网页格式」导出的 HTML 文本，只是借用了 .xls 后缀。
   按内容判断，扩展名只当参考。
   ============================================================ */

/** 返回 'ole2'（老式 .xls）| 'zip'（.xlsx，本质是 zip 包）| 'text'（HTML/CSV/纯文本） */
function sniffImportFileKind(bytes) {
  if (bytes.length >= 8 &&
      bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) {
    return 'ole2';
  }
  if (bytes.length >= 4 &&
      bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return 'zip';
  }
  return 'text';
}

/**
 * 字节 → 文本。先按 UTF-8 严格解码，失败再退回 GBK。
 * 为什么要退回：部分学校的导出文件是 GBK 编码，硬按 UTF-8 解会得到乱码，
 * 表头认不出来，报错却说是「不是课表文件」，用户会一头雾水。
 */
function decodeImportText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (e) {
    try {
      return new TextDecoder('gbk').decode(buffer);
    } catch (e2) {
      return new TextDecoder('utf-8').decode(buffer);
    }
  }
}

/**
 * HTML 文本 → 二维数组（取页面里第一张表）。
 * 关键细节：单元格里的 <br> 要还原成换行符。网格式课表靠换行分隔
 * 「课程名/教师/周次/地点/节次」，直接读 textContent 会把它们粘成一串。
 */
function htmlTableToRows(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  return [...table.querySelectorAll('tr')].map((tr) =>
    [...tr.querySelectorAll('td, th')].map((cell) => {
      const clone = cell.cloneNode(true);
      clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
      return clone.textContent.replace(/\u00a0/g, ' ');
    })
  );
}

/**
 * 二维数组 → 等价 HTML 表格字符串。
 * 用途：二进制文件里如果是「列表式」表头，零成本复用已经测过的 parseCourseTable，
 * 不必为「xlsx 里的列表式」再写一套重复逻辑。
 */
function rowsToHtmlTable(rows) {
  const esc = (s) => escapeImportHtml(String(s == null ? '' : s)).replace(/\n/g, '<br>');
  const body = rows
    .map((r) => '<tr>' + (r || []).map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>')
    .join('');
  return '<table>' + body + '</table>';
}

/**
 * 二维数组 → 解析结果。先认网格式（有星期表头），再退列表式。
 * 顺序不能反：列表式的表格里也可能出现「课程名称」字样，
 * 但「星期一…星期日」连着出现是网格式独有的强特征，先判它更准。
 */
function parseRowsAnyFormat(rows) {
  if (typeof detectGridLayout === 'function' && detectGridLayout(rows)) {
    return parseGridTable(rows);
  }
  return parseCourseTable(rowsToHtmlTable(rows));
}

/* ============================================================
   Day 29 · 方案 D：手动指定列
   ------------------------------------------------------------
   为什么要它：别名表再全也穷举不完各校的表头写法。与其让用户
   卡在「导入失败」，不如把表格摆出来让他自己指认——人扫一眼
   就知道哪列是课程名，程序反而要猜半天。

   关键设计（复用而不是重写）：
     用户选定「哪列是什么」之后，程序并不另写一套解析逻辑，
     而是把表头行**改写成标准字段名**（课程名称/周次/星期/节次…），
     再把其余表头单元格清空防误匹配，最后交给已经测过的
     parseCourseTable 去跑。合并规则、容错、错误码全部自动复用。
   ============================================================ */

/* 手动映射界面上列出的字段（顺序即界面顺序） */
const MANUAL_FIELDS = [
  { key: 'name', label: '课程名称', required: true },
  { key: 'weeks', label: '周次', required: true },
  { key: 'weekday', label: '星期', required: true },
  { key: 'periods', label: '节次', required: true },
  { key: 'location', label: '上课地点', required: false },
  { key: 'teacher', label: '教师', required: false },
];

/* 预览表格最多显示多少行 / 多少列：手机屏放不下更多，也没必要 */
const MANUAL_PREVIEW_ROWS = 8;
const MANUAL_PREVIEW_COLS = 12;

/** 表头行里各字段应改写成什么（必须与 parser.js 的别名表能对上） */
const MANUAL_CANONICAL_LABELS = {
  name: '课程名称',
  weeks: '周次',
  weekday: '星期',
  periods: '节次',
  location: '上课地点',
  teacher: '教师',
};

/** 取单元格纯文本（去掉换行与多余空格，避免撑爆表格） */
function manualCellText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

/**
 * 安全滚动到某个区块。
 * 为什么要判一下：jsdom 等测试环境不实现 scrollIntoView，
 * 直接调用会抛异常，把后面的渲染逻辑一起带崩。
 */
function safeScrollIntoView(el) {
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/**
 * 猜表头在第几行：拿别名表逐行打分，命中字段最多的那行胜出。
 * 命中不足 2 个字段就认为「猜不出」，退回第 1 行让用户自己选。
 */
function guessHeaderRowIndex(rows) {
  let best = 0;
  let bestScore = 0;
  const limit = Math.min(rows.length, 15);
  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] || []).map(manualCellText);
    const used = new Set();
    let score = 0;
    for (const field of PARSER_HEADER_FIELDS) {
      const idx = findFieldColumn(cells, field.aliases, used);
      if (idx >= 0) { used.add(idx); score++; }
    }
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return bestScore >= 2 ? best : 0;
}

/** 表格宽度：取前 10 行里最长的那行，封顶 MANUAL_PREVIEW_COLS */
function manualTableWidth(rows) {
  let width = 0;
  for (const row of rows.slice(0, 10)) {
    if (row && row.length > width) width = row.length;
  }
  return Math.min(width, MANUAL_PREVIEW_COLS);
}

/**
 * 按用户选择重新组装成一张「表头被改写」的表格 HTML。
 * 其余表头单元格一律清空：防止「课程性质」这类列被别名误匹配上。
 */
function buildMappedCourseTableHtml(rows, headerIndex, mapping) {
  const width = Math.max(manualTableWidth(rows), 1);
  const cloned = rows.map((r) => (r || []).slice());

  const header = new Array(width).fill('');
  for (const key of Object.keys(MANUAL_CANONICAL_LABELS)) {
    const col = mapping[key];
    if (typeof col === 'number' && col >= 0 && col < width) {
      header[col] = MANUAL_CANONICAL_LABELS[key];
    }
  }
  cloned[headerIndex] = header;
  return rowsToHtmlTable(cloned);
}

/** 渲染预览表格：首列是行号，被判定为表头的那一行高亮 */
function renderManualTable(tableEl, rows, headerIdx) {
  const width = manualTableWidth(rows);
  let html = '<tr><th>行</th>';
  for (let c = 0; c < width; c++) html += `<th>第${c + 1}列</th>`;
  html += '</tr>';

  const limit = Math.min(rows.length, MANUAL_PREVIEW_ROWS);
  for (let r = 0; r < limit; r++) {
    const cls = r === headerIdx ? ' class="is-header"' : '';
    html += `<tr${cls}><td>${r + 1}</td>`;
    for (let c = 0; c < width; c++) {
      html += `<td>${escapeImportHtml(manualCellText((rows[r] || [])[c]))}</td>`;
    }
    html += '</tr>';
  }
  tableEl.innerHTML = html;
}

/**
 * 渲染字段下拉框。先用别名表猜一遍并预选——猜对用户直接点确认，
 * 猜错也只是改几个下拉，比从零开始选省事。
 */
function renderManualFields(container, rows, headerIdx) {
  const width = manualTableWidth(rows);
  const headerCells = (rows[headerIdx] || []).map(manualCellText);

  const used = new Set();
  const guessed = {};
  for (const field of MANUAL_FIELDS) {
    const aliasDef = PARSER_HEADER_FIELDS.find((f) => f.key === field.key);
    if (!aliasDef) continue;
    const idx = findFieldColumn(headerCells, aliasDef.aliases, used);
    if (idx >= 0) { guessed[field.key] = idx; used.add(idx); }
  }

  container.innerHTML = MANUAL_FIELDS.map((field) => {
    const options = ['<option value="-1">（不指定）</option>'];
    for (let c = 0; c < width; c++) {
      const head = headerCells[c] ? '：' + headerCells[c].slice(0, 10) : '';
      const selected = guessed[field.key] === c ? ' selected' : '';
      options.push(`<option value="${c}"${selected}>第${c + 1}列${escapeImportHtml(head)}</option>`);
    }
    const reqClass = field.required ? ' manual-field__label--required' : '';
    return (
      '<div class="manual-field">' +
      `<label class="manual-field__label${reqClass}" for="manual-field-${field.key}">${field.label}</label>` +
      `<select class="manual-field__select" id="manual-field-${field.key}" data-field="${field.key}">` +
      options.join('') +
      '</select></div>'
    );
  }).join('');
}

/**
 * 文件 → 解析结果（Promise）。全流程在本机完成，不发网络请求。
 * 返回结构与 parser.js / grid-parser.js 一致：{ ok, courses, stats } 或 { ok, error }
 * 解析失败时若已读出表格，会附带 rows —— 手动指定列（方案 D）要用。
 */
function parseCourseFile(file) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    const kind = sniffImportFileKind(bytes);

    /* ---- 二进制 Excel：交给 SheetJS ---- */
    if (kind === 'ole2' || kind === 'zip') {
      if (typeof XLSX === 'undefined') {
        return {
          ok: false,
          error: { code: 'LIB_MISSING', message: '课表解析组件没加载成功，请刷新页面重试。' },
        };
      }
      let workbook;
      try {
        workbook = XLSX.read(bytes, { type: 'array' });
      } catch (e) {
        console.error('[导入] 工作簿读取失败：', e);
        return {
          ok: false,
          error: {
            code: 'NOT_COURSE_FILE',
            message: '这个 Excel 文件打不开，可能已损坏或加了密码，请重新导出一次。',
          },
        };
      }
      /* 多个工作表的文件：逐个试，第一个能解析出课程的胜出 */
      let lastResult = null;
      let firstRows = null;
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
        if (!rows.length) continue;
        if (!firstRows) firstRows = rows;
        const result = parseRowsAnyFormat(rows);
        if (result.ok) return result;
        lastResult = result;
      }
      if (lastResult && firstRows) lastResult.rows = firstRows;
      return lastResult || {
        ok: false,
        error: { code: 'FILE_EMPTY', message: '这个 Excel 文件里没有任何内容。' },
      };
    }

    /* ---- 文本：先试列表式，再试 HTML 里的网格式 ---- */
    const text = decodeImportText(buffer);
    const listResult = parseCourseTable(text);
    if (listResult.ok) return listResult;

    const rows = htmlTableToRows(text);
    if (rows && rows.length) {
      const gridResult = parseRowsAnyFormat(rows);
      if (gridResult.ok) return gridResult;
    }
    /* 两种都不成：返回列表式那边的报错（文案更贴近「该去教务系统怎么导出」），
       同时把表格带上——手动指定列（方案 D）需要它 */
    if (rows && rows.length) listResult.rows = rows;
    return listResult;
  });
}

/**
 * 转义 HTML 特殊字符。课程名/地点来自用户文件，插进 innerHTML 前必须过这道。
 * 与 ui-home.js 的同名函数同一实现；不跨页抽公共文件是为了不动首页脚本（最小改动）。
 */
function escapeImportHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 节次显示：periods 已是升序数字数组（解析器保证）。
 * 连续 → 「6–7 节」；跳节 → 「1,3 节」；单节 → 「8 节」。
 */
function formatImportPeriods(periods) {
  if (periods.length === 1) {
    return `第${periods[0]}节`;
  }
  const isConsecutive = periods[periods.length - 1] - periods[0] === periods.length - 1;
  return isConsecutive
    ? `第${periods[0]}–${periods[periods.length - 1]}节`
    : `第${periods.join(',')}节`;
}

/**
 * 周次集合显示：连续段压缩（[1,2,3,4] → 「1–4」，[1,5,9,13] → 「1,5,9,13」）。
 * 解析出来的周次经常是不规则集合（research.md 4.3 的坑 2），不压缩会很长。
 */
function formatImportWeeks(weeks) {
  const parts = [];
  let start = weeks[0];
  let prev = weeks[0];
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i] === prev + 1) {
      prev = weeks[i];
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = prev = weeks[i];
  }
  parts.push(start === prev ? `${start}` : `${start}–${prev}`);
  return parts.join(',');
}

/** 一门课 → 一张预览卡片。DOM 结构与首页课程卡片同构（course-card 系列），无状态标签无花色。 */
function renderImportPreviewCard(course) {
  const metaParts = [
    IMPORT_WEEKDAY_NAMES[course.weekday - 1],
    formatImportPeriods(course.periods),
    course.location || '—',
  ];
  if (course.teacher) {
    metaParts.push(course.teacher);   // 教师为空留空，不放占位符（PRD 5.1）
  }
  metaParts.push(`第${formatImportWeeks(course.weeks)}周`);
  return (
    `<article class="course-card">` +
    `<div class="course-card__main">` +
    `<p class="course-card__name">${escapeImportHtml(course.name)}</p>` +
    `<p class="course-card__meta">${escapeImportHtml(metaParts.join(' · '))}</p>` +
    `</div></article>`
  );
}

function setupImportPage() {
  /* Day 25：导入必须有口令——导入的目标就是「这个口令名下的课表」，
     没口令连「替换谁」都不知道，直接去入口页（契约 2.5） */
  if (!getScheduleCode()) {
    window.location.replace('./entry.html');
    return;
  }

  const selectBtn = document.getElementById('import-select-btn');
  const fileInput = document.getElementById('import-file-input');
  const previewSection = document.getElementById('import-preview');
  const statsEl = document.getElementById('import-preview-stats');
  const listEl = document.getElementById('import-preview-list');
  const saveBtn = document.getElementById('import-save-btn');
  const reselectBtn = document.getElementById('import-reselect-btn');
  /* 手动指定列（方案 D）的元素：缺了也不影响主流程，只是没有兜底 */
  const manualSection = document.getElementById('import-manual');
  const manualTip = document.getElementById('import-manual-tip');
  const headerRowSelect = document.getElementById('manual-header-row');
  const manualTable = document.getElementById('manual-table');
  const manualFields = document.getElementById('manual-fields');
  const manualParseBtn = document.getElementById('manual-parse-btn');
  const manualCancelBtn = document.getElementById('manual-cancel-btn');
  /* 页面骨架没到位就不绑（比如将来 HTML 改版漏了 id），不让脚本报错 */
  if (!selectBtn || !fileInput || !previewSection || !saveBtn) {
    return;
  }

  /* 解析期间的防连点：disabled 管 UI，isParsing 标志管逻辑（双保险，Day 11 惯例） */
  let isParsing = false;
  /* 保存/检查期间的防连点：与 isParsing 分开——解析和保存是两个互不重叠的阶段 */
  let isSaving = false;
  /* 当前解析结果：保存时从这里取，避免再读一遍文件 */
  let currentParsed = null;

  /* ---------- 手动指定列（Day 29 · 方案 D） ---------- */
  /* 自动解析失败时留住的表格数据，供手动指定列使用 */
  let manualRows = null;

  /** 展开手动映射区：填表头行选项、画预览表、生成字段下拉 */
  function openManualMapping(rows, reason) {
    if (!manualSection || !manualTable || !manualFields || !headerRowSelect) return;
    manualRows = rows;
    manualSection.hidden = false;
    if (manualTip && reason) manualTip.textContent = reason;

    const guess = guessHeaderRowIndex(rows);
    const maxHeader = Math.min(rows.length, 12);
    headerRowSelect.innerHTML = '';
    for (let i = 0; i < maxHeader; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `第 ${i + 1} 行`;
      headerRowSelect.appendChild(opt);
    }
    headerRowSelect.value = String(guess);
    renderManualTable(manualTable, rows, guess);
    renderManualFields(manualFields, rows, guess);
    safeScrollIntoView(manualSection);
  }

  function closeManualMapping() {
    if (manualSection) manualSection.hidden = true;
    manualRows = null;
  }

  /** 读取 6 个下拉框当前的选择，返回 { name: 列下标, ... }（-1 = 不指定） */
  function collectManualMapping() {
    const mapping = {};
    for (const field of MANUAL_FIELDS) {
      const el = document.getElementById(`manual-field-${field.key}`);
      mapping[field.key] = el ? Number(el.value) : -1;
    }
    return mapping;
  }

  if (headerRowSelect) {
    headerRowSelect.addEventListener('change', () => {
      if (!manualRows) return;
      const idx = Number(headerRowSelect.value) || 0;
      renderManualTable(manualTable, manualRows, idx);
      renderManualFields(manualFields, manualRows, idx);
    });
  }

  if (manualCancelBtn) {
    manualCancelBtn.addEventListener('click', closeManualMapping);
  }

  if (manualParseBtn) {
    manualParseBtn.addEventListener('click', () => {
      if (!manualRows) return;
      const mapping = collectManualMapping();

      const missing = MANUAL_FIELDS
        .filter((f) => f.required && mapping[f.key] < 0)
        .map((f) => f.label);
      if (missing.length) {
        showStatusModal({
          type: 'error',
          title: '还差几列没指定',
          desc: `请指定：${missing.join('、')}。这几列缺一不可。`,
        });
        return;
      }

      const cols = MANUAL_FIELDS.map((f) => mapping[f.key]).filter((c) => c >= 0);
      if (new Set(cols).size !== cols.length) {
        showStatusModal({
          type: 'error',
          title: '有两项选了同一列',
          desc: '每个字段要对应不同的列，请检查后再试。',
        });
        return;
      }

      const headerIdx = Number(headerRowSelect.value) || 0;
      const html = buildMappedCourseTableHtml(manualRows, headerIdx, mapping);
      const result = parseCourseTable(html);

      if (!result.ok) {
        showStatusModal({
          type: 'error',
          title: '还是没解析出来',
          desc: result.error.message + ' 也可能是表头行选错了，或者这张表不是「一行一节课」。',
        });
        return;
      }

      closeStatusModal();
      closeManualMapping();
      currentParsed = result;
      renderPreview(result);
    });
  }

  function openFilePicker() {
    fileInput.click();
  }

  selectBtn.addEventListener('click', openFilePicker);
  reselectBtn.addEventListener('click', openFilePicker);

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    /* 先清空选择：不清的话，下次选同一个文件不会触发 change */
    fileInput.value = '';
    if (!file || isParsing) {
      /* 没选文件 = 用户取消了选择框：回到原状，什么都不弹 */
      return;
    }

    isParsing = true;
    selectBtn.disabled = true;
    showStatusModal({
      type: 'loading',
      title: '正在解析课表…',
      desc: file.name,
    });

    /* 文件在浏览器本地读完就地解析，全程无网络请求（隐私口径见文件头） */
    parseCourseFile(file)
      .then((result) => {
        isParsing = false;
        selectBtn.disabled = false;

        if (!result.ok) {
          /* 已经读出表格 → 直接进「手动指定列」，不让用户卡在失败里；
             连表格都没读出来（空文件 / 乱码 / 打不开）→ 只能弹窗说明原因 */
          if (result.rows && result.rows.length) {
            closeStatusModal();
            openManualMapping(
              result.rows,
              `自动识别没成功：${result.error.message} 下面是文件里的前几行，请告诉我每一列是什么。`
            );
            return;
          }
          showStatusModal({
            type: 'error',
            title: '解析失败',
            desc: result.error.message,
          });
          return;
        }

        /* V2.2：解析成功 → 预览区。弹窗先关，页面本身展示结果。 */
        closeStatusModal();
        closeManualMapping();
        currentParsed = result;
        renderPreview(result);
      })
      .catch((err) => {
        /* file.text() 本身失败（文件读不了、编码异常等极少数情况） */
        isParsing = false;
        selectBtn.disabled = false;
        showStatusModal({
          type: 'error',
          title: '解析失败',
          desc: `文件读取失败（${err && err.message ? err.message : '未知原因'}），请重新导出一次。`,
        });
      });
  });

  /** 把解析结果铺进预览区：统计行 + 卡片列表 + 保存按钮 */
  function renderPreview(result) {
    const { courses, stats } = result;
    /* 让学生知道走的是哪条解析路径：两种布局的失败形态不同，排查问题要用到 */
    const formatLabel = stats.format === 'grid' ? '表格布局' : '列表布局';
    const statLines = [`已识别为${formatLabel}课表：共解析出 ${courses.length} 门课` +
      `（原始 ${stats.rawRows} 行，跳过无效 ${stats.skippedRows} 行）`];
    if (stats.firstScheduleDate) {
      statLines.push(`排课日期从 ${stats.firstScheduleDate} 开始，` +
        `如与学期第一周不一致，请到设置页核对起始日期。`);
    }
    statsEl.textContent = statLines.join('。');

    listEl.innerHTML = courses.map(renderImportPreviewCard).join('');
    previewSection.hidden = false;
    saveBtn.hidden = false;
    /* 重新解析成功时把预览区滚到眼前，手机上不滚看不到结果 */
    safeScrollIntoView(previewSection);
  }

  saveBtn.addEventListener('click', () => {
    if (!currentParsed || currentParsed.courses.length === 0 || isSaving) {
      return;
    }
    /* 先问云端有没有课表：有 → 二次确认（PRD V2.2 / A6：替换要先打招呼）；
       没有（第一次导入）→ 没东西可替换，不弹确认直接保存。 */
    isSaving = true;
    saveBtn.disabled = true;
    showStatusModal({ type: 'loading', title: '正在检查现有课表…' });
    fetchExistingCount()
      .then((count) => {
        isSaving = false;
        saveBtn.disabled = false;
        closeStatusModal();
        if (count > 0) {
          showConfirmModal({
            title: '将替换现有课表',
            desc: `云端已有 ${count} 门课。保存后会被整体替换为本次解析出的 ` +
              `${currentParsed.courses.length} 门课，原课表不可从本页恢复。`,
            confirmText: '确认替换',
            onConfirm: () => saveCourses(currentParsed.courses),
          });
        } else {
          saveCourses(currentParsed.courses);
        }
      })
      .catch((err) => {
        /* 检查失败就停下：连「云端有什么」都读不到，保存更不该开始 */
        isSaving = false;
        saveBtn.disabled = false;
        showSaveError(err, '没能读到现有课表，未做任何修改，请稍后再试。');
      });
  });

  /**
   * GET /api/courses?code=口令 → 云端该口令名下的课程条数。
   * Day 25：404 SCHEDULE_NOT_FOUND 是正常业务态（新课表/还没导入），返回 0，
   *   让「首次导入不弹确认」的分支自然生效——不是错误，不能 reject。
   * 其余错误处理与 ui-home.js 的 readLocalData 同口径：
   * 网络层失败 NETWORK_ERROR、非 2xx 透传服务端错误码、包络形状不对 DATA_CORRUPT。
   */
  function fetchExistingCount() {
    const requestUrl = apiUrlWithCode(`${IMPORT_API_BASE_URL}/api/courses`);
    if (!requestUrl) {
      return Promise.reject({ code: 'MISSING_CODE' });
    }
    let resp;
    return fetch(requestUrl)
      .catch((err) => {
        console.error('[导入] 现有课表查询失败：', err);
        return Promise.reject({ code: 'NETWORK_ERROR', cause: err });
      })
      .then((r) => {
        resp = r;
        /* 新课表：404 SCHEDULE_NOT_FOUND = 该口令名下还没有课程，就是 0 门，
           不是错误（Day 25：替换范围收窄到口令后，新课表 GET 必然 404） */
        if (resp.status === 404) {
          return { ok: true, data: { courses: [] } };
        }
        if (!resp.ok) {
          /* 读得到包络就透传错误码；读不到（如平台层 450 空响应体）按服务器错误 */
          return resp
            .json()
            .then((errBody) => {
              const code = errBody && errBody.error && errBody.error.code
                ? errBody.error.code
                : 'SERVER_ERROR';
              return Promise.reject({ code, status: resp.status });
            })
            .catch((err) => {
              if (err && err.code) {
                return Promise.reject(err);   // 上面主动 reject 的，原样透传
              }
              return Promise.reject({ code: 'SERVER_ERROR', status: resp.status });
            });
        }
        return resp.json();
      })
      .then((body) => {
        if (!body || body.ok !== true || !body.data || !Array.isArray(body.data.courses)) {
          return Promise.reject({ code: 'DATA_CORRUPT' });
        }
        return body.data.courses.length;
      });
  }

  /**
   * 保存主流程：规模预检 → POST /api/courses/import（整体替换）→ 成功跳首页。
   * 请求体形状严格按 api-contract.md 3.3；成功/失败反馈走统一状态弹窗（Day 23 口径）。
   */
  function saveCourses(courses) {
    /* 前端规模预检：超限直接报错不发请求（服务端有同样的上限，这里省一次白跑） */
    const bodyText = JSON.stringify({ courses });
    if (courses.length > IMPORT_MAX_COURSES) {
      showSaveError(
        { code: 'TOO_MANY_COURSES' },
        `本次解析出 ${courses.length} 门课，超过单批 ${IMPORT_MAX_COURSES} 门上限，未保存。`
      );
      return;
    }
    if (bodyText.length > IMPORT_MAX_BODY_BYTES) {
      showSaveError(
        { code: 'BODY_TOO_LARGE' },
        '课表数据超过 512KB 上限，未保存。请确认导出的是课表列表而不是整页网站文件。'
      );
      return;
    }

    isSaving = true;
    saveBtn.disabled = true;
    showStatusModal({
      type: 'loading',
      title: '正在保存课表…',
      desc: `共 ${courses.length} 门课，保存后返回首页`,
    });

    let resp;
    /* Day 25：POST 也带口令——替换的就是这个口令名下的课表（契约 3.3） */
    const postUrl = apiUrlWithCode(`${IMPORT_API_BASE_URL}/api/courses/import`);
    if (!postUrl) {
      showSaveError({ code: 'MISSING_CODE' }, '请先到「换课表」页设置口令。');
      return;
    }
    fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyText,
    })
      .catch((err) => {
        console.error('[导入] 保存请求失败：', err);
        return Promise.reject({ code: 'NETWORK_ERROR', cause: err });
      })
      .then((r) => {
        resp = r;
        if (!resp.ok) {
          /* 服务端拒绝（如 BAD_REQUEST）会把中文原因写进包络，透传给用户 */
          return resp
            .json()
            .then((errBody) => {
              const code = errBody && errBody.error && errBody.error.code
                ? errBody.error.code
                : 'SERVER_ERROR';
              const message = errBody && errBody.error && errBody.error.message
                ? errBody.error.message
                : '';
              return Promise.reject({ code, message, status: resp.status });
            })
            .catch((err) => {
              if (err && err.code) {
                return Promise.reject(err);
              }
              return Promise.reject({ code: 'SERVER_ERROR', status: resp.status });
            });
        }
        return resp.json();
      })
      .then((body) => {
        if (!body || body.ok !== true || typeof body.data.imported !== 'number') {
          return Promise.reject({ code: 'DATA_CORRUPT' });
        }
        isSaving = false;
        /* 成功：报实数（以服务端实际写入为准），停留片刻让用户看见，再回首页。
           首页加载时会重新拉取云端数据，新课表自然出现。 */
        showStatusModal({
          type: 'success',
          title: `保存成功，已导入 ${body.data.imported} 门课`,
          desc: '即将返回首页…',
        });
        setTimeout(() => {
          window.location.assign('./index.html');
        }, SAVE_REDIRECT_DELAY_MS);
      })
      .catch((err) => {
        isSaving = false;
        saveBtn.disabled = false;
        showSaveError(err, '课表没有保存，现有数据未受影响。');
      });
  }

  /** 保存/检查失败的统一出口：发生了什么 + 现状如何 + 怎么办（不让用户猜） */
  function showSaveError(err, context) {
    /* 口令没了（被别的页清除）：弹错误没有意义，直接送回入口页补口令 */
    if (err && err.code === 'MISSING_CODE') {
      window.location.replace('./entry.html');
      return;
    }
    closeStatusModal();
    const code = err && err.code ? err.code : 'UNKNOWN';
    const detail = err && err.message ? err.message : '';
    let reason;
    if (code === 'NETWORK_ERROR') {
      reason = '网络连不上服务器';
    } else if (code === 'SERVER_ERROR' || code === 'DATA_CORRUPT') {
      reason = '服务器返回了异常结果';
    } else if (detail) {
      reason = detail;   // 服务端明确给了中文原因（如 BAD_REQUEST 指明第几条错什么）
    } else {
      reason = '发生未知错误';
    }
    showStatusModal({
      type: 'error',
      title: '保存失败',
      desc: `${reason}。${context}`,
    });
  }
}

/* 本脚本在 body 底部加载，执行到这里时 DOM 已就绪，直接初始化 */
setupImportPage();
