/* ============================================================
   tools/test-manual-mapping.js —— 手动指定列端到端测试（Day 29 · 方案 D）
   ------------------------------------------------------------
   造一份「表头完全没有可识别字样」的课表，验证三件事：
     ① 自动识别失败后，页面进入手动指定列，而不是卡在报错
     ② 表格预览能正常显示，表头行可以改
     ③ 用户指定列之后，能正确解析出课程（含周次合并）

   用法：node tools/test-manual-mapping.js
   前置：本地静态服务器（默认 http://127.0.0.1:8021）
   ============================================================ */

const path = require('path');
const { JSDOM } = require('jsdom');

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8021';

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n      期望 ${e}\n      实际 ${a}`); }
}

/* 表头用「甲乙丙丁戊己」，不含任何可识别别名——模拟陌生学校的导出格式。
   第一行是标题行，表头在第二行，用来验证「表头在第几行」这个开关。 */
const HTML = `
<html><body><table>
  <tr><td>某某大学 学生个人课表</td></tr>
  <tr><td>甲</td><td>乙</td><td>丙</td><td>丁</td><td>戊</td><td>己</td></tr>
  <tr><td>高等数学</td><td>1-8</td><td>1</td><td>0102</td><td>教1-101</td><td>张三</td></tr>
  <tr><td>高等数学</td><td>9-16</td><td>1</td><td>0102</td><td>教1-101</td><td>张三</td></tr>
  <tr><td>大学英语</td><td>1-16</td><td>3</td><td>0304</td><td>教2-202</td><td>李四</td></tr>
</table></body></html>`;

(async () => {
  const dom = await JSDOM.fromURL(`${BASE}/import.html`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.resolve({
        ok: false, status: 404, json: () => Promise.resolve({}),
      });
      window.__errors = [];
      window.addEventListener('error', (e) => window.__errors.push(String(e.message || e)));
    },
  });

  const { window } = dom;
  const { document } = window;

  await new Promise((resolve) => {
    if (document.readyState === 'complete') return resolve();
    window.addEventListener('load', resolve);
  });
  await new Promise((r) => setTimeout(r, 300));

  /* 口令（同 test-import-e2e 的理由：jsdom 的 beforeParse 写不进 localStorage） */
  if (!window.getScheduleCode || !window.getScheduleCode()) {
    window.localStorage.setItem('wg-schedule-code', 'ABCDEF');
    if (typeof window.setupImportPage === 'function') window.setupImportPage();
  }

  console.log('【一】塞入一份表头不可识别的文件');
  const bytes = Buffer.from(HTML, 'utf8');
  const input = document.getElementById('import-file-input');
  Object.defineProperty(input, 'files', {
    value: [{ name: '陌生格式课表.xls', arrayBuffer: () => Promise.resolve(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    ) }],
    configurable: true,
  });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));

  /* 等手动映射区出现 */
  const manualSection = document.getElementById('import-manual');
  const started = Date.now();
  while (Date.now() - started < 8000 && manualSection.hidden) {
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log('【二】自动识别失败后进入手动映射');
  check('手动映射区已展开', manualSection.hidden, false);
  check('提示里说明了原因', /自动识别没成功/.test(document.getElementById('import-manual-tip').textContent), true);
  check('没有残留错误弹窗挡住', !!document.querySelector('.modal.is-visible, .app-modal.is-visible'), false);
  const previewRows = document.querySelectorAll('#manual-table tr');
  /* 1 行「列标题」+ 5 行文件内容（1 标题行 + 1 表头行 + 3 数据行）= 6 */
  check('预览表格行数（列标题 1 + 内容 5）', previewRows.length, 6);
  check('表头行选项数（对应文件 5 行）', document.getElementById('manual-header-row').options.length, 5);

  console.log('【三】把表头行改到第 2 行');
  const headerSelect = document.getElementById('manual-header-row');
  headerSelect.value = '1';
  headerSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  const highlighted = document.querySelectorAll('#manual-table tr.is-header');
  check('第 2 行被标为表头', highlighted.length, 1);
  check('高亮的是第 2 行', highlighted[0] && highlighted[0].firstChild.textContent, '2');

  console.log('【四】手动指定六列');
  const mapping = { name: 0, weeks: 1, weekday: 2, periods: 3, location: 4, teacher: 5 };
  for (const [key, col] of Object.entries(mapping)) {
    const sel = document.getElementById(`manual-field-${key}`);
    check(`${key} 下拉框存在`, !!sel, true);
    sel.value = String(col);
  }

  console.log('【五】先验证「漏填必需列」会被拦住');
  const periodsSel = document.getElementById('manual-field-periods');
  periodsSel.value = '-1';
  document.getElementById('manual-parse-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  check('缺节次时预览区没出现', document.getElementById('import-preview').hidden, true);

  console.log('【六】补齐后解析');
  periodsSel.value = '3';
  document.getElementById('manual-parse-btn').dispatchEvent(new window.Event('click', { bubbles: true }));

  const startedParse = Date.now();
  while (Date.now() - startedParse < 5000 && document.getElementById('import-preview').hidden) {
    await new Promise((r) => setTimeout(r, 100));
  }

  const statsText = document.getElementById('import-preview-stats').textContent;
  const cards = document.querySelectorAll('#import-preview-list .course-card');
  check('预览区已显示', document.getElementById('import-preview').hidden, false);
  check('解析出 2 门课（两条高数按周次合并）', cards.length, 2);
  check('统计行报 2 门课', /2 门课/.test(statsText), true);
  check('手动映射区已收起', manualSection.hidden, true);

  const cardTexts = [...cards].map((c) => c.textContent.replace(/\s+/g, ' ').trim());
  check('高数周次合并成 1–16', /第1–16周/.test(cardTexts.join(' ')), true);
  check('地点与教师被正确读出', /教1-101/.test(cardTexts.join(' ')) && /张三/.test(cardTexts.join(' ')), true);
  console.log('\n  卡片：\n   - ' + cardTexts.join('\n   - '));

  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
  window.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('测试自身异常：', err);
  process.exit(1);
});
