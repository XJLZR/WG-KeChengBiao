/* ============================================================
   tools/test-import-e2e.js —— 导入页端到端测试（Day 29）
   ------------------------------------------------------------
   验证什么：真实浏览器环境（jsdom）下打开 import.html，
     把一份**真实的课表文件**塞进 <input type=file>，触发 change，
     看预览区能不能正确渲染出课程卡片。

   为什么必须用 jsdom 真加载页面：
     手写假 DOM 只能证明「我以为的调用顺序」，
     证明不了脚本加载顺序、全局函数可见性、Promise 时序这些真会出错的地方。

   用法：
     node tools/test-import-e2e.js <课表文件路径> [期望课程数]
   前置：本地要有一个静态服务器提供项目根目录（默认 http://127.0.0.1:8021），
         因为 jsdom 通过 http 加载页面和脚本，file:// 下模块加载行为会失真。
   ============================================================ */

const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8021';
const filePath = process.argv[2];
const expectCount = process.argv[3] ? Number(process.argv[3]) : null;
const expectFormat = process.argv[4] || null;   // 'grid' | 'list'，不给就不校验

if (!filePath || !fs.existsSync(filePath)) {
  console.error('用法: node tools/test-import-e2e.js <课表文件路径> [期望课程数]');
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n      期望 ${e}\n      实际 ${a}`); }
}

const fileBytes = fs.readFileSync(filePath);

(async () => {
  const dom = await JSDOM.fromURL(`${BASE}/import.html`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      /* 导入页要求先有口令，否则会被重定向去入口页 */
      window.localStorage.setItem('wg-schedule-code', 'ABCDEF');
      /* jsdom 不实现 fetch：给个桩，返回 404（= 该口令名下没有课表，首次导入路径） */
      window.fetch = () => Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      });
      window.__errors = [];
      window.addEventListener('error', (e) => window.__errors.push(String(e.message || e)));
    },
  });

  const { window } = dom;
  const { document } = window;

  /* 等所有脚本加载完（含 951KB 的 SheetJS） */
  await new Promise((resolve) => {
    if (document.readyState === 'complete') return resolve();
    window.addEventListener('load', resolve);
  });
  /* 再给 setupImportPage 一点时间跑完 */
  await new Promise((r) => setTimeout(r, 300));

  /* jsdom 的 localStorage 在 beforeParse 阶段写不进去（页面脚本读到的还是空），
     结果是页面一加载就判定「没口令」并往入口页跳、事件监听没绑上。
     这里在文档加载完成后补写口令，再重新调用一次初始化。
     安全性说明：首次调用因无口令提前 return，没有绑过监听，
     所以第二次调用不会造成重复绑定。 */
  if (!window.getScheduleCode || !window.getScheduleCode()) {
    window.localStorage.setItem('wg-schedule-code', 'ABCDEF');
    if (typeof window.setupImportPage === 'function') window.setupImportPage();
  }

  console.log('【一】页面与脚本加载');
  check('口令已就位', window.getScheduleCode && window.getScheduleCode(), 'ABCDEF');
  check('无脚本报错', window.__errors, []);
  check('XLSX 库已加载', typeof window.XLSX, 'object');
  check('parseGridTable 可见', typeof window.parseGridTable, 'function');
  check('parseCourseTable 可见', typeof window.parseCourseTable, 'function');
  check('parseCourseFile 可见', typeof window.parseCourseFile, 'function');
  check('没有被重定向去入口页', !window.location.href.includes('entry.html'), true);

  console.log('【二】塞入真实文件并触发解析');
  const input = document.getElementById('import-file-input');
  /* 造一个最小 File 替身：ui-import 只用到 name 和 arrayBuffer() */
  const fakeFile = {
    name: path.basename(filePath),
    arrayBuffer: () => Promise.resolve(
      fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength)
    ),
  };
  Object.defineProperty(input, 'files', { value: [fakeFile], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));

  /* 等解析完成：预览区取消 hidden 即为完成信号，最多等 10 秒 */
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const section = document.getElementById('import-preview');
    if (section && !section.hidden) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log('【三】预览区结果');
  const preview = document.getElementById('import-preview');
  const statsText = document.getElementById('import-preview-stats').textContent;
  const cards = document.querySelectorAll('#import-preview-list .course-card');

  /* 预览区没出来时，把状态弹窗的内容打出来——错误原因都在那儿 */
  if (preview.hidden) {
    const modal = document.querySelector('.app-modal, #status-modal, .modal');
    console.log('  [调试] 状态弹窗：' + (modal ? modal.textContent.replace(/\s+/g, ' ').trim() : '（没找到弹窗 DOM）'));
    console.log('  [调试] body 片段：' + document.body.textContent.replace(/\s+/g, ' ').slice(0, 300));
  }

  check('预览区已显示', preview.hidden, false);
  if (expectFormat) {
    const label = expectFormat === 'grid' ? '表格布局' : '列表布局';
    check('识别为' + label, new RegExp(label).test(statsText), true);
  }
  if (expectCount) {
    check(`统计行提到 ${expectCount} 门课`, new RegExp(`${expectCount} 门课`).test(statsText), true);
    check('渲染卡片数', cards.length, expectCount);
  } else {
    check('渲染出课程卡片（数量不限）', cards.length > 0, true);
  }
  check('统计行格式正常', /已识别为.+课表：共解析出 \d+ 门课（原始 \d+ 行，跳过无效 \d+ 行）/.test(statsText), true);

  const firstCard = cards[0] ? cards[0].textContent : '';
  check('第一张卡片有课程名', firstCard.length > 6, true);
  check('保存按钮已出现', document.getElementById('import-save-btn').hidden, false);

  /* 抽一张卡片的完整文案，给人眼看 */
  console.log('\n  首张卡片文案：' + firstCard.replace(/\s+/g, ' ').trim());

  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
  window.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('测试自身异常：', err);
  process.exit(1);
});
