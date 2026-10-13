/* check-02-paths.js —— 静态资源必须用 ./ 相对路径（部署在子路径 /wg-kechengbiao/） */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');
const PAGES = ['index.html', 'import.html', 'settings.html', 'entry.html', 'check.html'];
/* 根路径引用，排除协议相对外链 // 和锚点 # */
const RE = /(?:src|href)\s*=\s*(")(\/[^/"#][^"]*)\1/g;

module.exports.name = '2. 静态资源相对路径';
module.exports.run = async () => {
  const hits = [];
  for (const page of PAGES) {
    const full = path.join(ROOT, page);
    if (!fs.existsSync(full)) { hits.push(`${page}：文件不存在！`); continue; }
    const text = fs.readFileSync(full, 'utf8');
    const lines = text.split(/\r?\n/);
    RE.lastIndex = 0;
    let m;
    while ((m = RE.exec(text))) {
      const lineNo = text.slice(0, m.index).split('\n').length;
      hits.push(`${page}:${lineNo}  ${m[2]}`);
    }
  }
  if (hits.length === 0) {
    return { pass: true, evidence: [`扫描 ${PAGES.length} 个页面，根路径资源引用命中 0 处`] };
  }
  return { pass: false, evidence: [`以下为根路径引用（部署到子路径会 404）：`, ...hits] };
};
