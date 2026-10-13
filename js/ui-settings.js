/* ============================================================
   ui-settings.js —— 设置页交互（Day 25 · T8）
   对应：PRD V3.1 / V3.2、F5 / F6、验收 D1 / D2 / D5

   四块功能：
     ① 学期设置：学期第一周周一（必须周一）+ 12 节起止时间，
        显式「保存设置」才写入 localStorage（settings-store.js）；
     ② 恢复默认作息：二次确认 → 清键 → 表单回默认；
     ③ 备份导出 / 导入：当前口令名下的课程（云端拉取 / POST 恢复）
        + 本机设置，打包成一个 JSON 文件；导入目标 = 当前口令；
     ④ 清空全部数据：二次确认 → 逐条 DELETE 当前口令的课程
        → 设置恢复默认（契约没有「清空」接口，逐条删是现实做法）。

   所有网络请求带课表口令（schedule-code.js）；反馈走 ui-modal。
   ============================================================ */

/* 云函数公网地址：与 ui-home.js / ui-import.js 同值（各页一份惯例） */
const SETTINGS_API_BASE_URL =
  'https://wg-kechengbiao-d9gi92b9ma9e7f71c-1501303146.ap-shanghai.app.tcloudbase.com';

/** 备份文件的身份标记：导入时靠它拒绝「不是本产品备份」的 JSON */
const BACKUP_TYPE = 'wg-timetable-backup';

function setupSettingsPage() {
  /* ---------- 表单：加载当前设置 ---------- */

  const dateInput = document.getElementById('setting-semester-start');
  const periodBox = document.getElementById('period-times');
  const saveBtn = document.getElementById('setting-save-btn');
  const resetBtn = document.getElementById('setting-reset-btn');
  const exportBtn = document.getElementById('setting-export-btn');
  const importBtn = document.getElementById('setting-import-btn');
  const importFile = document.getElementById('setting-import-file');
  const icsBtn = document.getElementById('setting-ics-btn');
  const clearBtn = document.getElementById('setting-clear-btn');
  if (!dateInput || !periodBox || !saveBtn) return;

  /** 12 行起止时间输入。用 text + placeholder 而非 type=time：
      jsdom 与部分安卓浏览器对 time 的支持参差，文本框 + 格式校验更稳。
      值形如 '08:00'，与 TIME_PATTERN（settings-store.js）同一格式。 */
  function renderPeriodInputs(settings) {
    periodBox.innerHTML = settings.periodTimes
      .map((p, i) =>
        `<div class="setting-row setting-row--field">` +
        `<span class="setting-row__label">第 ${i + 1} 节</span>` +
        `<input class="setting-row__input setting-row__input--time" type="text" ` +
        `inputmode="numeric" placeholder="08:00" maxlength="5" ` +
        `data-period="${i}" data-edge="start" value="${p.start}" aria-label="第 ${i + 1} 节开始时间">` +
        `<span class="setting-row__dash">–</span>` +
        `<input class="setting-row__input setting-row__input--time" type="text" ` +
        `inputmode="numeric" placeholder="08:45" maxlength="5" ` +
        `data-period="${i}" data-edge="end" value="${p.end}" aria-label="第 ${i + 1} 节结束时间">` +
        `</div>`
      )
      .join('');
  }

  function fillForm(settings) {
    dateInput.value = settings.semesterStart;
    renderPeriodInputs(settings);
  }

  fillForm(getSettings());

  /* ---------- ① 保存 ---------- */

  /** 从表单收集设置。不合法返回 { error: '中文原因' }，合法返回 { settings } */
  function collectForm() {
    const semesterStart = dateInput.value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(semesterStart)) {
      return { error: '请先选择学期第一周的日期。' };
    }
    const d = new Date(semesterStart + 'T00:00:00');
    if (isNaN(d.getTime())) {
      return { error: '学期第一周的日期格式不对。' };
    }
    if (d.getDay() !== 1) {
      return { error: '学期第一周必须选一个周一（周数从周一算起，选别的日子全学期会错位）。' };
    }

    const periodTimes = [];
    for (let i = 0; i < 12; i++) {
      const start = periodBox.querySelector(`input[data-period="${i}"][data-edge="start"]`).value.trim();
      const end = periodBox.querySelector(`input[data-period="${i}"][data-edge="end"]`).value.trim();
      if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) {
        return { error: `第 ${i + 1} 节的时间格式不对，请按「时:分」填写（如 08:00）。` };
      }
      if (start >= end) {
        return { error: `第 ${i + 1} 节的开始时间不能晚于或等于结束时间。` };
      }
      periodTimes.push({ start, end });
    }
    return { settings: { semesterStart, periodTimes, schemaVersion: 1 } };
  }

  saveBtn.addEventListener('click', () => {
    const result = collectForm();
    if (result.error) {
      showStatusModal({ type: 'error', title: '保存失败', desc: result.error });
      return;
    }
    saveSettings(result.settings);
    showStatusModal({
      type: 'success',
      title: '设置已保存',
      desc: '回首页后，周数与状态标签即按新设置计算。',
    });
  });

  /* ---------- ② 恢复默认作息 ---------- */

  resetBtn.addEventListener('click', () => {
    showConfirmModal({
      title: '恢复默认作息？',
      desc: '学期起点与 12 节时间将恢复为默认值，当前自定义的设置会被覆盖。',
      confirmText: '恢复默认',
      onConfirm: () => {
        resetSettings();
        fillForm(getSettings());
        showStatusModal({ type: 'success', title: '已恢复默认作息' });
      },
    });
  });

  /* ---------- ③ 导出备份 ---------- */

  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    showStatusModal({ type: 'loading', title: '正在打包备份…' });

    try {
      const url = apiUrlWithCode(`${SETTINGS_API_BASE_URL}/api/courses`);
      if (!url) {
        window.location.replace('./entry.html');
        return;
      }
      const resp = await fetch(url);
      if (!resp.ok) {
        throw { message: '没能从云端读到当前课表，请稍后再试。' };
      }
      const body = await resp.json();
      if (!body || body.ok !== true || !Array.isArray(body.data.courses)) {
        throw { message: '云端返回的数据不完整，备份中止（未产生文件）。' };
      }

      const backup = {
        type: BACKUP_TYPE,
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        courses: body.data.courses,
        settings: getSettings(),
      };
      downloadJson(backup, `wg课表备份-${new Date().toISOString().slice(0, 10)}.json`);

      showStatusModal({
        type: 'success',
        title: '备份已导出',
        desc: `共 ${body.data.courses.length} 门课 + 本机设置。文件含课表隐私，请妥善保存。`,
      });
    } catch (err) {
      showStatusModal({
        type: 'error',
        title: '导出失败',
        desc: (err && err.message) || '请稍后再试。',
      });
    } finally {
      exportBtn.disabled = false;
    }
  });

  /** 生成文本文件并触发下载（Blob + 隐形链接，纯浏览器行为，不经服务器） */
  function downloadText(text, filename, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadJson(data, filename) {
    downloadText(JSON.stringify(data, null, 2), filename, 'application/json');
  }

  /* ---------- ③ 导入备份 ---------- */

  importBtn.addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', () => {
    const file = importFile.files && importFile.files[0];
    importFile.value = '';   // 清空选择，下次选同一文件也能触发 change
    if (!file) return;

    showStatusModal({ type: 'loading', title: '正在读取备份文件…' });
    file.text()
      .then((text) => {
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          throw { message: '这不是合法的 JSON 文件。' };
        }
        if (!parsed || parsed.type !== BACKUP_TYPE || !Array.isArray(parsed.courses)) {
          throw { message: '这不是本产品导出的备份文件（或已被改动）。' };
        }
        if (!isValidSettings(parsed.settings)) {
          throw { message: '备份里的设置数据不完整，为保护现有数据已中止导入。' };
        }
        if (parsed.courses.length === 0) {
          throw { message: '备份里一门课都没有，为防误清空已中止导入。' };
        }
        if (parsed.courses.length > 500) {
          throw { message: `备份含 ${parsed.courses.length} 门课，超过单批 500 门上限。` };
        }
        return parsed;
      })
      .then((backup) => {
        closeStatusModal();
        showConfirmModal({
          title: '导入这份备份？',
          desc: `备份含 ${backup.courses.length} 门课。导入后：课程恢复到当前口令名下` +
            `（整体替换，现有课程不可从本页恢复），本机设置同步覆盖。`,
          confirmText: '确认导入',
          onConfirm: () => restoreBackup(backup),
        });
      })
      .catch((err) => {
        showStatusModal({
          type: 'error',
          title: '导入失败',
          desc: (err && err.message) || '请确认选的是本产品导出的备份文件。',
        });
      });
  });

  /** 确认后的实际恢复：POST 课程到当前口令 + 写本机设置 */
  async function restoreBackup(backup) {
    showStatusModal({
      type: 'loading',
      title: '正在恢复备份…',
      desc: `共 ${backup.courses.length} 门课`,
    });

    try {
      const postUrl = apiUrlWithCode(`${SETTINGS_API_BASE_URL}/api/courses/import`);
      if (!postUrl) {
        window.location.replace('./entry.html');
        return;
      }
      const resp = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courses: backup.courses }),
      });
      let body = null;
      try { body = await resp.json(); } catch (err) { /* 平台层 450 空响应体 */ }
      if (!resp.ok || !body || body.ok !== true) {
        const msg = body && body.error && body.error.message;
        throw { message: msg || '云端恢复失败，本机设置未改动，请稍后再试。' };
      }

      saveSettings(backup.settings);
      showStatusModal({
        type: 'success',
        title: `恢复完成（${body.data.imported} 门课）`,
        desc: '设置已同步覆盖，回首页即可看到。',
      });
    } catch (err) {
      showStatusModal({
        type: 'error',
        title: '恢复失败',
        desc: (err && err.message) || '请稍后再试。',
      });
    }
  }

  /* ---------- 导出课表日历（.ics，Day 25 · T10） ---------- */

  icsBtn.addEventListener('click', async () => {
    icsBtn.disabled = true;
    showStatusModal({ type: 'loading', title: '正在生成课表日历…' });

    try {
      const url = apiUrlWithCode(`${SETTINGS_API_BASE_URL}/api/courses`);
      if (!url) {
        window.location.replace('./entry.html');
        return;
      }
      const resp = await fetch(url);
      if (resp.status === 404) {
        throw { message: '当前口令名下还没有课表，先去「导入」页导入课程。' };
      }
      if (!resp.ok) {
        throw { message: '没能从云端读到当前课表，请稍后再试。' };
      }
      const body = await resp.json();
      if (!body || body.ok !== true || !Array.isArray(body.data.courses)) {
        throw { message: '云端返回的数据不完整，生成中止。' };
      }

      const courses = body.data.courses;
      const eventCount = courses.reduce((n, c) => n + c.weeks.length, 0);
      const text = generateIcs(courses, getSettings());
      downloadText(text, '课表.ics', 'text/calendar;charset=utf-8');

      showStatusModal({
        type: 'success',
        title: '日历已导出',
        desc: `${courses.length} 门课展开为 ${eventCount} 个日程。` +
          `点开下载的文件，按手机提示导入系统日历即可。`,
      });
    } catch (err) {
      showStatusModal({
        type: 'error',
        title: '导出失败',
        desc: (err && err.message) || '请稍后再试。',
      });
    } finally {
      icsBtn.disabled = false;
    }
  });

  /* ---------- ④ 清空全部数据 ---------- */

  clearBtn.addEventListener('click', () => {
    showConfirmModal({
      title: '清空全部数据？',
      desc: '当前口令名下的全部课程将被删除（后端真删，无回收站），' +
        '本机设置恢复默认。此操作不能撤销，建议先「导出备份」。',
      confirmText: '确认清空',
      onConfirm: () => performClear(),
    });
  });

  async function performClear() {
    showStatusModal({ type: 'loading', title: '正在清空课程…' });

    try {
      const getUrl = apiUrlWithCode(`${SETTINGS_API_BASE_URL}/api/courses`);
      if (!getUrl) {
        window.location.replace('./entry.html');
        return;
      }
      const resp = await fetch(getUrl);
      /* 404 = 该口令本来就没有课程：视为已清空，继续走设置重置 */
      let courses = [];
      if (resp.ok) {
        const body = await resp.json();
        if (!body || body.ok !== true || !Array.isArray(body.data.courses)) {
          throw { message: '没能读到现有课程，为防误删已中止。' };
        }
        courses = body.data.courses;
      } else if (resp.status !== 404) {
        throw { message: `云端读取失败（HTTP ${resp.status}），为防误删已中止。` };
      }

      /* 逐条 DELETE：契约没有批量清空接口；数量 ≤500，顺序删可控。
         中途失败就停下如实报——删了一半也算进度，重试会从剩余继续。 */
      let deleted = 0;
      for (const course of courses) {
        const delUrl = apiUrlWithCode(
          `${SETTINGS_API_BASE_URL}/api/courses/${encodeURIComponent(course.id)}`
        );
        if (!delUrl) {
          window.location.replace('./entry.html');
          return;
        }
        const r = await fetch(delUrl, { method: 'DELETE' });
        if (!r.ok) {
          throw { message: `删到第 ${deleted + 1} 门时失败，已删除 ${deleted} 门；可重试继续清空。` };
        }
        deleted++;
      }

      resetSettings();
      fillForm(getSettings());
      showStatusModal({
        type: 'success',
        title: '已清空',
        desc: courses.length === 0
          ? '该口令名下本就没有课程，设置已恢复默认。'
          : `已删除 ${deleted} 门课，设置已恢复默认。`,
      });
    } catch (err) {
      showStatusModal({
        type: 'error',
        title: '清空中止',
        desc: (err && err.message) || '请稍后再试。',
      });
    }
  }
}

/* 本脚本在 body 底部加载，执行到这里时 DOM 已就绪，直接初始化 */
setupSettingsPage();
