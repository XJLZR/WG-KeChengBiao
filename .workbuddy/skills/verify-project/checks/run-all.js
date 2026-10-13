/* run-all.js —— verify-project 总入口：逐项跑 8 个检查，输出 PASS/FAIL + 证据 */
'use strict';
const path = require('path');

const CHECKS = [
  'check-01-secrets.js',
  'check-02-paths.js',
  'check-03-scripts.js',
  'check-04-health.js',
  'check-05-code.js',
  'check-06-cors.js',
  'check-07-idempotent.js',
  'check-08-docs.js',
];

(async () => {
  const results = [];
  for (const f of CHECKS) {
    const mod = require(path.join(__dirname, f));
    let r;
    try {
      r = await mod.run();
    } catch (e) {
      r = { pass: false, evidence: '检查脚本自身抛异常: ' + e.message };
    }
    results.push({ name: mod.name, ...r });
  }

  console.log('='.repeat(64));
  console.log('verify-project 发布前检查 —— ' + new Date().toLocaleString('zh-CN'));
  console.log('='.repeat(64));
  for (const r of results) {
    console.log(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name}`);
    for (const line of r.evidence) console.log('       ' + line);
  }
  const fails = results.filter(r => !r.pass).length;
  console.log('-'.repeat(64));
  console.log(`结论：${fails === 0 ? '全部通过，可发布' : `${fails} 项 FAIL，不可发布（逐条修完重跑）`}`);
  process.exit(fails === 0 ? 0 : 1);
})();
