-- ============================================================
-- WG课程表 · 迁移：课表口令（Day 25，拍板方案 B「课表口令」多用户隔离）
-- 配套 api-contract.md v1.7 第 2.5 节
--
-- 变更内容：
--   1. courses 加 code 列（课表口令，6 位，VARCHAR(12) 留余量）+ 索引；
--   2. courses.id 与 course_weeks.course_id 列宽 128 → 160：
--      同班同学导入同一份文件会产生相同的原始 id（id = 星期-节次串-课程名-地点），
--      id 是全局主键，服务端导入时统一加口令前缀「CODE-原id」（6+1+128=135），
--      128 列宽装不下，故放宽到 160。
--
-- 前置/后续（执行顺序由实施会话负责，本文件只描述结构变更）：
--   迁移后按主人拍板清空两表现有数据（Day 25 备份已存
--   .workbuddy/tools/day25-parser/backup-baseline.json）。
-- ============================================================

-- 1. 列宽放宽（先放宽再动 code，因为 id 是主键、course_id 是外键，两边必须同时改）
ALTER TABLE courses ALTER COLUMN id TYPE VARCHAR(160);
ALTER TABLE course_weeks ALTER COLUMN course_id TYPE VARCHAR(160);

-- 2. 加口令列。NOT NULL 需 DEFAULT（表里有存量行）；迁移后清空数据，DEFAULT 随后无意义但无害
ALTER TABLE courses ADD COLUMN code VARCHAR(12) NOT NULL DEFAULT '';

-- 3. 口令过滤是每个请求都要走的路，必须有索引
CREATE INDEX idx_courses_code ON courses (code);

COMMENT ON COLUMN courses.code IS '课表口令（api-contract.md 2.5）：6 位大写字母数字，去掉 0/O/1/I；口令=房间号+钥匙，接口按它过滤读写';
