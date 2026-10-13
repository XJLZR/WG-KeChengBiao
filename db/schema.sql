-- ============================================================
-- WG课程表 · 数据库结构（PostgreSQL）
-- 依据：api-contract.md v1.1 第 2.3 节「课程对象（Course）」逐字段推导
-- 方案 A：courses（课程主表）+ course_weeks（周次明细表），靠 course_id 关联
--
-- 设计决策（Day 16 拍板）：
--   1. weeks 拆成子表：判断「这周有没有课」是高频查询，一行一个周次才能用 SQL 直接查；
--   2. periods 留 JSONB：最多两三个值、只做展示不参与查询，拆表不划算；
--   3. 契约里的 camelCase 字段（className 等）落库转 snake_case，
--      由 Day 17 云函数在读写时做映射，契约对前端保持不变。
--
-- 本脚本可重复执行：先删后建（现阶段库里只有种子数据，无真实数据）。
-- ⚠️ 有真实数据后禁止直接跑本脚本，改用增量迁移。
-- ============================================================

-- 建表前先删旧表：先删子表，避免外键引用挡路；CASCADE 连带清掉依赖对象
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS course_weeks CASCADE;
DROP TABLE IF EXISTS courses CASCADE;

-- ------------------------------------------------------------
-- 课程主表：一行 = 契约 2.3 的一条课程记录
-- ------------------------------------------------------------
CREATE TABLE courses (
  id            VARCHAR(160) PRIMARY KEY,
  code          VARCHAR(12)  NOT NULL DEFAULT '',
  name          VARCHAR(64)  NOT NULL,
  weekday       SMALLINT     NOT NULL,
  periods       JSONB        NOT NULL,
  location      VARCHAR(64)  NOT NULL DEFAULT '',
  teacher       VARCHAR(64)  NOT NULL DEFAULT '',
  class_name    VARCHAR(64)  NOT NULL DEFAULT '',
  schedule_date VARCHAR(32)  NOT NULL DEFAULT '',
  course_order  VARCHAR(32)  NOT NULL DEFAULT '',
  type          VARCHAR(32)  NOT NULL DEFAULT '',
  CONSTRAINT chk_courses_weekday CHECK (weekday BETWEEN 1 AND 7)
);

-- 口令过滤是每个请求都要走的路（api-contract.md 2.5，Day 25）
CREATE INDEX idx_courses_code ON courses (code);

CREATE TABLE course_weeks (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id VARCHAR(160) NOT NULL,
  week      SMALLINT     NOT NULL,
  CONSTRAINT uq_course_week UNIQUE (course_id, week),
  CONSTRAINT chk_course_weeks_week CHECK (week BETWEEN 1 AND 30),
  CONSTRAINT fk_course_weeks_course
    FOREIGN KEY (course_id) REFERENCES courses (id)
    ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- 设置表：每口令一份「学期起点 + 节次时间表」（契约 2.6，Day 26）
-- 设置独立于课程存在：没课也能存设置，清课不动设置
-- ------------------------------------------------------------
CREATE TABLE settings (
  code           VARCHAR(12) PRIMARY KEY,
  semester_start VARCHAR(32) NOT NULL,
  period_times   JSONB       NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_settings_code CHECK (code ~ '^[A-HJ-NP-Z2-9]{6}$')
);

-- ============================================================
-- 字段注释（可对照 api-contract.md 2.3 节）
-- ============================================================
COMMENT ON TABLE  courses IS '课程主表：一行 = api-contract.md 2.3 的一条课程记录；多用户隔离靠 code 口令（2.5，Day 25）';
COMMENT ON COLUMN courses.id            IS '课程唯一标识 = 口令前缀 + 「星期-节次串-课程名-地点」（契约：id；Day 25 起服务端导入时加口令前缀）';
COMMENT ON COLUMN courses.code          IS '课表口令（2.5）：6 位大写字母数字，去掉 0/O/1/I；接口按它过滤读写';
COMMENT ON COLUMN courses.name          IS '课程名（契约：name，必填）';
COMMENT ON COLUMN courses.weekday       IS '星期 1-7，1 = 周一（契约：weekday，必填）';
COMMENT ON COLUMN courses.periods       IS '节次数组 JSON，如 [6,7]（契约：periods，必填；留 JSONB 因为只做展示）';
COMMENT ON COLUMN courses.location      IS '上课地点，空字符串表示「无」（契约：location）';
COMMENT ON COLUMN courses.teacher       IS '教师，空字符串表示「无」（契约：teacher）';
COMMENT ON COLUMN courses.class_name    IS '班级名称，解析保留字段（契约：className）';
COMMENT ON COLUMN courses.schedule_date IS '排课日期，解析保留字段，存原文字符串（契约：scheduleDate）';
COMMENT ON COLUMN courses.course_order  IS '课序，解析保留字段（契约：courseOrder）';
COMMENT ON COLUMN courses.type          IS '类型，解析保留字段（契约：type）';

COMMENT ON TABLE  course_weeks          IS '周次明细表：一行 = 某门课的某个周次（契约 weeks 数组的展开，靠 course_id 关联 courses）';
COMMENT ON COLUMN course_weeks.id       IS '自增主键，由数据库分配';
COMMENT ON COLUMN course_weeks.course_id IS '外键 → courses.id；删除课程时周次明细级联删除';
COMMENT ON COLUMN course_weeks.week     IS '周次，1-30（契约：weeks 数组的单个元素）';
