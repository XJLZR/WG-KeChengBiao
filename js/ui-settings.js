/* ============================================================
   ui-settings.js —— 设置页交互（Day 25 · T8；Day 26 设置上云）
   对应：PRD V3.1 / V3.2、F5 / F6、验收 D1 / D2 / D5，
   设置正本 = 云端 settings 表（api-contract.md 2.6/3.6/3.7，按口令隔离）。

   四块功能：
     ① 学期设置：学期第一周周一（必须周一）+ 12 节起止时间，
        「保存设置」= PUT /api/settings 写云端正本 + 写本地缓存；
        打开页面时 GET /api/settings 拉云端填表（没存过 = null → 用缓存/默认）；
     ② 恢复默认作息：二次确认 → PUT 默认值上云 → 表单回默认；
     ③ 备份导出 / 导入：当前口令名下的课程（云端拉取 / POST 恢复）
        + 设置（缓存 / PUT 上云），打包成一个 JSON 文件；导入目标 = 当前口令；
     ④ 清空全部数据：二次确认 → 逐条 DELETE 当前口令的课程
        → 设置恢复默认（上云 + 本地，契约没有「清空」接口，逐条删是现实做法）。

   所有网络请求带课表口令（schedule-code.js）；反馈走 ui-modal。
   ============================================================ */

/* 云函数公网地址：与 ui-home.js / ui-import.js 同值（各页一份惯例） */
const SETTINGS_API_BASE_URL =
  'https://wg-kechengbiao-d9gi92b9ma9e7f71c-1501303146.ap-shanghai.app.tcloudbase.com';

/** 备份文件的身份标记：导入时靠它拒绝「不是本产品备份」的 JSON */
const BACKUP_TYPE = 'wg-timetable-backup';

function setupSettingsPage() {
  /* ---------- Day 27：网址 ?code= 优先存下 ----------
     真实试用反馈的场景：用户在微信里被引导「用浏览器打开」，浏览器
     打开的是带 ?code= 的网址，但这个浏览器环境的 localStorage 是空的。
     此前设置页不认网址口令，点任何按钮都会被弹去入口页逼用户重输。
     现在与首页 bootstrap 同一口径：网址口令优先，合法就存。 */
  const urlCode = scheduleCodeFromUrl();
  if (urlCode) setScheduleCode(urlCode);

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

  /** 12 行起止时间输入。输入框只读：点按弹出滚筒选择器（Day 25 追加，
      用户反馈「逐个手动输入太麻烦」）。值仍形如 '08:00'，写回由滚筒保证。 */
  function renderPeriodInputs(settings) {
    periodBox.innerHTML = settings.periodTimes
      .map((p, i) =>
        `<div class="setting-row setting-row--field">` +
        `<span class="setting-row__label">第 ${i + 1} 节</span>` +
        `<input class="setting-row__input setting-row__input--time" type="text" readonly ` +
        `placeholder="08:00" ` +
        `data-period="${i}" data-edge="start" value="${p.start}" aria-label="第 ${i + 1} 节开始时间，点按弹出滚筒选择">` +
        `<span class="setting-row__dash">–</span>` +
        `<input class="setting-row__input setting-row__input--time" type="text" readonly ` +
        `placeholder="08:45" ` +
        `data-period="${i}" data-edge="end" value="${p.end}" aria-label="第 ${i + 1} 节结束时间，点按弹出滚筒选择">` +
        `</div>`
      )
      .join('');
  }

  function fillForm(settings) {
    dateInput.value = settings.semesterStart;
    renderPeriodInputs(settings);
  }

  /* 初始填表：先立刻用本地缓存/默认值画出来（不打白屏），
     再异步拉云端正本——有则覆盖表单并同步缓存。
     Day 26 起设置正本在云端：换浏览器打开，云设置也能跟过来。 */
  fillForm(getSettings());
  (async () => {
    try {
      const url = apiUrlWithCode(`${SETTINGS_API_BASE_URL}/api/settings`);
      if (!url) return;   // 没口令：守卫会在首页/入口页处理，这里不动表单
      const resp = await fetch(url);
      if (!resp.ok) return;   // 读不到云端就静默用本地值，不打扰用户
      const body = await resp.json();
      if (body && body.ok === true && isValidSettings(body.data && body.data.settings)) {
        saveSettings(body.data.settings);
        fillForm(body.data.settings);
      }
    } catch (err) {
      /* 网络失败静默：本地缓存/默认值已经画在页面上了 */
    }
  })();

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

  saveBtn.addEventListener('click', async () => {
    const result = collectForm();
    if (result.error) {
      showStatusModal({ type: 'error', title: '保存失败', desc: result.error });
      return;
    }
    saveBtn.disabled = true;
    showStatusModal({ type: 'loading', title: '正在保存设置…' });

    try {
      /* Day 26：正本上云（PUT /api/settings，契约 3.7），成功后写本地缓存。
         接口体只带契约 2.6 的两个字段（schemaVersion 是本地缓存扩展，不上云）。 */
      const url = apiUrlWithCode(`${SETTINGS_API_BASE_URL}/api/settings`);
      if (!url) {
        window.location.replace('./entry.html');
        return;
      }
      const resp = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semesterStart: result.settings.semesterStart,
          periodTimes: result.settings.periodTimes,
        }),
      });
      let body = null;
      try { body = await resp.json(); } catch (err) { /* 平台层 450 空响应体 */ }
      if (!resp.ok || !body || body.ok !== true) {
        const msg = body && body.error && body.error.message;
        throw { message: msg || '云端保存失败，设置未改动，请稍后再试。' };
      }

      saveSettings(result.settings);
      showStatusModal({
        type: 'success',
        title: '设置已保存',
        desc: '已同步到云端（跟口令走）：回首页后，周数与状态标签即按新设置计算。',
      });
    } catch (err) {
      showStatusModal({
        type: 'error',
        title: '保存失败',
        desc: (err && err.message) || '请稍后再试。',
      });
    } finally {
      saveBtn.disabled = false;
    }
  });

  /* ---------- ② 恢复默认作息 ---------- */

  resetBtn.addEventListener('click', () => {
    showConfirmModal({
      title: '恢复默认作息？',
      desc: '学期起点与 12 节时间将恢复为默认值（云端与本机一并覆盖），当前自定义的设置会被覆盖。',
      confirmText: '恢复默认',
      onConfirm: async () => {
        resetBtn.disabled = true;
        showStatusModal({ type: 'loading', title: '正在恢复默认…' });
        try {
          /* 云端正本先写默认值（其他设备同步生效），再清本地缓存 */
          const url = apiUrlWithCode(`${SETTINGS_API_BASE_URL}/api/settings`);
          if (!url) {
            window.location.replace('./entry.html');
            return;
          }
          const resp = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              semesterStart: DEFAULT_SETTINGS.semesterStart,
              periodTimes: DEFAULT_SETTINGS.periodTimes,
            }),
          });
          if (!resp.ok) {
            throw { message: '云端恢复失败，设置未改动，请稍后再试。' };
          }
          resetSettings();
          fillForm(getSettings());
          showStatusModal({ type: 'success', title: '已恢复默认作息' });
        } catch (err) {
          showStatusModal({
            type: 'error',
            title: '恢复失败',
            desc: (err && err.message) || '请稍后再试。',
          });
        } finally {
          resetBtn.disabled = false;
        }
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

      /* Day 26：设置正本也恢复到云端（备份里的 settings 带 schemaVersion 本地
         扩展，接口体只带契约 2.6 两个字段）；成功后再写本地缓存 */
      const putUrl = apiUrlWithCode(`${SETTINGS_API_BASE_URL}/api/settings`);
      if (putUrl) {
        const putResp = await fetch(putUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            semesterStart: backup.settings.semesterStart,
            periodTimes: backup.settings.periodTimes,
          }),
        });
        if (!putResp.ok) {
          throw { message: '课程的云端恢复已完成，但设置上云失败——请稍后在设置页重新保存。' };
        }
      }
      saveSettings(backup.settings);
      showStatusModal({
        type: 'success',
        title: `恢复完成（${body.data.imported} 门课）`,
        desc: '课程与设置均已恢复到当前口令（云端），回首页即可看到。',
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
    /* ---------- Day 27 修复（真实试用反馈）：微信场景导出断链 ----------
       微信内置浏览器不支持 Blob + a.download 下载，.ics 永远下不下来；
       用户此前只能自己想办法跳浏览器，而跳过去的网址不带口令
       （口令在 localStorage，跨不过微信→浏览器的环境边界），只好重输，
       还容易误点「生成新口令」造成混乱。
       现在两件事：
       ① 用 replaceState 把当前网址补上 ?code=（不刷新页面）——
          微信右上角「···」→「在浏览器打开」重开的就是这个网址，
          口令随网址过去，配合上面的网址口令识别，无需重输；
       ② 微信里不再触发注定失败的下载，直接给明确引导。 */
    if (/MicroMessenger/i.test(navigator.userAgent)) {
      const wechatCode = getScheduleCode();
      if (wechatCode) {
        const shareUrl = new URL(window.location.href);
        shareUrl.searchParams.set('code', wechatCode);
        window.history.replaceState(null, '', shareUrl);
      }
      showStatusModal({
        type: 'success',
        title: '请在浏览器中打开',
        desc: '微信里下载不了日历文件。点右上角「···」→「在浏览器打开」，' +
          '打开后回到设置页再点一次「导出日历」即可，不需要重新输入口令。',
      });
      return;
    }

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

      /* 设置恢复默认：云端正本 PUT 默认值（其他设备同步生效）+ 清本地缓存。
         云端失败不阻断「已清空」的汇报（课程已删完），只附一句说明。 */
      let settingsNote = '';
      try {
        const putUrl = apiUrlWithCode(`${SETTINGS_API_BASE_URL}/api/settings`);
        if (putUrl) {
          const putResp = await fetch(putUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              semesterStart: DEFAULT_SETTINGS.semesterStart,
              periodTimes: DEFAULT_SETTINGS.periodTimes,
            }),
          });
          if (!putResp.ok) settingsNote = '（设置上云未成功，可稍后在设置页重存一次）';
        }
      } catch (err) {
        settingsNote = '（设置上云未成功，可稍后在设置页重存一次）';
      }
      resetSettings();
      fillForm(getSettings());
      showStatusModal({
        type: 'success',
        title: '已清空',
        desc: (courses.length === 0
          ? '该口令名下本就没有课程，设置已恢复默认。'
          : `已删除 ${deleted} 门课，设置已恢复默认。`) + settingsNote,
      });
    } catch (err) {
      showStatusModal({
        type: 'error',
        title: '清空中止',
        desc: (err && err.message) || '请稍后再试。',
      });
    }
  }

  /* ---------- 时间滚筒选择器（Day 25 追加，Day 26 修复误选） ----------
     点任一时间框 → 弹窗：两列滚轮（时 0–23 / 分 0–55 每 5 分钟一档）+ 取消/确认。

     【Day 26 修复】主人真机反馈「滑到某时间、点确认却是另一个时间」。
     旧版在 scroll 事件里写选中状态，而 scroll-snap 吸附动画的收尾阶段
     （微信 X5 内核尤其明显）常常不再触发 scroll——状态滞留在滑动途中的
     中间值，眼见与所得不一致。
     现在改为：**滚轮的滚动位置（scrollTop）是唯一事实来源**——
     点数字 / 滑动只负责「把位置挪到位 + 更新高亮」，数值一律在点「确认」
     那一刻从 scrollTop 反算。任何时序抖动都影响不到取值。 */
  const ITEM_HEIGHT = 40;          // 与 pages.css 的 .time-picker__item 高度一致
  const pickerMask = document.getElementById('time-picker');
  const hourWheel = document.getElementById('tp-wheel-hour');
  const minuteWheel = document.getElementById('tp-wheel-minute');
  const pickerCancel = document.getElementById('tp-cancel');
  const pickerConfirm = document.getElementById('tp-confirm');
  const pickerState = { input: null };

  const pad2t = (n) => String(n).padStart(2, '0');
  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

  /** 从滚动位置反算下标（确认时刻的权威取值；越界收口） */
  function idxFromScroll(wheel, count) {
    return Math.max(0, Math.min(count - 1, Math.round(wheel.scrollTop / ITEM_HEIGHT)));
  }

  /** 建一列滚轮。values 是候选值数组，initialIdx 是打开时选中的下标。
      只管「挪位置 + 高亮」，不存数值。 */
  function buildWheel(wheel, values, initialIdx) {
    wheel.innerHTML = values
      .map((v) => `<div class="time-picker__item" data-value="${v}">${pad2t(v)}</div>`)
      .join('');
    const items = Array.from(wheel.children);

    const setSelected = (idx) => {
      items.forEach((el, i) => el.classList.toggle('is-selected', i === idx));
    };

    /* 路①：直接点数字——瞬时吸附到正中。
       不用平滑滚动（smooth）：既拖慢手感，又会留下「滚动还在途中」的窗口期。 */
    items.forEach((el, idx) => {
      el.addEventListener('click', () => {
        setSelected(idx);
        wheel.scrollTop = idx * ITEM_HEIGHT;
      });
    });

    /* 路②：手指滑动——只更新高亮跟随；数值交给确认时的反算 */
    wheel.addEventListener('scroll', () => {
      setSelected(idxFromScroll(wheel, values.length));
    }, { passive: true });

    setSelected(initialIdx);
  }

  function openTimePicker(input) {
    pickerState.input = input;
    const parts = input.value.split(':').map(Number);
    const h = parts[0] || 0;
    /* 分钟对齐到 5 的倍数（备份里的老数据万一不是 5 的倍数，就近取） */
    const m = Math.round((parts[1] || 0) / 5) * 5 % 60;

    buildWheel(hourWheel, HOURS, h);
    buildWheel(minuteWheel, MINUTES, m / 5);
    /* 打开时把当前值定位到正中（瞬时，不给误选留窗口） */
    hourWheel.scrollTop = h * ITEM_HEIGHT;
    minuteWheel.scrollTop = (m / 5) * ITEM_HEIGHT;

    pickerMask.classList.remove('is-hidden');
  }

  function closeTimePicker() {
    pickerMask.classList.add('is-hidden');
    pickerState.input = null;
  }

  /* 点时间框（事件委托：12 行 24 个框，一个监听管全部） */
  periodBox.addEventListener('click', (event) => {
    const input = event.target.closest('input[data-period]');
    if (input) openTimePicker(input);
  });

  pickerCancel.addEventListener('click', closeTimePicker);

  pickerConfirm.addEventListener('click', () => {
    if (!pickerState.input) { closeTimePicker(); return; }
    /* 确认那一刻从滚动位置反算——此刻滚轮停在哪格就取哪格，眼见即所得。
       （即使用户在吸附动画尚未完全停稳时按下确认，round 取的也是
       「离当前位置最近的格」，正是吸附将要停靠的那格。） */
    const h = HOURS[idxFromScroll(hourWheel, HOURS.length)];
    const m = MINUTES[idxFromScroll(minuteWheel, MINUTES.length)];
    pickerState.input.value = `${pad2t(h)}:${pad2t(m)}`;
    closeTimePicker();
  });
}

/* 本脚本在 body 底部加载，执行到这里时 DOM 已就绪，直接初始化 */
setupSettingsPage();
