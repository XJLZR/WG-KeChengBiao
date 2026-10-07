# 第 3 周验收表（Day 15–21）

> 填写日期：2026-10-07。覆盖本周后端主线：Day 16 建表 / Day 17 GET 接口 / Day 18 POST 导入 / Day 19 分层重构 / Day 20 前端接线 + CORS 修复 + 检查台 / Day 21 周验收。
> 结论口径：PASS = 有当天实测证据；FAIL = 做了但没通过；未执行 = 没做。不许模糊表述。

## 一、逐项验收

| # | 验收项 | 验证方法 | 结论 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | schema / seed 脚本（Day 16） | 打开 `db/schema.sql`、`db/seed.sql`，确认建表语句（courses + course_weeks，外键级联）与种子数据存在；数据库两表已在线上真实存在（GET 接口能读出即反证） | PASS | 文件：`db/schema.sql`、`db/seed.sql`（项目根可见）；提交 `9f3300f`；接口实测读出 34 条真实数据（见 #2），说明两表真实存在且有数据 |
| 2 | GET /api/courses 公网接口（Day 17） | `curl` 公网地址，看 HTTP 状态码与 JSON 包络 | PASS | 2026-10-07 实测：`GET https://wg-kechengbiao-d9gi92b9ma9e7f71c-1501303146.ap-shanghai.app.tcloudbase.com/api/courses` 返回 200，`ok:true`，count 字段 34 = 实际条数 34，首条「复变函数与积分变换」含完整 weeks 数组；`/api/health` 返回 200。提交 `0ba6397` |
| 3 | POST 导入接口（Day 18） | 按 Day 19 固化方法：GET 读出全部 → 原样 POST 回 `/api/courses/import` → 复验前后一致（写链路真实走通，库内容不变） | PASS | 2026-10-07 实测：写入前 34 条 → POST 响应 `{"ok":true,"data":{"imported":34}}` → 写入后 34 条，前后内容逐字段比对一致（True）。提交 `41250ed` |
| 4 | 分层重构（Day 19） | `functions/courses/` 内路由 / 服务 / 仓储分层，数据库操作拆入 repositories；重构后全接口回归 | PASS | 目录 `functions/courses/` 分层结构可见；提交 `eb6bf0e`；重构后回归通过（Day 19 记录），且 #2/#3 今日实测仍通，证明重构未破坏链路 |
| 5 | 公网检查台 URL（Day 20） | 浏览器打开检查台页面，三块功能（健康检查 / 核心表 / 写入测试）可用 | PASS | `https://wg-kechengbiao-d9gi92b9ma9e7f71c-1501303146.tcloudbaseapp.com/wg-kechengbiao/check.html` 2026-10-07 实测 200 可打开；页内「执行写入测试」按钮走的即 #3 同一条写链路。提交 `e37a96b` |
| 6 | api-contract.md 完整性 | 检查契约是否覆盖已实现接口 + 先改契约再写代码的留痕 | PASS | `api-contract.md` v1.4：含包络、错误码表（含 450 平台层）、Course 字段表、2.4 建表、3.1 health / 3.2 GET / 3.3 POST 均标已实现，3.4 PATCH 已占位登记（Day 22）；变更记录 4 条留痕。提交 `dfb108e` 起步 |

## 二、同伴交叉验证（三行结论模板）

> 同伴操作指引：
> 1. 打开首页 `https://wg-kechengbiao-d9gi92b9ma9e7f71c-1501303146.tcloudbaseapp.com/wg-kechengbiao/` —— 看课程列表是否显示
> 2. 打开检查台 `…/wg-kechengbiao/check.html` —— 点「执行写入测试」，看是否显示「✅ 写入成功」
> 3. 全程开着 F12 → Console，看有没有红色报错

同伴请按下面三行原样填（能 / 不能 + 一句话）：

```
1. 能否打开：【　　】——（看到的页面/现象一句话）
2. 能否真实读写：【　　】——（写入测试按钮的结果一句话）
3. 有无报错：【　　】——（F12 Console 现象一句话，无报错就写"无"）
```

- 交叉验证人：＿＿＿＿＿　日期：＿＿＿＿＿

## 三、本周未完成项（如实标记）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| import 页前端接线 POST（T4 写半边） | 未执行 | 后端接口已 PASS（#3），但导入页还没从假交互改成调真实接口 |
| Day 15 文档口径同步（PRD / TECH_DESIGN / README / RUN.md 仍写「无后端」） | 未执行 | 技术路线 Day 15 已改为 CloudBase，文档未跟上 |
| 周视图 668px 网格手机横滑体验 | 待确认 | 需真机确认是否可接受，本周未做 |
| Day 21 清单外顺手修复 | 未做（按清单要求记录到下周） | 无 |

## 四、降级项核对（卡住降级指令）

「公网可访问」（#2 health 200 + check.html 200）与「真实读写」（#3 POST 实测）两项均已优先补齐，未触发降级。
