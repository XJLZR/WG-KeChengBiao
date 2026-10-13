# API 契约（api-contract.md）

> **状态**：Day 15 初稿（v1.0）。本文件是前端与云函数之间的接口约定：前端按它发请求，后端按它返回。后续每加一个接口、改一个字段，都必须先改这份文件再写代码。
>
> **当前进度**：`/api/health`（Day 15）、`GET /api/courses`（Day 17）、`POST /api/courses/import`（Day 18）、`PATCH /api/courses/:id` 与 `DELETE /api/courses/:id`（Day 22）均已实现——**增、删、改、查四类操作闭环**（Day 22）。**Day 16：数据模型落地（2.4 节），数据库两表已建并灌入种子数据。Day 17：GET 读接口上线，从两表读真实数据并完成公网验证。**

## 1. 基础信息

| 项 | 值 |
| --- | --- |
| Base URL | `https://wg-kechengbiao-d9gi92b9ma9e7f71c-1501303146.ap-shanghai.app.tcloudbase.com` |
| 数据格式 | 请求与响应均为 JSON（`Content-Type: application/json`） |
| 编码 | UTF-8 |
| 鉴权 | 免账号登录（**Day 25 拍板方案 B「课表口令」**）。访问隔离靠课表口令：所有课程接口必须携带 `?code=` 参数，接口只读写该口令对应的数据（见 2.5） |
| 环境 | CloudBase 环境 `wg-kechengbiao-d9gi92b9ma9e7f71c`（上海，免费体验版） |
| 前端地址 | `https://wg-kechengbiao-d9gi92b9ma9e7f71c-1501303146.tcloudbaseapp.com/wg-kechengbiao/`（mock 数据版，Day 15） |

## 2. 通用约定

### 2.1 响应包络

所有业务接口（`/api/health` 除外）的响应使用统一包络：

```json
// 成功
{ "ok": true, "data": { ... } }

// 失败（HTTP 状态码同时为 4xx / 5xx）
{ "ok": false, "error": { "code": "BAD_REQUEST", "message": "人类可读的错误说明" } }
```

### 2.2 错误码表

| HTTP 状态码 | error.code | 触发场景 |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | 请求体缺字段、字段类型不对 |
| 400 | `MISSING_CODE`（Day 25） | 请求未携带课表口令 `code`（2.5） |
| 400 | `INVALID_CODE`（Day 25） | 口令格式不对（应为 6 位大写字母数字，不含 0/O/1/I） |
| 404 | `NOT_FOUND` | 资源不存在（如课程 id 无效） |
| 404 | `SCHEDULE_NOT_FOUND`（Day 25） | 该口令在数据库中没有任何课程（口令不存在或输错）——故意与「课表是空的」区分，防止口令打错被误认为还没导入 |
| 405 | `METHOD_NOT_ALLOWED` | 请求方法不对（如对只读接口发 POST） |
| 450 | `UPSTREAM_UNAVAILABLE`（平台层） | 云函数实例未在监听端口就绪，网关等待约 65 秒超时后返回。**响应体为空，不遵循 2.1 包络**。前端统一按「服务暂时不可用」兜底提示（Day 15 实测） |
| 500 | `SERVER_ERROR` | 服务端异常（含数据库读写失败） |

### 2.3 课程对象（Course）

字段定义与 `TECH_DESIGN.md` 3.1 节完全一致，接口传输时使用同一结构：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 唯一标识，`星期-节次串-课程名-地点` 拼接 |
| `name` | string | 是 | 课程名 |
| `weekday` | number | 是 | 星期 1–7（1 = 周一） |
| `periods` | number[] | 是 | 节次数组，如 `[6,7]` |
| `location` | string | 否 | 地点，空字符串表示「无」 |
| `teacher` | string | 否 | 教师，空字符串表示「无」 |
| `weeks` | number[] | 是 | 周次集合，如 `[1,5,9,13]` |
| `className` | string | 否 | 班级名称（解析保留） |
| `scheduleDate` | string | 否 | 排课日期（解析保留） |
| `courseOrder` | string | 否 | 课序（解析保留） |
| `type` | string | 否 | 类型（解析保留） |

### 2.4 数据库表结构（Day 16 建）

数据库为 CloudBase PostgreSQL（免费体验版自带）。方案 A：两张表，靠 `course_id` 字段关联。

**表 1：`courses`（课程主表）** —— 一行 = 2.3 的一条课程记录：

| 列名 | 类型 | 约束 | 对应契约字段 |
| --- | --- | --- | --- |
| `id` | VARCHAR(160) | 主键 | `id`（业务串，非自增；Day 25 起带口令前缀，见 2.5） |
| `code` | VARCHAR(12) | NOT NULL，**索引** | ——（课表口令，2.5；请求作用域字段，不进 2.3 课程对象） |
| `name` | VARCHAR(64) | NOT NULL | `name` |
| `weekday` | SMALLINT | NOT NULL，CHECK 1–7 | `weekday` |
| `periods` | JSONB | NOT NULL | `periods`（存 `[6,7]` 原样） |
| `location` | VARCHAR(64) | NOT NULL DEFAULT '' | `location`（空串 = 无） |
| `teacher` | VARCHAR(64) | NOT NULL DEFAULT '' | `teacher` |
| `class_name` | VARCHAR(64) | NOT NULL DEFAULT '' | `className` |
| `schedule_date` | VARCHAR(32) | NOT NULL DEFAULT '' | `scheduleDate` |
| `course_order` | VARCHAR(32) | NOT NULL DEFAULT '' | `courseOrder` |
| `type` | VARCHAR(32) | NOT NULL DEFAULT '' | `type` |

**表 2：`course_weeks`（周次明细表）** —— 一行 = 某门课的某个周次（`weeks` 数组的展开）：

| 列名 | 类型 | 约束 | 对应契约字段 |
| --- | --- | --- | --- |
| `id` | BIGINT IDENTITY | 主键（自增） | ——（数据库内部） |
| `course_id` | VARCHAR(160) | NOT NULL，外键 → `courses.id`，级联删除 | ——（关联字段） |
| `week` | SMALLINT | NOT NULL，CHECK 1–30，`(course_id, week)` 唯一 | `weeks` 数组的单个元素 |

**设计要点**：

1. `weeks` 拆表：判断「这周有没有课」是高频查询，一行一个周次才能用 SQL 直接过滤；`periods` 只做展示，留 JSONB 不拆（两张表的对称性让位于查询价值）。
2. 契约的 camelCase 字段落库转 snake_case，**映射由云函数在读写时承担**（Day 17 起），对前端契约保持 2.3 原样。
3. 行级安全（RLS）暂未启用：本项目免鉴权，数据全走云函数服务端访问，浏览器不直连数据库；Day 17 写接口时按需评估。
4. 脚本与迁移：全量图纸 `db/schema.sql`、种子 `db/seed.sql`（可重复执行）；建表迁移版本 `20261007052345_create_courses_and_course_weeks`；Day 25 迁移版本 `20261013141000_add_schedule_code`（加 `code` 列 + 索引、id 列宽 128→160）。

### 2.5 课表口令（Day 25 新增）

- **格式**：6 位大写字母数字，字符集去掉易混淆的 `0/O/1/I`（正则 `^[A-HJ-NP-Z2-9]{6}$`）。
- **生成**：前端「创建新课表」时自动生成，**不支持自定义**（Day 25 拍板）。口令由用户自行保存，浏览器 localStorage 另存一份；分享链接 `网址?code=口令` 可直达对应课表。
- **隔离模型**：口令 = 房间号 + 钥匙合一。所有课程接口按 `code` 过滤，知道口令即可读写该课表；不同口令的数据互不可见。知道口令即拥有该课表的读写权，这是方案 B 的已知边界（校园场景够用）。
- **id 前缀**：同班同学导入**同一份文件**会产生相同的原始 id（id = 星期-节次串-课程名-地点），而 id 是全局主键——服务端在导入写入时为每条 id 统一加口令前缀（`CODE-原始id`），保证不同口令永不相撞；同一口令重复导入 id 稳定不变。因此 2.4 的 id 列宽放宽到 160（6 位口令 + 1 连字符 + 原 id ≤128）。
- **「口令存在」的定义**：该口令名下课程数 > 0。首次向新口令导入即「创建课表」，把某口令的课程清空后该口令视为不存在。

## 3. 接口清单

### 3.1 GET /api/health —— 健康检查 ✅ 已实现（Day 15）

- **请求参数**：无
- **成功响应**（HTTP 200）：

```json
{ "ok": true, "service": "wg-timetable", "time": "2026-10-07T04:18:32.511Z" }
```

- **说明**：`time` 为服务器当前时间（ISO 8601），每次请求都变，用于确认非缓存。本接口不使用 2.1 的包络，`ok` 直接在顶层。
- **错误响应**：本接口没有业务错误。平台故障时可能返回 450（函数未就绪，见 2.2）或连接超时，此时响应体可能为空。前端约定：只要拿不到 HTTP 200 + 合法 JSON，即判定「后端不可用」。
- **实现载体**：CloudBase Web 函数 `health`（Node.js 20，监听 9000 端口），经 HTTP 网关路由 `/api/health` 映射。

### 3.2 GET /api/courses —— 课程列表 ✅ 已实现（Day 17）

- **请求参数**（query string）：
  - `code`：课表口令（**Day 25 起必填**，2.5）。缺少 → `MISSING_CODE`（400）；格式不对 → `INVALID_CODE`（400）；口令名下没有任何课程 → `SCHEDULE_NOT_FOUND`（404）
  - `limit`：返回条数上限，正整数 1–500；不传 = 返回全部（Day 17 余力加练）。非整数或越界按 `BAD_REQUEST`（400）拒绝
- **成功响应**（HTTP 200）：

```json
{ "ok": true, "data": { "courses": [ { "id": "…", "name": "…", "weekday": 3, "periods": [6,7], "location": "…", "teacher": "…", "weeks": [1,5] } ], "count": 42 } }
```

- **字段说明**：`courses` 按星期、节次、课名升序排列；每条含 2.3 的全部契约字段（含 `className`/`scheduleDate`/`courseOrder`/`type` 解析保留字段）；`count` = 本次返回的课程条数
- **错误**：`MISSING_CODE` / `INVALID_CODE` / `SCHEDULE_NOT_FOUND`（见上）、`BAD_REQUEST`（limit 非法）、`METHOD_NOT_ALLOWED`（非 GET）、`NOT_FOUND`（路径不匹配）、`SERVER_ERROR`（网关/数据库读取失败），见 2.2 错误码表
- **实现载体**：CloudBase Web 函数 `courses`（Node.js 20，监听 9000 端口），经 HTTP 网关路由 `/api/courses`（已开路径透传、免鉴权）。数据访问走 **PG HTTP 网关**（PostgREST 语法）读 `courses` + `course_weeks` 两表并组装 `weeks` 数组——免费体验版共享集群无内网/外网直连地址（Day 17 实测配置页内网地址为空），pg 协议直连不可行，采用官方 HTTP API 兜底路径；鉴权用环境变量 `RDB_API_KEY`（API Key，service_role），不进代码仓库

### 3.3 POST /api/courses/import —— 导入课表 ✅ 已实现（Day 18；Day 25 加口令）

- **URL**：必须携带 `?code=课表口令`（2.5）。缺少 → `MISSING_CODE`（400）；格式不对 → `INVALID_CODE`（400）
- **请求体**：

```json
{ "courses": [ { "id": "…", "name": "…", "weekday": 3, "periods": [6,7], "weeks": [1,2,3] } ] }
```

- **行为（Day 25 口令化）**：只替换**该口令**名下的课程集合（其他口令的数据不动）。该口令已有课程 = 整体替换（原「导入即替换」语义收窄到口令范围内）；该口令是新口令 = 直接创建课表。替换前服务端校验每条记录的必填字段（`id`/`name`/`weekday`/`periods`/`weeks`），任一条不合法则整批拒绝、不部分写入。写入时服务端为每条 id 加口令前缀（2.5），前端提交的原始 id 保持不变。
- **防重复（Day 18 拍板）**：同一批内出现重复的 `id`，整批拒绝（`BAD_REQUEST`，错误信息指明重复的 id）。重复提交内容完全相同的批次属于合法的再次导入，按整体替换处理、返回成功——「导入即替换」是本接口的语义，与逐条打卡场景不同。
- **成功响应**（HTTP 200）：`{ "ok": true, "data": { "imported": 42 } }`
- **错误**：`BAD_REQUEST`（任一条记录缺必填字段 / 字段类型不对 / `courses` 不是数组 / `courses` 为**空数组**——空数组按整批拒绝处理，防止前端异常一次清空全部课程 / 同批 `id` 重复 / 超规模上限）。错误信息为中文，指明第几条、缺什么或错什么。
- **规模上限**：`courses` 预期不超过 500 条（整学期展开约 100–300 条）、请求体不超过 512KB；超限按 `BAD_REQUEST` 拒绝。

### 3.4 PATCH /api/courses/:id —— 修改课程 ✅ 已实现（Day 22；Day 25 加口令）

- **URL**：必须携带 `?code=课表口令`（2.5）。只在**该口令**范围内查找 id；找不到（id 错或口令错）→ `NOT_FOUND`，错误信息提示核对口令
- **请求体**（只传要改的字段，部分更新）：

```json
{ "location": "教A-105", "teacher": "张老师" }
```

- **成功响应**（HTTP 200）：`{ "ok": true, "data": { "updated": { …更新后的完整课程对象… } } }`
- **可修改字段白名单**：`name`、`weekday`、`periods`、`location`、`teacher`、`weeks`、`className`、`scheduleDate`、`courseOrder`、`type`——即除 `id` 外的全部字段。请求体出现白名单之外的字段或含 `id`，按 `BAD_REQUEST` 拒绝。
- **id 不重算**：`id` 的生成规则虽由多个字段拼接，但 PATCH 修改构成字段后 **`id` 保持原值不变**，保证外部引用（收藏、备注等）不失效。
- **错误**：`NOT_FOUND`（id 不存在）、`BAD_REQUEST`（请求体含 `id` 或白名单之外的字段；`name` 置空——空串或纯空格视同「没填课程名」，与 3.3 导入校验同规则。Day 24 修复：此前 PATCH 漏了这条，空课名能写库）。

### 3.5 DELETE /api/courses/:id —— 删除课程 ✅ 已实现（Day 22；Day 25 加口令）

- **URL**：必须携带 `?code=课表口令`（2.5）。只在**该口令**范围内查找 id；找不到 → `NOT_FOUND`，错误信息提示核对口令
- **请求体**：无
- **成功响应**（HTTP 200）：`{ "ok": true, "data": { "deletedId": "…" } }`
- **错误**：`NOT_FOUND`（id 不存在）。

## 4. 本期明确不做的接口

| 接口 | 不做的理由 |
| --- | --- |
| 账号 / 登录 | 不引入账号体系；多用户隔离由课表口令承担（2.5，Day 25 拍板方案 B） |
| 定时自动同步热搜/外部数据 | 本项目数据来源是用户上传的课表文件，无公开数据源可拉 |

## 5. 变更记录

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-10-07 | v1.0 | Day 15 初稿：登记 5 条接口，实现 `/api/health`，其余占位 |
| 2026-10-07 | v1.1 | Day 15 自查补漏：health 补错误形状、错误码表补 450、import 补空数组与规模上限、PATCH 补字段白名单与 id 不重算 |
| 2026-10-07 | v1.2 | Day 16：新增 2.4 数据库表结构（`courses` + `course_weeks`，方案 A），建表与种子脚本入库，接口字段与数据库落位对齐 |
| 2026-10-07 | v1.3 | Day 17：3.2 标记已实现；补 `limit` 查询参数定义（余力加练）；登记实现载体（Web 函数 `courses` + PG HTTP 网关，免费版无直连地址故不走 pg 协议） |
| 2026-10-07 | v1.4 | Day 18：3.3 明确防重复约定——同批重复 `id` 整批拒绝；重复提交相同批次按整体替换返回成功；补错误信息中文口径 |
| 2026-10-09 | v1.5 | Day 22：3.3/3.4/3.5 标记已实现，增删改查闭环。PATCH：白名单校验（含 id 不可改）、weeks 改动走子表删旧插新、id 保持原值；DELETE：先验存在性，子表靠外键级联删除；两者不存在的 id 均返回 404 中文说明 |
| 2026-10-12 | v1.6 | Day 24：3.4 补「`name` 不可置空（空串/纯空格按 BAD_REQUEST 拒绝）」——Day 24 测试清单 B2-5c 实测 PATCH 传空课名返回 200 并写库（POST 路径同规则本就有），属两条校验路径不一致，修复 `validatePatchBody` |
| 2026-10-13 | v1.7 | Day 25 多用户改造（拍板方案 B「课表口令」）：新增 2.5 口令规格（6 位、去 0/O/1/I、不可自定义）；3.2/3.3/3.4/3.5 全部加必填 `?code=`；新增错误码 `MISSING_CODE`/`INVALID_CODE`/`SCHEDULE_NOT_FOUND`；import 从「替换全库」收窄为「替换该口令」，新口令=创建；服务端为 id 加口令前缀防同学同文件主键相撞；2.4 的 id/course_id 列宽 128→160 并给 courses.code 建索引；「课表分享链接」移出「不做」清单（`?code=` 即分享） |
