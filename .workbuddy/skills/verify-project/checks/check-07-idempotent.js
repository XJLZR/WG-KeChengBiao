/* check-07-idempotent.js —— 解析器幂等：同一文件解析两次输出必须逐字节一致（重复写入/主键相撞坑） */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');
const SAMPLE_DIR = path.join(ROOT, 'samples');

module.exports.name = '7. 解析器幂等';
module.exports.run = async () => {
  /* 修正（第一轮实跑反馈）：parser.js 内部用浏览器的 DOMParser 解析 HTML 表格，
     Node 里没有该 API，需用 jsdom 补一个再 require。 */
  if (typeof globalThis.DOMParser === 'undefined') {
    let JSDOM;
    try { ({ JSDOM } = require('jsdom')); }
    catch { ({ JSDOM } = require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }
    globalThis.DOMParser = new JSDOM('').window.DOMParser;
  }
  const { parseCourseTable } = require(path.join(ROOT, 'js/parser.js'));
  const files = fs.existsSync(SAMPLE_DIR) ? fs.readdirSync(SAMPLE_DIR) : [];
  if (files.length === 0) return { pass: false, evidence: ['samples/ 目录为空或不存在，没有可跑的样例文件'] };

  const evidence = [];
  let allOk = true;
  for (const f of files) {
    const text = fs.readFileSync(path.join(SAMPLE_DIR, f), 'utf8');
    const out1 = JSON.stringify(parseCourseTable(text));
    const out2 = JSON.stringify(parseCourseTable(text));
    const same = out1 === out2;
    if (!same) allOk = false;
    let firstDiff = '';
    if (!same) {
      for (let i = 0; i < Math.max(out1.length, out2.length); i++) {
        if (out1[i] !== out2[i]) { firstDiff = `首个差异位置 ${i}：'${out1.slice(i, i + 40)}' vs '${out2.slice(i, i + 40)}'`; break; }
      }
    }
    evidence.push(`${f}：两次解析输出${same ? '逐字节一致 ✓' : '不一致 → FAIL；' + firstDiff}（输出长度 ${out1.length} 字符）`);
  }
  return { pass: allOk, evidence };
};
