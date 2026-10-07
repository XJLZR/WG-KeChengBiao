# API 契约（api-contract.md）

> **状态**：Day 15 初稿（v1.0）。本文件是前端与云函数之间的接口约定：前端按它发请求，后端按它返回。后续每加一个接口、改一个字段，都必须先改这份文件再写代码。
>
> **当前进度**：仅 `/api/health` 已实现（Day 15），其余为占位登记，实现时间见各条。

## 1. 基础信息

| 项 | 值 |
| --- | --- |
| Base URL | `https://wg-kechengbiao-d9gi92b9ma9e7f71c-1501303146.ap-shanghai.app.tcloudbase.com` |
| 数据格式 | 请求与响应均为 JSON（`Content-Type: application/json`） |
| 编码 | UTF-8 |
| 鉴权 | 免鉴权（HTTP 网关路由已关闭身份认证；本项目不引入账号体系） |
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
| 404 | `NOT_FOUND` | 资源不存在（如课程 id 无效） |
| 405 | `METHOD_NOT_ALLOWED` | 请求方法不对（如对只读接口发 POST） |
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

## 3. 接口清单

### 3.1 GET /api/health —— 健康检查 ✅ 已实现（Day 15）

- **请求参数**：无
- **成功响应**（HTTP 200）：

```json
{ "ok": true, "service": "wg-timetable", "time": "2026-10-07T04:18:32.511Z" }
```

- **说明**：`time` 为服务器当前时间（ISO 8601），每次请求都变，用于确认非缓存。本接口不使用 2.1 的包络，`ok` 直接在顶层。
- **实现载体**：CloudBase Web 函数 `health`（Node.js 20，监听 9000 端口），经 HTTP 网关路由 `/api/health` 映射。

### 3.2 GET /api/courses —— 课程列表（Day 17 实现）

- **请求参数**：无（本期只有单用户数据，无需筛选参数）
- **成功响应**（HTTP 200）：

```json
{ "ok": true, "data": { "courses": [ { "id": "…", "name": "…", "weekday": 3, "periods": [6,7], "location": "…", "teacher": "…", "weeks": [1,5] } ], "count": 42 } }
```

- **错误**：见 2.2 错误码表。

### 3.3 POST /api/courses/import —— 导入课表（Day 18 实现）

- **请求体**：

```json
{ "courses": [ { "id": "…", "name": "…", "weekday": 3, "periods": [6,7], "weeks": [1,2,3] } ] }
```

- **行为**：整体替换数据库中的课程集合（与现有「导入即替换」的口径一致）。替换前服务端应校验每条记录的必填字段（`id`/`name`/`weekday`/`periods`/`weeks`），任一条不合法则整批拒绝、不部分写入。
- **成功响应**（HTTP 200）：`{ "ok": true, "data": { "imported": 42 } }`
- **错误**：`BAD_REQUEST`（任一条记录缺必填字段 / `courses` 不是数组）。

### 3.4 PATCH /api/courses/:id —— 修改课程（Day 22 实现）

- **路径参数**：`id` = 课程记录的 `id`
- **请求体**（只传要改的字段，部分更新）：

```json
{ "location": "教A-105", "teacher": "张老师" }
```

- **成功响应**（HTTP 200）：`{ "ok": true, "data": { "updated": { …更新后的完整课程对象… } } }`
- **错误**：`NOT_FOUND`（id 不存在）、`BAD_REQUEST`（试图修改 `id` 字段本身）。

### 3.5 DELETE /api/courses/:id —— 删除课程（Day 22 实现）

- **路径参数**：`id` = 课程记录的 `id`
- **请求体**：无
- **成功响应**（HTTP 200）：`{ "ok": true, "data": { "deletedId": "…" } }`
- **错误**：`NOT_FOUND`（id 不存在）。

## 4. 本期明确不做的接口

| 接口 | 不做的理由 |
| --- | --- |
| 账号 / 登录 | 不引入账号体系（PRD 第 6 节） |
| 定时自动同步热搜/外部数据 | 本项目数据来源是用户上传的课表文件，无公开数据源可拉 |
| 课表分享链接 | 未在 MVP 清单内（PRD v1.2 共 9 项） |

## 5. 变更记录

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-10-07 | v1.0 | Day 15 初稿：登记 5 条接口，实现 `/api/health`，其余占位 |
