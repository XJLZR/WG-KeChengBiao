# Day 28 · 最终验收表（作品 v1.0）

> 验收时间：2026-10-15 13:36–13:55
> 验收方式：全部为本机实跑（curl 公网 / 真接口读写 / verify-project 8 项检查 / jsdom 回归 12 套），无一项凭记忆下结论。
> 公网地址：https://wg-kechengbiao-d9gi92b9ma9e7f71c-1501303146.tcloudbaseapp.com/wg-kechengbiao/

## 一、十项验收

| # | 检测项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 页面/视图数量 | **PASS** | 线上 5 页面全 HTTP 200：index / entry / import / settings / check.html（curl 实测）；PRD v1.4 定义首页视图 V1.1–V1.10 共 10 个，视图逻辑由 jsdom 回归覆盖（switch-check 33、week-switch 22、entry-check 28 等全绿） |
| 2 | 反馈交互 | **PASS** | 12 套回归脚本当天实跑全绿（明细见第二节）：二次确认弹窗、错误中文提示（V2.3/A6）、加载中 V1.7、失败重试 V1.8、课程状态标签、滚筒选时 S10 系列、微信引导（day27 W2） |
| 3 | 数据库读写 | **PASS** | 真接口全链路（测试口令 DAY28T）：错误分支 MISSING_CODE 400 / INVALID_CODE 400 / SCHEDULE_NOT_FOUND 404 → POST 导入 2 门（imported:2）→ GET 回读一致 → PATCH 改地点落库 → DELETE×2 → 清后回读 404。数据库现状：courses 166 行、settings 2 行（真实数据完好未动） |
| 4 | 前后端链路 | **PASS** | /api/health 200 `{"ok":true,"service":"wg-timetable"}`（时间戳每次变化=非缓存）；网关路由 /api/courses、/api/settings 均经公网实测可用；CORS 白名单正确回显线上域名（verify-project #6，无重复头） |
| 5 | 合法数据来源 | **PASS** | 数据来源=用户本人教务系统导出的课表文件（`.xls` 实为 HTML 格式，样本留档 `samples/`），前端本地解析、用户确认后才上传；无爬虫、无第三方数据源（契约第 4 节明确不做外部数据拉取） |
| 6 | 公网地址 | **PASS** | 上方地址 curl 实测 10 个关键文件（5 页面 + ics/parser/schedule-code/ui-home.js + pages.css）全部 HTTP 200 |
| 7 | 线上持久化 | **PASS** | POST 写入 → GET 回读逐字段一致 → PATCH 后再 GET 确认 `location=教A-105` 落库 → DELETE 清理 → 回读 SCHEDULE_NOT_FOUND，测试数据零残留 |
| 8 | 回滚与备份说明 | **PASS** | `ROLLBACK-DRILL-2026-10-13.md` 真实演练记录（回滚 28 秒 / 恢复 15.9 秒）；`RELEASE-CHECKLIST-v1.0.md` 第五节两层备份（git+GitHub、tag v1.0 可还原发布态）；`docs/day27-资源与到期说明.md` 数据导出三步法（应用内 JSON 备份 / PG 控制台 / 前端源码） |
| 9 | CloudBase 额度与到期风险 | **PASS**（含明确风险提示） | 体验版（免费），**2027-04-07 到期**；本周期用量 SCF 4.25 资源点为主、其余≈0，绰绰有余。风险=到期不续费则环境停用，到期前须导出数据（day27 文档已写明） |
| 10 | 敏感文件 | **PASS**（一处提请主人注意） | verify-project #1：扫描 48 个文件，密钥类模式命中 0；`RDB_API_KEY` 只存云函数环境变量，不进仓库。⚠️ 提请注意：`backup-day24.json` 在 Git 中且含真实教师姓名的课程数据（Day 24 有意保留的备份样本），若仓库公开建议移出版本库；`新建 文本文档.txt` 为空文件遗留（未入 Git，可删） |

## 二、核心流程重复检测（回归全绿明细）

| 脚本 | 断言数 | 覆盖 |
|---|---|---|
| parser-test.js | 29/29 | 解析器 JS↔Python 双实现互查（样例文件 32 门逐条一致） |
| day25-save-check.js | 13/13 | 保存流程（确认弹窗/免确认/失败分支/500 上限拦截） |
| day25-import-check.js | 29/29 | 导入页端到端（真实文件 32 门预览→确认→成功弹窗） |
| day25-entry-check.js | 28/28 | 入口页（创建/输入口令/分享链接直达） |
| day25-week-switch.js | 22/22 | 周视图换周 |
| day25-ics-check.js | 21/21 | .ics 生成（时区/转义/周次展开） |
| day27-ics-check.js | 13/13 | 微信断链修复回归 |
| day25-settings-check.js | 43/43 | 设置页（表单/滚筒/备份导入导出/上云） |
| day25-code-check.js | 17/17 | 口令隔离（真接口） |
| day26-settings-api-check.js | 20/20 | 设置上云接口（真接口） |
| switch-check.js | 33/33 | 今日/周视图切换 |
| day14-check.js | 24/24 | 搜索/筛选/卡片样式回归 |
| **合计** | **292/292** | |

## 三、交付清单清点（当场可打开/展示）

| 交付物 | 位置 | 状态 |
|---|---|---|
| 作品线上地址 | 见文件头 | ✅ 可当场打开 |
| 发布清单 v1.0 | `RELEASE-CHECKLIST-v1.0.md` | ✅ |
| 回滚演练记录 | `ROLLBACK-DRILL-2026-10-13.md` | ✅ |
| 资源与到期说明 | `docs/day27-资源与到期说明.md` | ✅ |
| 接口契约 v1.8 | `api-contract.md` | ✅ |
| PRD v1.4 / TECH_DESIGN v1.2 / RUN.md | 项目根 | ✅ |
| 发布前检查 Skill（8 项） | `.workbuddy/skills/verify-project/` | ✅ 当天实跑 8/8 PASS |
| 验收表（本文件） | `docs/day28-最终验收表.md` | ✅ |
| 演示提纲（3–5 分钟） | `docs/day28-演示提纲.md` | ✅ |
| 结营复盘 | `docs/day28-结营复盘.md` | ✅ |

## 四、验收过程中的两个说明（诚实记录）

1. 回归首跑出现 3 处红，逐一排查**均非产品 bug**：① 两个脚本读的桌面课表文件已不在（改指 `samples/` 留档副本，golden 基准用 Python 独立实现重新生成，JS↔Python 仍逐条一致）；② 一处是我传错脚本参数（该脚本收整页地址）；③ 三处断言夹具写死「周二/王五」，今天周四触发日期类假失败，已把夹具改为动态对齐今天后全绿。产品代码零改动。
2. 「真接口写入真实口令数据再恢复」的 save-real 脚本今日未跑（避免碰真实数据）；等价覆盖=第 3/7 项的独立测试口令 DAY28T 全链路实测。测试残留（TEST23 设置行）已清零，真实数据（courses 166 行 / settings 2 行）完好。

## 五、待主人完成

- [ ] 截图一：本验收表逐项打勾的样子
- [ ] 截图二：手机/浏览器打开公网地址的样子（带地址栏 + 完整作品页面）
- [x] 复盘正文拍板（已定稿：`docs/day28-结营复盘.md`）
