/* check-08-docs.js —— 文档口径一致：契约最新版本号必须同步出现在 README 与 PRD */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');

module.exports.name = '8. 文档口径一致';
module.exports.run = async () => {
  const contract = fs.readFileSync(path.join(ROOT, 'api-contract.md'), 'utf8');
  /* 契约变更表里最后一个 v1.x 行即为最新版本 */
  const versions = [...contract.matchAll(/\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(v1\.\d+)\s*\|/g)].map(m => m[2]);
  if (versions.length === 0) return { pass: false, evidence: ['api-contract.md 变更表里没解析到任何版本号'] };
  const latest = versions[versions.length - 1];

  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const prd = fs.readFileSync(path.join(ROOT, 'PRD.md'), 'utf8');
  const inReadme = readme.includes(latest);
  const inPrd = prd.includes(latest);

  const evidence = [
    `api-contract.md 最新版本：${latest}（变更表共 ${versions.length} 条）`,
    `README.md ${inReadme ? '含' : '不含'} ${latest}${inReadme ? '' : ' → 口径落后'}`,
    `PRD.md ${inPrd ? '含' : '不含'} ${latest}${inPrd ? '' : ' → 口径落后'}`,
  ];
  return { pass: inReadme && inPrd, evidence };
};
