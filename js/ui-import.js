/* ============================================================
   ui-import.js —— 导入页交互（Day 25 重写 · T3 接线完成）
   对应：PRD V2.1 / V2.2 / V2.3，F1「解析结果先预览、确认后才替换」

   Day 11 的「只看扩展名假分流」已整段删除，现在的真实流程：
     选文件 → 读文本 → parser.js 解析（纯前端，不上传）
       ├─ 失败（三分类）→ 状态弹窗说明原因，回到可重选状态
       └─ 成功 → V2.2 预览区：统计 + 课程卡片 +「保存并使用」
            → GET 云端课表：有数据才弹「将替换现有课表」确认
               （Day 22 确认弹窗组件；首次导入无可替换，不打扰）
            → 规模预检（契约 3.3：≤500 门、≤512KB，超限不发请求）
            → POST /api/courses/import（整体替换）
            → 成功弹窗（报服务端实数）→ 回首页自动拉新数据
            → 失败按 Day 23 统一口径中文报错，并说明现状（未改动）

   隐私口径（页面文案同步）：文件只在本机解析，确认保存前不上传。
   ============================================================ */

/** 星期名：与 ui-home.js 同一份（1 = 周一）。两页各放一份是现状的最小改动。 */
const IMPORT_WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/* 云函数公网地址：与 ui-home.js 的 API_BASE_URL 同值（两页各放一份，最小改动）。
   跨域由网关侧 CORS 白名单放行（含本地调试 http://127.0.0.1:8012），
   禁止 * 通配符（Day 20 拍板），本文件不写任何自定义 CORS 头。 */
const IMPORT_API_BASE_URL =
  'https://wg-kechengbiao-d9gi92b9ma9e7f71c-1501303146.ap-shanghai.app.tcloudbase.com';

/* 接口规模上限（api-contract.md 3.3）：前端先拦，超限不发请求 */
const IMPORT_MAX_COURSES = 500;
const IMPORT_MAX_BODY_BYTES = 512 * 1024;

/* 保存成功后停留多久跳回首页：太短看不清成功提示，太长像卡死 */
const SAVE_REDIRECT_DELAY_MS = 1500;

/**
 * 转义 HTML 特殊字符。课程名/地点来自用户文件，插进 innerHTML 前必须过这道。
 * 与 ui-home.js 的同名函数同一实现；不跨页抽公共文件是为了不动首页脚本（最小改动）。
 */
function escapeImportHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 节次显示：periods 已是升序数字数组（解析器保证）。
 * 连续 → 「6–7 节」；跳节 → 「1,3 节」；单节 → 「8 节」。
 */
function formatImportPeriods(periods) {
  if (periods.length === 1) {
    return `第${periods[0]}节`;
  }
  const isConsecutive = periods[periods.length - 1] - periods[0] === periods.length - 1;
  return isConsecutive
    ? `第${periods[0]}–${periods[periods.length - 1]}节`
    : `第${periods.join(',')}节`;
}

/**
 * 周次集合显示：连续段压缩（[1,2,3,4] → 「1–4」，[1,5,9,13] → 「1,5,9,13」）。
 * 解析出来的周次经常是不规则集合（research.md 4.3 的坑 2），不压缩会很长。
 */
function formatImportWeeks(weeks) {
  const parts = [];
  let start = weeks[0];
  let prev = weeks[0];
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i] === prev + 1) {
      prev = weeks[i];
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = prev = weeks[i];
  }
  parts.push(start === prev ? `${start}` : `${start}–${prev}`);
  return parts.join(',');
}

/** 一门课 → 一张预览卡片。DOM 结构与首页课程卡片同构（course-card 系列），无状态标签无花色。 */
function renderImportPreviewCard(course) {
  const metaParts = [
    IMPORT_WEEKDAY_NAMES[course.weekday - 1],
    formatImportPeriods(course.periods),
    course.location || '—',
  ];
  if (course.teacher) {
    metaParts.push(course.teacher);   // 教师为空留空，不放占位符（PRD 5.1）
  }
  metaParts.push(`第${formatImportWeeks(course.weeks)}周`);
  return (
    `<article class="course-card">` +
    `<div class="course-card__main">` +
    `<p class="course-card__name">${escapeImportHtml(course.name)}</p>` +
    `<p class="course-card__meta">${escapeImportHtml(metaParts.join(' · '))}</p>` +
    `</div></article>`
  );
}

function setupImportPage() {
  /* Day 25：导入必须有口令——导入的目标就是「这个口令名下的课表」，
     没口令连「替换谁」都不知道，直接去入口页（契约 2.5） */
  if (!getScheduleCode()) {
    window.location.replace('./entry.html');
    return;
  }

  const selectBtn = document.getElementById('import-select-btn');
  const fileInput = document.getElementById('import-file-input');
  const previewSection = document.getElementById('import-preview');
  const statsEl = document.getElementById('import-preview-stats');
  const listEl = document.getElementById('import-preview-list');
  const saveBtn = document.getElementById('import-save-btn');
  const reselectBtn = document.getElementById('import-reselect-btn');
  /* 页面骨架没到位就不绑（比如将来 HTML 改版漏了 id），不让脚本报错 */
  if (!selectBtn || !fileInput || !previewSection || !saveBtn) {
    return;
  }

  /* 解析期间的防连点：disabled 管 UI，isParsing 标志管逻辑（双保险，Day 11 惯例） */
  let isParsing = false;
  /* 保存/检查期间的防连点：与 isParsing 分开——解析和保存是两个互不重叠的阶段 */
  let isSaving = false;
  /* 当前解析结果：保存时（下一步接线）从这里取，避免再读一遍文件 */
  let currentParsed = null;

  function openFilePicker() {
    fileInput.click();
  }

  selectBtn.addEventListener('click', openFilePicker);
  reselectBtn.addEventListener('click', openFilePicker);

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    /* 先清空选择：不清的话，下次选同一个文件不会触发 change */
    fileInput.value = '';
    if (!file || isParsing) {
      /* 没选文件 = 用户取消了选择框：回到原状，什么都不弹 */
      return;
    }

    isParsing = true;
    selectBtn.disabled = true;
    showStatusModal({
      type: 'loading',
      title: '正在解析课表…',
      desc: file.name,
    });

    /* 文件在浏览器本地读完就地解析，全程无网络请求（隐私口径见文件头） */
    file
      .text()
      .then((text) => {
        const result = parseCourseTable(text);
        isParsing = false;
        selectBtn.disabled = false;

        if (!result.ok) {
          /* V2.3：三分类错误，文案由解析器给（已区分「空文件 / 不是课表 / 0 条记录」） */
          showStatusModal({
            type: 'error',
            title: '解析失败',
            desc: result.error.message,
          });
          return;
        }

        /* V2.2：解析成功 → 预览区。弹窗先关，页面本身展示结果。 */
        closeStatusModal();
        currentParsed = result;
        renderPreview(result);
      })
      .catch((err) => {
        /* file.text() 本身失败（文件读不了、编码异常等极少数情况） */
        isParsing = false;
        selectBtn.disabled = false;
        showStatusModal({
          type: 'error',
          title: '解析失败',
          desc: `文件读取失败（${err && err.message ? err.message : '未知原因'}），请重新导出一次。`,
        });
      });
  });

  /** 把解析结果铺进预览区：统计行 + 卡片列表 + 保存按钮 */
  function renderPreview(result) {
    const { courses, stats } = result;
    const statLines = [`共解析出 ${courses.length} 门课（原始 ${stats.rawRows} 行` +
      `，跳过无效 ${stats.skippedRows} 行）`];
    if (stats.firstScheduleDate) {
      statLines.push(`排课日期从 ${stats.firstScheduleDate} 开始，` +
        `如与学期第一周不一致，请到设置页核对起始日期。`);
    }
    statsEl.textContent = statLines.join('。');

    listEl.innerHTML = courses.map(renderImportPreviewCard).join('');
    previewSection.hidden = false;
    saveBtn.hidden = false;
    /* 重新解析成功时把预览区滚到眼前，手机上不滚看不到结果 */
    previewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  saveBtn.addEventListener('click', () => {
    if (!currentParsed || currentParsed.courses.length === 0 || isSaving) {
      return;
    }
    /* 先问云端有没有课表：有 → 二次确认（PRD V2.2 / A6：替换要先打招呼）；
       没有（第一次导入）→ 没东西可替换，不弹确认直接保存。 */
    isSaving = true;
    saveBtn.disabled = true;
    showStatusModal({ type: 'loading', title: '正在检查现有课表…' });
    fetchExistingCount()
      .then((count) => {
        isSaving = false;
        saveBtn.disabled = false;
        closeStatusModal();
        if (count > 0) {
          showConfirmModal({
            title: '将替换现有课表',
            desc: `云端已有 ${count} 门课。保存后会被整体替换为本次解析出的 ` +
              `${currentParsed.courses.length} 门课，原课表不可从本页恢复。`,
            confirmText: '确认替换',
            onConfirm: () => saveCourses(currentParsed.courses),
          });
        } else {
          saveCourses(currentParsed.courses);
        }
      })
      .catch((err) => {
        /* 检查失败就停下：连「云端有什么」都读不到，保存更不该开始 */
        isSaving = false;
        saveBtn.disabled = false;
        showSaveError(err, '没能读到现有课表，未做任何修改，请稍后再试。');
      });
  });

  /**
   * GET /api/courses?code=口令 → 云端该口令名下的课程条数。
   * Day 25：404 SCHEDULE_NOT_FOUND 是正常业务态（新课表/还没导入），返回 0，
   *   让「首次导入不弹确认」的分支自然生效——不是错误，不能 reject。
   * 其余错误处理与 ui-home.js 的 readLocalData 同口径：
   * 网络层失败 NETWORK_ERROR、非 2xx 透传服务端错误码、包络形状不对 DATA_CORRUPT。
   */
  function fetchExistingCount() {
    const requestUrl = apiUrlWithCode(`${IMPORT_API_BASE_URL}/api/courses`);
    if (!requestUrl) {
      return Promise.reject({ code: 'MISSING_CODE' });
    }
    let resp;
    return fetch(requestUrl)
      .catch((err) => {
        console.error('[导入] 现有课表查询失败：', err);
        return Promise.reject({ code: 'NETWORK_ERROR', cause: err });
      })
      .then((r) => {
        resp = r;
        /* 新课表：404 SCHEDULE_NOT_FOUND = 该口令名下还没有课程，就是 0 门，
           不是错误（Day 25：替换范围收窄到口令后，新课表 GET 必然 404） */
        if (resp.status === 404) {
          return { ok: true, data: { courses: [] } };
        }
        if (!resp.ok) {
          /* 读得到包络就透传错误码；读不到（如平台层 450 空响应体）按服务器错误 */
          return resp
            .json()
            .then((errBody) => {
              const code = errBody && errBody.error && errBody.error.code
                ? errBody.error.code
                : 'SERVER_ERROR';
              return Promise.reject({ code, status: resp.status });
            })
            .catch((err) => {
              if (err && err.code) {
                return Promise.reject(err);   // 上面主动 reject 的，原样透传
              }
              return Promise.reject({ code: 'SERVER_ERROR', status: resp.status });
            });
        }
        return resp.json();
      })
      .then((body) => {
        if (!body || body.ok !== true || !body.data || !Array.isArray(body.data.courses)) {
          return Promise.reject({ code: 'DATA_CORRUPT' });
        }
        return body.data.courses.length;
      });
  }

  /**
   * 保存主流程：规模预检 → POST /api/courses/import（整体替换）→ 成功跳首页。
   * 请求体形状严格按 api-contract.md 3.3；成功/失败反馈走统一状态弹窗（Day 23 口径）。
   */
  function saveCourses(courses) {
    /* 前端规模预检：超限直接报错不发请求（服务端有同样的上限，这里省一次白跑） */
    const bodyText = JSON.stringify({ courses });
    if (courses.length > IMPORT_MAX_COURSES) {
      showSaveError(
        { code: 'TOO_MANY_COURSES' },
        `本次解析出 ${courses.length} 门课，超过单批 ${IMPORT_MAX_COURSES} 门上限，未保存。`
      );
      return;
    }
    if (bodyText.length > IMPORT_MAX_BODY_BYTES) {
      showSaveError(
        { code: 'BODY_TOO_LARGE' },
        '课表数据超过 512KB 上限，未保存。请确认导出的是课表列表而不是整页网站文件。'
      );
      return;
    }

    isSaving = true;
    saveBtn.disabled = true;
    showStatusModal({
      type: 'loading',
      title: '正在保存课表…',
      desc: `共 ${courses.length} 门课，保存后返回首页`,
    });

    let resp;
    /* Day 25：POST 也带口令——替换的就是这个口令名下的课表（契约 3.3） */
    const postUrl = apiUrlWithCode(`${IMPORT_API_BASE_URL}/api/courses/import`);
    if (!postUrl) {
      showSaveError({ code: 'MISSING_CODE' }, '请先到「换课表」页设置口令。');
      return;
    }
    fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyText,
    })
      .catch((err) => {
        console.error('[导入] 保存请求失败：', err);
        return Promise.reject({ code: 'NETWORK_ERROR', cause: err });
      })
      .then((r) => {
        resp = r;
        if (!resp.ok) {
          /* 服务端拒绝（如 BAD_REQUEST）会把中文原因写进包络，透传给用户 */
          return resp
            .json()
            .then((errBody) => {
              const code = errBody && errBody.error && errBody.error.code
                ? errBody.error.code
                : 'SERVER_ERROR';
              const message = errBody && errBody.error && errBody.error.message
                ? errBody.error.message
                : '';
              return Promise.reject({ code, message, status: resp.status });
            })
            .catch((err) => {
              if (err && err.code) {
                return Promise.reject(err);
              }
              return Promise.reject({ code: 'SERVER_ERROR', status: resp.status });
            });
        }
        return resp.json();
      })
      .then((body) => {
        if (!body || body.ok !== true || typeof body.data.imported !== 'number') {
          return Promise.reject({ code: 'DATA_CORRUPT' });
        }
        isSaving = false;
        /* 成功：报实数（以服务端实际写入为准），停留片刻让用户看见，再回首页。
           首页加载时会重新拉取云端数据，新课表自然出现。 */
        showStatusModal({
          type: 'success',
          title: `保存成功，已导入 ${body.data.imported} 门课`,
          desc: '即将返回首页…',
        });
        setTimeout(() => {
          window.location.assign('./index.html');
        }, SAVE_REDIRECT_DELAY_MS);
      })
      .catch((err) => {
        isSaving = false;
        saveBtn.disabled = false;
        showSaveError(err, '课表没有保存，现有数据未受影响。');
      });
  }

  /** 保存/检查失败的统一出口：发生了什么 + 现状如何 + 怎么办（不让用户猜） */
  function showSaveError(err, context) {
    /* 口令没了（被别的页清除）：弹错误没有意义，直接送回入口页补口令 */
    if (err && err.code === 'MISSING_CODE') {
      window.location.replace('./entry.html');
      return;
    }
    closeStatusModal();
    const code = err && err.code ? err.code : 'UNKNOWN';
    const detail = err && err.message ? err.message : '';
    let reason;
    if (code === 'NETWORK_ERROR') {
      reason = '网络连不上服务器';
    } else if (code === 'SERVER_ERROR' || code === 'DATA_CORRUPT') {
      reason = '服务器返回了异常结果';
    } else if (detail) {
      reason = detail;   // 服务端明确给了中文原因（如 BAD_REQUEST 指明第几条错什么）
    } else {
      reason = '发生未知错误';
    }
    showStatusModal({
      type: 'error',
      title: '保存失败',
      desc: `${reason}。${context}`,
    });
  }
}

/* 本脚本在 body 底部加载，执行到这里时 DOM 已就绪，直接初始化 */
setupImportPage();
