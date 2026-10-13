/* check-04-health.js —— 云函数公网健康检查（Day 15/19 的 450 坑） */
'use strict';
const fs = require('fs');
const path = require('path');
const { fetchTimeout } = require('./lib');

const ROOT = path.resolve(__dirname, '../../../..');
/* Base URL 直接从 api-contract.md 第 11 行附近提取，避免硬编码两处失同步 */
function baseUrl() {
  const text = fs.readFileSync(path.join(ROOT, 'api-contract.md'), 'utf8');
  const m = text.match(/\| Base URL \| `(https:[^`]+)` \|/);
  if (!m) throw new Error('api-contract.md 里找不到 Base URL 行');
  return m[1];
}

module.exports.name = '4. 云函数健康检查';
module.exports.run = async () => {
  const url = baseUrl() + '/api/health';
  const r = await fetchTimeout(url);
  if (r.error) return { pass: false, evidence: [`${url} → ${r.error}`] };
  const okBody = /"ok"\s*:\s*true/.test(r.text);
  const pass = r.status === 200 && okBody;
  return {
    pass,
    evidence: [
      `GET ${url}`,
      `HTTP ${r.status}${r.status === 450 ? '（450 = 云函数 listen 端口/路径透传配置错，Day 19 同款坑）' : ''}`,
      `响应体前 200 字符：${r.text.slice(0, 200)}`,
    ],
  };
};
module.exports.baseUrl = baseUrl;
