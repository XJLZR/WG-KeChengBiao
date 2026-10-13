/* check-03-scripts.js —— 各页面脚本引用顺序必须与期望表一致 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');
/* 期望顺序表（与 SKILL.md 同步维护） */
const EXPECT = {
  'index.html': ['schedule-code', 'settings-store', 'ui-modal', 'schedule', 'ui-home'],
  'import.html': ['schedule-code', 'ui-modal', 'parser', 'ui-import'],
  'settings.html': ['schedule-code', 'settings-store', 'ui-modal', 'ics', 'ui-settings'],
  'entry.html': ['schedule-code', 'ui-entry'],
  'check.html': ['schedule-code'],
};

module.exports.name = '3. 页面脚本引用顺序';
module.exports.run = async () => {
  const evidence = [];
  let allOk = true;
  for (const [page, expect] of Object.entries(EXPECT)) {
    const full = path.join(ROOT, page);
    if (!fs.existsSync(full)) { evidence.push(`${page}：文件不存在 → FAIL`); allOk = false; continue; }
    const actual = [...fs.readFileSync(full, 'utf8').matchAll(/<script src="\.\/js\/([a-z0-9-]+)\.js"/g)].map(m => m[1]);
    const ok = JSON.stringify(actual) === JSON.stringify(expect);
    if (!ok) {
      allOk = false;
      evidence.push(`${page}：实际 [${actual.join(' → ')}]，期望 [${expect.join(' → ')}] → FAIL`);
    } else {
      evidence.push(`${page}：[${actual.join(' → ')}] ✓`);
    }
  }
  return { pass: allOk, evidence };
};
