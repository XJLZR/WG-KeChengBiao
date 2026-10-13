/* check-01-secrets.js —— 密钥/连接串不得出现在仓库代码里 */
'use strict';
const fs = require('fs');
const path = require('path');
const { walk } = require('./lib');

const PATTERNS = [
  { re: /\bsk-[A-Za-z0-9]{8,}/g, desc: 'sk- 开头疑似 API Key' },
  { re: /postgres(ql)?:\/\/[^\s"']+/g, desc: '数据库连接串' },
  { re: /Bearer [A-Za-z0-9\-_.]{20,}/g, desc: 'Bearer 长令牌' },
  { re: /\bRDB_API_KEY\s*[:=]\s*["'][^"']{8,}["']/g, desc: 'RDB_API_KEY 明文赋值' },
];

module.exports.name = '1. 密钥不入库';
module.exports.run = async () => {
  const root = path.resolve(__dirname, '../../../..');
  const files = walk(root, ['.git', 'node_modules', '.workbuddy', 'backup-day24.json', 'samples']);
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const { re, desc } of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const upto = text.slice(0, m.index);
        const lineNo = upto.split('\n').length;
        hits.push(`${path.relative(root, f)}:${lineNo}  [${desc}]  ${m[0].slice(0, 40)}...`);
      }
    }
  }
  if (hits.length === 0) return { pass: true, evidence: [`扫描 ${files.length} 个文件（排除 .git/.workbuddy/samples/备份），密钥类模式命中 0 处`] };
  return { pass: false, evidence: [`命中 ${hits.length} 处：`, ...hits.slice(0, 20)] };
};
