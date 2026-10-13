/* check-06-cors.js —— CORS 头必须恰好一份（云函数自写 + 网关回显会叠加成非法值，Day 19 坑）
   修正（第一轮实跑反馈）：网关按 Origin 白名单回 CORS 头，必须用契约里的「前端地址」
   作为 Origin 去探，用随意 Origin 会误报 0 次。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { fetchTimeout } = require('./lib');

const ROOT = path.resolve(__dirname, '../../../..');

/* 从契约提取前端地址，取其 origin 部分（协议+域名） */
function frontendOrigin() {
  const text = fs.readFileSync(path.join(ROOT, 'api-contract.md'), 'utf8');
  const m = text.match(/\| 前端地址 \| `(https:\/\/[^/`]+)/);
  if (!m) throw new Error('api-contract.md 里找不到前端地址行');
  return m[1];
}

module.exports.name = '6. CORS 头不重复';
module.exports.run = async () => {
  const origin = frontendOrigin();
  const url = require('./check-04-health').baseUrl() + '/api/health';
  const r = await fetchTimeout(url, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
  });
  if (r.error) return { pass: false, evidence: [`OPTIONS ${url}（Origin: ${origin}）→ ${r.error}`] };
  /* Node fetch 会把同名头合并为逗号串，按逗号拆分计数判断重复 */
  const v = r.headers.get('access-control-allow-origin');
  const count = v ? v.split(',').map(s => s.trim()).filter(Boolean).length : 0;
  const pass = count === 1;
  return {
    pass,
    evidence: [
      `OPTIONS（Origin: ${origin}）→ HTTP ${r.status}`,
      `Access-Control-Allow-Origin 出现 ${count} 次，值：${v || '（无）'}`,
      count === 0 ? '0 次 = 网关没配 CORS 或白名单没含前端域名，跨域会挂' : '',
      count > 1 ? '>1 次 = 云函数自写 CORS 与网关叠加（Day 19 坑）' : '',
    ].filter(Boolean),
  };
};
