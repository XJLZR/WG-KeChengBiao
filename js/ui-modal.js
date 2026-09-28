/* ============================================================
   ui-modal.js —— 通用状态弹窗组件（Day 11 新增）
   对应：Day 11 任务「上传课表文件与刷新的状态交互」

   为什么单独一个文件：导入页（js/ui-import.js）和首页（js/ui-home.js）
   都要弹状态窗，组件收在这里，两个页面共用一份逻辑、一处修改。

   对外只暴露两个函数（脚本按 function 声明写，自动挂到 window）：
     showStatusModal({ type: 'loading' | 'success' | 'error', title, desc })
     closeStatusModal()

   关闭规则（Day 11 任务原文）：
     - 加载中弹窗：不允许点击关闭（处理没完成，关掉等于没反馈）；
     - 成功/失败弹窗：点击页面任意处关闭（含弹窗本身），
       并在弹窗里放一行「点击页面任意处关闭」的提示。

   样式类定义在 css/base.css 的「状态弹窗」一节（Day 11）。
   ============================================================ */

/* 三种状态的配置：卡片 modifier 类（控制图标与配色）+ 默认标题 */
const STATUS_MODAL_CONFIG = {
  loading: { cardClass: 'modal-card--loading', defaultTitle: '处理中…' },
  success: { cardClass: 'modal-card--success', defaultTitle: '操作成功' },
  error:   { cardClass: 'modal-card--error',   defaultTitle: '操作失败' },
};

/* 单例根节点（遮罩 + 卡片）：重复显示时复用同一份 DOM，不往 body 上叠层 */
let statusModalRoot = null;

/* 「点任意处关闭」的绑定定时器句柄：切换状态前要清掉旧的 */
let statusModalCloseTimer = null;

/** 第一次调用时把弹窗骨架插到 body 末尾，之后一直复用 */
function ensureStatusModalRoot() {
  if (statusModalRoot) {
    return statusModalRoot;
  }
  statusModalRoot = document.createElement('div');
  statusModalRoot.className = 'modal-mask is-hidden';
  statusModalRoot.setAttribute('role', 'dialog');
  statusModalRoot.setAttribute('aria-modal', 'true');
  /* 结构是静态文本、不含任何用户输入，用 innerHTML 是安全的；
     文件名等动态内容一律走 textContent 赋值（见 showStatusModal） */
  statusModalRoot.innerHTML = [
    '<div class="modal-card">',
    '  <span class="modal-card__icon" aria-hidden="true"></span>',
    '  <p class="modal-card__title"></p>',
    '  <p class="modal-card__desc is-hidden"></p>',
    '  <p class="modal-card__hint is-hidden">点击页面任意处关闭</p>',
    '</div>',
  ].join('');
  document.body.appendChild(statusModalRoot);
  return statusModalRoot;
}

/**
 * 显示一个状态弹窗；重复调用会原地切换内容（加载中 → 成功/失败就是这个用法）。
 * type 取 'loading' | 'success' | 'error'；title/desc 不传时用默认标题、不显示描述。
 */
function showStatusModal(options) {
  const type = (options && options.type) || 'loading';
  const conf = STATUS_MODAL_CONFIG[type];
  const root = ensureStatusModalRoot();
  const card = root.querySelector('.modal-card');
  const titleEl = root.querySelector('.modal-card__title');
  const descEl = root.querySelector('.modal-card__desc');
  const hintEl = root.querySelector('.modal-card__hint');

  /* 切到新状态前，先把上一次可能挂着的「点任意处关闭」清干净——
     否则「成功弹窗还没被点掉、代码又弹了加载中」时，
     旧监听会让一次点击把不该关的加载中弹窗关掉 */
  clearTimeout(statusModalCloseTimer);
  document.removeEventListener('click', closeStatusModal);

  card.className = 'modal-card ' + conf.cardClass;
  titleEl.textContent = (options && options.title) || conf.defaultTitle;

  const desc = options && options.desc;
  if (desc) {
    /* 动态内容一律 textContent：文件名里就算有 < > 也只会显示成文字 */
    descEl.textContent = desc;
    descEl.classList.remove('is-hidden');
  } else {
    descEl.classList.add('is-hidden');
  }

  if (type === 'loading') {
    /* 加载中：不给关 */
    hintEl.classList.add('is-hidden');
  } else {
    hintEl.classList.remove('is-hidden');
    /* 绑定必须推迟一个事件循环（setTimeout 0）：
       触发弹窗的那次点击此刻还在向上冒泡，立刻绑 document 的话，
       同一次点击会顺手把刚打开的弹窗关掉 —— 弹窗就闪一下没了 */
    statusModalCloseTimer = setTimeout(() => {
      document.addEventListener('click', closeStatusModal, { once: true });
    }, 0);
  }

  root.classList.remove('is-hidden');
}

/** 关掉弹窗。幂等：重复调用、没有弹窗时调用都不报错。 */
function closeStatusModal() {
  clearTimeout(statusModalCloseTimer);
  document.removeEventListener('click', closeStatusModal);
  if (statusModalRoot) {
    statusModalRoot.classList.add('is-hidden');
  }
}
