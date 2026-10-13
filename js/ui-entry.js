/* ============================================================
   ui-entry.js —— 课表口令入口页交互（Day 25，拍板方案 B）
   对应：api-contract.md 2.5「课表口令」

   本页四个入口：
     ① 网址带 ?code=（分享链接）：口令合法 → 存下 → 直接进首页
     ② 当前口令（localStorage 已存）：大字展示 + 进入 / 清除
     ③ 创建新课表：自动生成口令 → 大字展示让用户保存 → 确认后进入
        （拍板：不支持自定义，只自动生成）
     ④ 输入口令：格式校验 → 真接口探测口令是否存在 → 存下进入
        （探测是有意的：口令打错立刻知道，而不是进了首页看到
          「课表不存在」再倒回来）

   口令语义提醒（页面文案同步）：口令 = 房间号 + 钥匙合一，
   知道口令即可查看和修改那份课表。
   ============================================================ */

/* 云函数公网地址：与 ui-home.js / ui-import.js 同值（各页一份，最小改动惯例） */
const ENTRY_API_BASE_URL =
  'https://wg-kechengbiao-d9gi92b9ma9e7f71c-1501303146.ap-shanghai.app.tcloudbase.com';

/** 口令展示统一转成大写显示（生成器本身产大写，输入路径兜底） */
function showCode(el, code) {
  el.textContent = code;
}

function setupEntryPage() {
  /* ---------- ① 分享链接直达：?code= 合法就存下走人 ---------- */
  const urlCode = scheduleCodeFromUrl();
  if (urlCode) {
    setScheduleCode(urlCode);
    /* replace 而非 assign：后退键不会退回一个「已经消费掉的链接」 */
    window.location.replace('./index.html');
    return;
  }

  const currentCard = document.getElementById('current-card');
  const currentCodeEl = document.getElementById('current-code');
  const clearBtn = document.getElementById('clear-btn');

  const createStartRow = document.getElementById('create-start-row');
  const createResult = document.getElementById('create-result');
  const newCodeEl = document.getElementById('new-code');
  const createBtn = document.getElementById('create-btn');
  const regenBtn = document.getElementById('regen-btn');
  const confirmCreateBtn = document.getElementById('confirm-create-btn');

  const codeInput = document.getElementById('code-input');
  const enterBtn = document.getElementById('enter-btn');
  const feedbackEl = document.getElementById('input-feedback');

  /* ---------- ② 当前口令：已存过就亮出来 ---------- */
  const savedCode = getScheduleCode();
  if (savedCode) {
    currentCard.classList.remove('is-hidden');
    showCode(currentCodeEl, savedCode);
  }

  clearBtn.addEventListener('click', () => {
    /* 清除不删云端数据：那份课表还在，凭口令随时回来（页面文案已说明） */
    clearScheduleCode();
    currentCard.classList.add('is-hidden');
    feedbackEl.textContent = '已清除本机保存的口令。';
  });

  /* ---------- ③ 创建新课表 ---------- */
  let pendingCode = null;   // 生成后、确认前暂存；确认才真正写入 localStorage

  createBtn.addEventListener('click', () => {
    pendingCode = generateScheduleCode();
    showCode(newCodeEl, pendingCode);
    createStartRow.hidden = true;
    createResult.hidden = false;
  });

  regenBtn.addEventListener('click', () => {
    pendingCode = generateScheduleCode();
    showCode(newCodeEl, pendingCode);
  });

  confirmCreateBtn.addEventListener('click', () => {
    if (!pendingCode) return;
    setScheduleCode(pendingCode);
    window.location.assign('./index.html');
  });

  /* ---------- ④ 输入口令进入 ---------- */

  /** 输入统一转大写（口令格式只认大写；小写输进来等于自动纠正） */
  codeInput.addEventListener('input', () => {
    const pos = codeInput.selectionStart;
    codeInput.value = codeInput.value.toUpperCase();
    codeInput.setSelectionRange(pos, pos);
    feedbackEl.textContent = '';
  });

  enterBtn.addEventListener('click', async () => {
    const code = codeInput.value.trim().toUpperCase();
    if (!isValidScheduleCode(code)) {
      feedbackEl.textContent =
        '口令格式不对：应为 6 位大写字母或数字（不含 0、O、1、I）。';
      return;
    }

    enterBtn.disabled = true;
    feedbackEl.textContent = '正在核对口令…';

    let resp;
    try {
      resp = await fetch(`${ENTRY_API_BASE_URL}/api/courses?code=${encodeURIComponent(code)}`);
    } catch (err) {
      enterBtn.disabled = false;
      feedbackEl.textContent = '连不上课程服务器，请检查网络后重试。';
      return;
    }

    if (resp.status === 404) {
      /* SCHEDULE_NOT_FOUND：口令没输错格式，但名下没有课表 */
      enterBtn.disabled = false;
      feedbackEl.textContent =
        '这个口令名下还没有课表：请核对是否输错；想新建课表请用上面的「创建新课表」。';
      return;
    }
    if (!resp.ok) {
      enterBtn.disabled = false;
      /* 服务端给了中文原因（如 INVALID_CODE）就透传，读不到包络给兜底 */
      let message = '服务器出了问题，请稍后重试。';
      try {
        const errBody = await resp.json();
        if (errBody && errBody.error && errBody.error.message) message = errBody.error.message + '。';
      } catch (err) { /* 空响应体，用兜底文案 */ }
      feedbackEl.textContent = message;
      return;
    }

    /* 口令有效：存下进首页 */
    setScheduleCode(code);
    window.location.assign('./index.html');
  });

  /* 回车 = 点「进入」 */
  codeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') enterBtn.click();
  });
}

/* 本脚本在 body 底部加载，执行到这里时 DOM 已就绪，直接初始化 */
setupEntryPage();
