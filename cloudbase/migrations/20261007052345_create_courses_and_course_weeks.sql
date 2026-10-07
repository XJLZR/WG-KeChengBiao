-- WG课程表 · 建表迁移（db/schema.sql 同内容，Day 16）
-- 方案 A：courses（课程主表）+ course_weeks（周次明细表），靠 course_id 关联

DROP TABLE IF EXISTS course_weeks CASCADE;
DROP TABLE IF EXISTS courses CASCADE;

CREATE TABLE courses (
  id            VARCHAR(128) PRIMARY KEY,
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

CREATE TABLE course_weeks (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id VARCHAR(128) NOT NULL,
  week      SMALLINT     NOT NULL,
  CONSTRAINT uq_course_week UNIQUE (course_id, week),
  CONSTRAINT chk_course_weeks_week CHECK (week BETWEEN 1 AND 30),
  CONSTRAINT fk_course_weeks_course
    FOREIGN KEY (course_id) REFERENCES courses (id)
    ON DELETE CASCADE
);

COMMENT ON TABLE  courses IS '课程主表：一行 = api-contract.md 2.3 的一条课程记录';
COMMENT ON COLUMN courses.id            IS '课程唯一标识，由「星期-节次串-课程名-地点」拼接（契约：id）';
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
