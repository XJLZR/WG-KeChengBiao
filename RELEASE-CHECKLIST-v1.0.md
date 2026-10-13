# 发布清单（v1.0）

> 生成于 Day 26（2026-10-13）。本清单记录 v1.0 的真实发布过程，后续版本发布照此执行。

## 一、版本标记

| 项 | 值 |
| --- | --- |
| 版本号 | v1.0 |
| 标签类型 | 附注标签（annotated tag） |
| 所在提交 | `953e633`（Day 25｜verify-project 发布前检查 Skill） |
| 打标签命令 | `git tag -a v1.0 -m "v1.0 首个正式发布：MVP 10 项全完成（导入/口令多用户/周视图/设置上云/.ics）"` |
| 推送 | `git push origin v1.0`（已执行，GitHub 端可见 `v1.0`） |
| 发布范围 | 静态托管 17 个文件（5 页面 + 2 CSS + 10 JS） |

## 二、发布前验证项

命令（项目根目录执行）：

```bash
node .workbuddy/skills/verify-project/checks/run-all.js
```

8 项检查，任何一项 FAIL 即不可发布。**v1.0 发布时实跑结果（2026-10-13 22:33）：8/8 PASS**：

| # | 检查项 | 发布时结果 |
| --- | --- | --- |
| 1 | 密钥不入库（扫描 44 个文件） | PASS，命中 0 |
| 2 | 静态资源相对路径（5 个页面） | PASS，根路径引用 0 |
| 3 | 页面脚本引用顺序 | PASS，5 个页面顺序全对 |
| 4 | 云函数健康 | PASS，`/api/health` HTTP 200，`{"ok":true}` |
| 5 | 口令隔离 | PASS，无 code→400 / 假 code→404 |
| 6 | CORS 头不重复 | PASS，出现 1 次 |
| 7 | 解析器幂等 | PASS，两次解析逐字节一致 |
| 8 | 文档口径一致 | PASS，契约 v1.8 三处一致 |

## 三、发布步骤（静态托管）

1. 确认工作区干净：`git status`（必须 `working tree clean`）；
2. 跑第二节 8 项检查，全 PASS 才继续；
3. 打 tag 并推送（命令见第一节）；
4. 上传 17 个文件到 CloudBase 静态托管，**目标前缀 `wg-kechengbiao/`**：
   - 页面：`index.html` `entry.html` `import.html` `settings.html` `check.html`
   - 样式：`css/base.css` `css/pages.css`
   - 脚本：`js/ics.js` `js/parser.js` `js/schedule-code.js` `js/schedule.js` `js/settings-store.js` `js/ui-entry.js` `js/ui-home.js` `js/ui-import.js` `js/ui-modal.js` `js/ui-settings.js`
5. 上传结果必须 `successCount: 17, failedFiles: []`。

**线上地址**：`https://wg-kechengbiao-d9gi92b9ma9e7f71c-1501303146.tcloudbaseapp.com/wg-kechengbiao/`

## 四、发布后验证

1. 抽关键文件逐字节比对：从线上拉回文件与本地比对，必须完全一致（v1.0 实测抽 9 个，全一致）；
2. 首页公网访问 HTTP 200；
3. 云函数健康：`/api/health` HTTP 200；
4. 人在浏览器打开公网地址，确认页面正常（今日课程卡片、周数、日期都对）。

## 五、代码与数据备份方式

**代码备份（两层，已就位）**：

- 本地仓库 `D:\WG课程表`（git，含完整历史）；
- 远端 GitHub `XJLZR/WG-KeChengBiao`（每次收尾推送）；发布版本用 tag 固定（`v1.0`），任何时候 `git checkout v1.0` 可还原发布态。

**数据备份（云端 PostgreSQL）**：

| 备份物 | 位置 | 说明 |
| --- | --- | --- |
| 全量图纸 | `db/schema.sql` | 建表语句，可重复执行 |
| 种子数据 | `db/seed.sql` | 初始数据 |
| 增量迁移 | `cloudbase/migrations/`（3 个版本化迁移文件） | 建表 / 加口令列 / 建 settings 表，按时间戳排序 |
| 全量数据导出 | `backup-day24.json`（Day 24 导出，34 门课样本） | 数据误删后可参照恢复 |
| 用户级备份 | 设置页「备份导出 / 导入」（Day 25） | 单个用户自己导出自己的设置与课表 |

**发布前建议动作**：导出一次数据库全量 JSON（沿用 Day 24 的导出方式，文件名带日期），确认无误再发布。
