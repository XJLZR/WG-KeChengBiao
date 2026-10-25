/* ============================================================
   tools/test-week-layout.js —— 周视图「一屏看全周」回归测试（Day 30）
   ------------------------------------------------------------
   背景：周视图原本是 44px + 7×88px = 660px 的固定宽网格，手机上必须横滑。
   主人拿了别的课表 App 的截图提要求：不用横滑，把格子做长。
   改法：列宽改 minmax(0,1fr) 平分、行高 46→60px、节次标签只显示数字。

   本测试守两件事：
     ① 结构没坏：12 个节次格 + 7 个星期表头 + 课程块跨行仍然正确
     ② 样式没被改回固定宽：.week-grid 的列定义必须是 1fr 平分
        （改成固定像素就等于又把横滑退回去了，这条会立刻报错）

   用法：node tools/test-week-layout.js
   前置：本地静态服务器（默认 http://127.0.0.1:8021）
   ============================================================ */

const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8021';
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n      期望 ${e}\n      实际 ${a}`); }
}

console.log('【一】样式：列宽必须平分，行高必须够短');
{
  const css = fs.readFileSync(path.join(ROOT, 'css/pages.css'), 'utf8');
  const gridRule = css.match(/\.week-grid\s*\{[\s\S]*?\}/);
  const rule = gridRule ? gridRule[0] : '';
  check('存在 .week-grid 规则', !!rule, true);
  check('列定义为 minmax(0, 1fr) 平分', /grid-template-columns:\s*32px\s+repeat\(7,\s*minmax\(0,\s*1fr\)\)/.test(rule), true);
  check('行高 40px（12 节共 480px，一屏放得下）', /grid-template-rows:\s*26px\s+repeat\(12,\s*40px\)/.test(rule), true);
  check('没有残留固定 88px 列宽', /minmax\(88px/.test(rule), false);
  check('课名行数由 --name-lines 控制', /-webkit-line-clamp:\s*var\(--name-lines/.test(css), true);
  check('单节课程块隐藏地点', /\.week-grid__course\.is-compact\s+\.week-grid__course-loc\s*\{[^}]*display:\s*none/.test(css), true);
  check('跨节课程块地点允许多行', /\.week-grid__course\.is-tall\s+\.week-grid__course-loc/.test(css), true);
}

(async () => {
  const dom = await JSDOM.fromURL(`${BASE}/index.html`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      /* 返回一门覆盖全学期的课，保证无论当前是第几周都能画进周视图 */
      const weeks = Array.from({ length: 30 }, (_, i) => i + 1);
      const payload = {
        ok: true,
        data: {
          courses: [
            { id: 'c-test1', name: '大学物理B(下)', weekday: 1, periods: [1, 2], weeks, location: 'L1208' },
            { id: 'c-test2', name: '模拟电子技术', weekday: 2, periods: [3, 4], weeks, location: 'L4104' },
            /* 超长课名 + 单节：用来验证「缩略 + 单节不显示地点」这条规则 */
            { id: 'c-test3', name: '毛泽东思想和中国特色社会主义理论体系概论', weekday: 3, periods: [5], weeks, location: 'L3106' },
          ],
        },
      };
      window.fetch = () => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(payload),
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
  await new Promise((r) => setTimeout(r, 400));

  /* jsdom 的 beforeParse 写不进 localStorage，首页会判定「没口令」跳入口页。
     这里加载完成后补写口令并重新 bootstrap（首轮已提前 return，不会重复绑定）。 */
  if (!window.getScheduleCode || !window.getScheduleCode()) {
    window.localStorage.setItem('wg-schedule-code', 'ABCDEF');
    if (typeof window.bootstrap === 'function') await window.bootstrap();
  }

  console.log('【二】结构：周视图网格');
  check('无脚本报错', window.__errors, []);

  /* 切到周视图：按钮 data-view="week" */
  const weekBtn = document.querySelector('.view-switch__btn[data-view="week"]');
  check('周视图按钮存在', !!weekBtn, true);
  weekBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));

  const periods = [...document.querySelectorAll('.week-grid__period')];
  const heads = [...document.querySelectorAll('.week-grid__head')];
  check('节次格 12 个', periods.length, 12);
  check('节次文字是纯数字 1–12', periods.map((p) => p.textContent), ['1','2','3','4','5','6','7','8','9','10','11','12']);
  check('节次保留了完整读屏标签', periods[11].getAttribute('aria-label'), '第12节');
  check('星期表头 7 个', heads.length, 7);
  check('星期表头文字', heads.map((h) => h.textContent), ['周一','周二','周三','周四','周五','周六','周日']);

  const grid = document.getElementById('week-grid');
  check('网格容器还在', !!grid, true);
  check('网格内仍有空格子（12×7 减去被占的）', document.querySelectorAll('.week-grid__cell').length > 0, true);

  console.log('【三】课程块：缩略与单节/跨节区分');
  const blocks = [...document.querySelectorAll('.week-grid__course')];
  check('课程块数量等于本周课程数', blocks.length, 3);

  const longBlock = blocks.find((b) => (b.getAttribute('title') || '').includes('毛泽东'));
  check('超长课名的块存在', !!longBlock, true);
  check('超长课名带 is-compact（单节）', longBlock.classList.contains('is-compact'), true);

  const longName = longBlock.querySelector('.week-grid__course-name').textContent;
  check('超长课名被缩略（结尾是省略号）', /…$/.test(longName), true);
  check('缩略到 6 个字以内（单节 2 行 × 3 字）', longName.replace('…', '').length <= 5, true);
  check('完整课名保留在 title 里', longBlock.getAttribute('title'), '毛泽东思想和中国特色社会主义理论体系概论');
  check('单节块不给地点留位置（由 is-compact 样式隐藏）', longBlock.classList.contains('is-compact'), true);

  const twoPeriod = blocks.find((b) => (b.getAttribute('title') || '') === '大学物理B(下)');
  check('跨 2 节的块带 is-tall', twoPeriod.classList.contains('is-tall'), true);
  check('跨 2 节块保留完整课名', twoPeriod.querySelector('.week-grid__course-name').textContent, '大学物理B(下)');
  check('跨 2 节块显示地点', twoPeriod.querySelector('.week-grid__course-loc').textContent, 'L1208');
  check('--name-lines 传给 CSS（跨2节=3行）', twoPeriod.getAttribute('style').includes('--name-lines:3'), true);
  check('--name-lines 传给 CSS（单节=2行）', longBlock.getAttribute('style').includes('--name-lines:2'), true);

  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
  window.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('测试自身异常：', err);
  process.exit(1);
});
