// ============================================================
// GET /api/courses —— 课程列表读接口（Day 17，契约 api-contract.md 3.2）
// 数据来源：CloudBase PostgreSQL courses + course_weeks 两表（Day 16 建）
// 访问方式：PG HTTP 网关（PostgREST 语法），走平台内部链路
//   —— 免费体验版共享集群无内网/外网直连地址（Day 17 实测：配置页内网地址为"-"、
//      外网 IPv4 关闭），pg 协议直连不可行，故改走 HTTP 网关（官方兜底路径）
// 响应统一 { ok, data, error } 包络（契约 2.1）
// ============================================================
const http = require('http');

// 监听端口必须与控制台「函数配置 → 监听端口」一致（Day 15 实测：不一致网关 65 秒超时返回 450）
const PORT = 9000;

// 环境 ID 不是秘密（公网 URL 里可见），可直接写；API Key 是服务端密钥，必须走环境变量
const ENV_ID = 'wg-kechengbiao-d9gi92b9ma9e7f71c';
const RDB_BASE = process.env.RDB_BASE_URL || `https://${ENV_ID}.api.tcloudbasegateway.com`;
const API_KEY = process.env.RDB_API_KEY;

if (!API_KEY) {
  console.error('[courses] 缺少环境变量 RDB_API_KEY，所有请求将返回 SERVER_ERROR');
}

// limit 查询参数上限（余力加练，契约 3.2）
const LIMIT_MAX = 500;

// ---------- 响应工具（统一包络，契约 2.1） ----------

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    // 前端部署在 tcloudbaseapp.com，与函数域名不同源，为 Day 18 前端接线预留 CORS
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

function ok(res, data) {
  send(res, 200, { ok: true, data });
}

function fail(res, status, code, message) {
  send(res, status, { ok: false, error: { code, message } });
}

// ---------- 数据层：PG HTTP 网关查询 ----------

// PostgREST 语法：
//   select=*,course_weeks(week)        —— 按外键 course_weeks.course_id → courses.id 嵌套带出周次
//   order=weekday.asc,periods.asc,...  —— 与原 SQL 的 ORDER BY 一致
//   limit=N                            —— 参数化分页（URL 参数，无字符串拼接进查询体）
async function fetchCourses(limit) {
  const params = new URLSearchParams();
  params.set('select', '*,course_weeks(week)');
  params.set('order', 'weekday.asc,periods.asc,name.asc');
  if (limit) params.set('limit', String(limit));

  const url = `${RDB_BASE}/v1/rdb/rest/courses?${params.toString()}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`RDB 网关 ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// 网关行 → 契约 2.3 课程对象：snake_case 列名映射回 camelCase（契约 2.4 要点 2），
// 嵌套的 course_weeks 数组拍平成 weeks
function toCourse(row) {
  const weeks = (row.course_weeks || []).map((w) => w.week).sort((a, b) => a - b);
  return {
    id: row.id,
    name: row.name,
    weekday: row.weekday,
    periods: row.periods,
    location: row.location,
    teacher: row.teacher,
    className: row.class_name,
    scheduleDate: row.schedule_date,
    courseOrder: row.course_order,
    type: row.type,
    weeks,
  };
}

// ---------- 业务逻辑 ----------

// 解析 limit 查询参数（Day 17 余力加练，契约 3.2）
// 合法：正整数 1–LIMIT_MAX；不传 = 返回全部；非法返回 null 由调用方按 BAD_REQUEST 拒绝
function parseLimit(searchParams) {
  const raw = searchParams.get('limit');
  if (raw === null) return { limit: null };
  if (!/^\d+$/.test(raw)) return { limit: null, invalid: true };
  const n = Number(raw);
  if (n < 1 || n > LIMIT_MAX) return { limit: null, invalid: true };
  return { limit: n };
}

async function handleCourses(res, searchParams) {
  const { limit, invalid } = parseLimit(searchParams);
  if (invalid) {
    fail(res, 400, 'BAD_REQUEST', `limit 必须是 1-${LIMIT_MAX} 的整数`);
    return;
  }
  if (!API_KEY) {
    fail(res, 500, 'SERVER_ERROR', '服务端未配置数据库凭据（RDB_API_KEY）');
    return;
  }

  const rows = await fetchCourses(limit);
  const courses = rows.map(toCourse);
  ok(res, { courses, count: courses.length });
}

// ---------- HTTP 路由 ----------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // 去掉尾部斜杠，/api/courses/ 与 /api/courses 等价
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    send(res, 204, null);
    return;
  }

  if (path === '/api/courses') {
    if (req.method !== 'GET') {
      fail(res, 405, 'METHOD_NOT_ALLOWED', '本接口只接受 GET 请求');
      return;
    }
    handleCourses(res, url.searchParams).catch((err) => {
      console.error('[courses] upstream error:', err.message);
      fail(res, 500, 'SERVER_ERROR', '数据库读取失败，请稍后重试');
    });
    return;
  }

  fail(res, 404, 'NOT_FOUND', `未知路径: ${path}`);
});

server.listen(PORT, () => {
  console.log(`[courses] listening on port ${PORT}`);
});
