# WG课程表 · 安全自查清单

> 用途：每次上线 / 大改动后，照着过一遍。每项都给「怎么验证」，验证不过就是没做完。
> 建立：Day 23（错误处理与安全审计）。

## 1. 无硬编码密钥

**要求**：代码、文档、SQL、HTML 里都不得出现真实的密钥值（API Key、token、密码原文）。

**验证方法**（在仓库根目录的 cmd 里跑，预期输出 0 行）：

```
findstr /s /i "apiKey secret token password" *.js *.html *.sql *.md | findstr /v /i "hasApiKey process.env SECRET_KEY"
```

说明：先搜密钥特征词，再把三类「合法出现」（函数名 `hasApiKey`、环境变量引用 `process.env`、文档说明词 `SECRET_KEY`）剔除，剩下的才是真写死的密钥。

**最近一次验证**：Day 23，结果 0 条（有截图）。

## 2. 密钥只走环境变量

**要求**：后端读密钥只用 `process.env.RDB_API_KEY`；真实值只配在 CloudBase 控制台的函数环境变量里，不落盘、不进代码。

**验证方法**：
1. 全仓库搜 `RDB_API_KEY`，每一处都应是「环境变量引用」或「错误提示文案」，不能有等号后面跟真值；
2. CloudBase 控制台 → 云函数 `courses` → 环境变量，确认 `RDB_API_KEY` 配在那里。

**最近一次验证**：Day 23，6 处出现全是引用，控制台已配置。

## 3. `.env` 不进仓库

**要求**：`.env`（真实密钥文件，如果本地建了）必须被 Git 忽略；`.env.example`（无真值的样板）正常提交。

**验证方法**：
```
git check-ignore -v .env        ← 应命中 .gitignore 的规则
git status                      ← 应看不到任何 .env 文件
```

**最近一次验证**：Day 23，两条都过（`.gitignore` 第 9 行规则生效）。

## 4. Git 历史无密钥

**要求**：不光现在干净，历史上也从没提交过密钥（历史删了也算泄过密）。

**验证方法**：
```
git log --all -p -S "tcloudbasegateway" | findstr /i "Bearer apiKey"
git log --all --pretty=format: --name-only | findstr /i ".env secret credential"
```
两条都预期 0 行。

**最近一次验证**：Day 23，0 条。若将来发现泄漏：立即在 CloudBase 控制台作废旧 Key、重建新 Key、更新函数环境变量——只删代码里的记录没用，Key 一旦泄过就要当废处理。

## 5. 错误提示全中文、不漏内部细节

**要求**：三类错误（输入错 / 网络错 / 服务端错）给用户的提示都是定稿中文，不把英文报错原文（`err.message`）拼进用户可见文案；细节只进 `console.error` 服务器日志。

**验证方法**（浏览器实测）：
1. 输入错：访问 `/api/courses?limit=999` → 应显示 `limit 必须是 1-500 的整数`；
2. 网络错：F12 网络面板选「脱机」→ 控制台执行 `bootstrap()` → 应显示我们的 V1.8 错误页「连不上课程服务器，请检查网络后重试」；
3. 服务端错：走代码审查（防御路径线上难触发），确认 `fail(res, 500, ...)` 的文案无 `${err.message}` 拼接。

**最近一次验证**：Day 23，1、2 实测通过（有截图），3 代码审查通过（Day 23 改掉 4 处拼接）。

## 6. 部署临时包无残留

**要求**：`deploy-pack/` 这类临时部署目录用完即删，里面常有配置快照，容易夹带密钥。

**验证方法**：仓库根目录 `dir deploy-pack` → 应提示找不到文件。

**最近一次验证**：Day 23，已不存在。
