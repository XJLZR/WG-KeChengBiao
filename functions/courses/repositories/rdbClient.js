// ============================================================
// rdbClient —— PG HTTP 网关低层客户端（Day 19 从 index.js 迁入）
// 职责：拼 URL、带鉴权头、超时控制、错误包装。不含任何业务表逻辑。
// 访问方式：PG HTTP 网关（PostgREST 语法），走平台内部链路
//   —— 免费体验版共享集群无内网/外网直连地址（Day 17 实测：配置页内网地址为"-"、
//      外网 IPv4 关闭），pg 协议直连不可行，故改走 HTTP 网关（官方兜底路径）
// ============================================================

// 环境 ID 不是秘密（公网 URL 里可见），可直接写；API Key 是服务端密钥，必须走环境变量
const ENV_ID = 'wg-kechengbiao-d9gi92b9ma9e7f71c';
const RDB_BASE = process.env.RDB_BASE_URL || `https://${ENV_ID}.api.tcloudbasegateway.com`;
const API_KEY = process.env.RDB_API_KEY;

if (!API_KEY) {
  console.error('[courses] 缺少环境变量 RDB_API_KEY，所有请求将返回 SERVER_ERROR');
}

// 供接口层判断数据库凭据是否已配置（原 index.js 顶层的 API_KEY 判断）
function hasApiKey() {
  return Boolean(API_KEY);
}

const TIMEOUT_MS = 8000;

// 统一网关请求。path 形如 'courses' 或 'courses?id=not.is.null'（PostgREST 过滤条件直接拼在 path 上）。
// 请求头按 method 区分，与重构前逐字一致：
//   GET    → Authorization + Accept
//   DELETE → 仅 Authorization
//   POST   → Authorization + Content-Type + Prefer(return=minimal)
//   PATCH  → 同 POST（Day 22 新增：部分更新主表字段）
// errorPrefix：出错时加在错误信息前的动作说明（如「删除旧数据失败」），
// 用于保持重构前 500 响应文案不变（会透传进 SERVER_ERROR 的 message）
async function rdbRequest(path, { method = 'GET', query = {}, body, errorPrefix = '' } = {}) {
  const params = new URLSearchParams(query);
  const qs = params.toString();
  const url = `${RDB_BASE}/v1/rdb/rest/${path}${qs ? `?${qs}` : ''}`;

  const headers = { Authorization: `Bearer ${API_KEY}` };
  if (method === 'GET') headers.Accept = 'application/json';
  if (method === 'POST' || method === 'PATCH') {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=minimal';
  }

  const resp = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const prefix = errorPrefix ? `${errorPrefix} ` : '';
    throw new Error(`${prefix}RDB 网关 ${resp.status}: ${text.slice(0, 200)}`);
  }
  // 只有 GET 解析响应体（重构前仅 fetchCourses 用返回值）。
  // DELETE/POST 成功时网关返回空响应体，解析会抛
  // "Unexpected end of JSON input"（Day 19 回归实测踩中，已修复）
  if (method === 'GET') return resp.json();
  return null;
}

module.exports = { hasApiKey, rdbRequest };
