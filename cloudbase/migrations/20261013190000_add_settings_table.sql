-- ============================================================
-- WG课程表 · 迁移：设置上云（Day 26，推翻 Day 25 的「设置存本机」拍板）
-- 配套 api-contract.md v1.8 第 2.6 / 3.6 / 3.7 节
--
-- 背景：用户实测微信内置浏览器与系统浏览器的 localStorage 互不相通，
-- 设置存本机导致「微信里调好、换浏览器打开又要重调」。设置改为
-- 跟随课表口令存云端，与 courses 同口径隔离。
--
-- 变更内容：新建 settings 表
--   code            课表口令，主键（与 courses.code 同规格，见契约 2.5）
--   semester_start  学期第一周周一，YYYY-MM-DD（服务端校验必须是周一）
--   period_times    12 节起止时间 JSONB，[{"start":"08:00","end":"08:45"}, ...]
--   updated_at      最后保存时刻（排查用，接口不下发）
-- 设置与课程相互独立：没课也能存设置，清课不动设置。
-- ============================================================

CREATE TABLE settings (
  code           VARCHAR(12) PRIMARY KEY,
  semester_start VARCHAR(32) NOT NULL,
  period_times   JSONB       NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_settings_code CHECK (code ~ '^[A-HJ-NP-Z2-9]{6}$')
);

COMMENT ON TABLE  settings               IS '设置表：每口令一份学期起点+节次时间表（契约 2.6）；设置独立于课程存在';
COMMENT ON COLUMN settings.code           IS '课表口令（契约 2.5），主键';
COMMENT ON COLUMN settings.semester_start IS '学期第一周周一，YYYY-MM-DD，必须是周一';
COMMENT ON COLUMN settings.period_times   IS '12 节起止时间，[{"start":"HH:MM","end":"HH:MM"} × 12]';
