# verify-project —— WG课程表发布前检查 Skill

> **是什么**：本项目专属的发布前体检工具。检查项全部来自 Day 14–26 的真实踩坑记录，
> 每项输出 `PASS / FAIL + 证据原文`，不允许"看起来正常""基本没问题"这类模糊表述。
>
> **怎么调用**：在对话里说「运行 verify-project」，助手加载本文件后执行：
>
> ```bash
> node "D:\WG课程表\.workbuddy\skills\verify-project\checks\run-all.js"
> ```
>
> 也可以单独跑某一项，如 `node .../checks/check-01-secrets.js`。

## 检查项总表（8 项）

| # | 文件 | 查什么 | 来源踩坑 | 通过标准 |
|---|------|--------|----------|----------|
| 1 | check-01-secrets.js | 密钥/连接串不入库 | AGENTS.md 铁律、Day 21 安全审计 | 扫 js/ functions/ db/ css/ cloudbase/ *.html，`sk-` 长串、`postgres://`、Bearer 长令牌命中数为 0 |
| 2 | check-02-paths.js | 静态资源相对路径 | 部署在子路径 `/wg-kechengbiao/`，资源必须 `./` | 5 个 HTML 里 `src="/…"`/`href="/…"` 根路径引用命中数为 0（协议外链除外） |
| 3 | check-03-scripts.js | 各页面脚本引用顺序 | 依赖加载顺序错会导致页面半初始化 | 每个 HTML 的 script 顺序与本文件下方「期望顺序表」逐字一致 |
| 4 | check-04-health.js | 云函数公网健康 | Day 15/19 的 450 坑（listen 端口/路径透传配错） | `GET /api/health` 返回 HTTP 200 且响应体含 `"ok"` 字段 |
| 5 | check-05-code.js | 口令隔离生效 | Day 25 方案 B：无 code 必须报错，不能吐数据 | 不带 code 与带假 code 各请求一次 `GET /api/courses`，两次都返回 `ok:false` 且 code ∈ {MISSING_CODE, INVALID_CODE, SCHEDULE_NOT_FOUND}；返回 `ok:true` 或任何课程数据即 FAIL |
| 6 | check-06-cors.js | CORS 头不重复 | Day 19：云函数自己写 CORS 头与网关叠加成非法值 | OPTIONS 带**前端真实 Origin**（从契约「前端地址」提取，网关按 Origin 白名单回头）请求，`Access-Control-Allow-Origin` 恰好出现 1 次 |
| 7 | check-07-idempotent.js | 解析器幂等 | Day 18/25 重复写入、主键相撞 | 对 samples/ 里的教务文件用 js/parser.js 解析两次，两次 JSON 输出逐字节一致 |
| 8 | check-08-docs.js | 文档口径一致 | 「改契约要联动派生数字」的规矩 | api-contract.md 变更表里最新版本号，在 README.md 与 PRD.md 中都能检索到 |

## 期望脚本顺序表（check-03 的判定依据，改页面时同步改这里）

- `index.html`：schedule-code → settings-store → ui-modal → schedule → ui-home
- `import.html`：schedule-code → ui-modal → parser → ui-import
- `settings.html`：schedule-code → settings-store → ui-modal → ics → ui-settings
- `entry.html`：schedule-code → ui-entry
- `check.html`：schedule-code

## 判定纪律

1. 每项只有 PASS / FAIL 两种结果，FAIL 必须附命中原文（文件:行号 + 内容片段）。
2. 网络项超时 10 秒，超时 = FAIL（证据写"请求超时"）。
3. 任何一项 FAIL，整体结论就是「不可发布」，逐条修完重跑，不做"整体基本没问题"的汇总。
