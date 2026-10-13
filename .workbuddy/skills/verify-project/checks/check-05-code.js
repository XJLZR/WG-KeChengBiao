/* check-05-code.js —— 口令隔离生效：无 code / 假 code 必须报错，不能吐数据 */
'use strict';
const { fetchTimeout } = require('./lib');
const { baseUrl } = require('./check-04-health');

const ERROR_CODES_OK = ['MISSING_CODE', 'INVALID_CODE', 'SCHEDULE_NOT_FOUND'];

module.exports.name = '5. 口令隔离生效';
module.exports.run = async () => {
  const base = baseUrl();
  const evidence = [];
  let pass = true;

  /* 场景一：完全不带 code */
  const r1 = await fetchTimeout(`${base}/api/courses`);
  if (r1.error) return { pass: false, evidence: [`GET /api/courses（无 code）→ ${r1.error}`] };
  const c1 = (r1.text.match(/"code"\s*:\s*"([A-Z_]+)"/) || [])[1];
  const dataLeak1 = /"courses"\s*:\s*\[.+\]/.test(r1.text) || /"ok"\s*:\s*true/.test(r1.text);
  evidence.push(`无 code → HTTP ${r1.status}，error.code=${c1 || '（无）'}${dataLeak1 ? '，⚠️ 响应含课程数据/ok:true' : ''}`);
  if (dataLeak1 || !ERROR_CODES_OK.includes(c1)) pass = false;

  /* 场景二：带一个合法格式但不存在的假 code（6 位、避开 0/O/1/I） */
  const r2 = await fetchTimeout(`${base}/api/courses?code=ZZZZZZ`);
  if (r2.error) return { pass: false, evidence: [...evidence, `GET /api/courses?code=ZZZZZZ → ${r2.error}`] };
  const c2 = (r2.text.match(/"code"\s*:\s*"([A-Z_]+)"/) || [])[1];
  const dataLeak2 = /"courses"\s*:\s*\[.+\]/.test(r2.text) || /"ok"\s*:\s*true/.test(r2.text);
  evidence.push(`假 code → HTTP ${r2.status}，error.code=${c2 || '（无）'}${dataLeak2 ? '，⚠️ 响应含课程数据/ok:true' : ''}`);
  if (dataLeak2 || !ERROR_CODES_OK.includes(c2)) pass = false;

  if (!pass) evidence.push('判定 FAIL：报错码不符或发生了数据泄露');
  return { pass, evidence };
};
