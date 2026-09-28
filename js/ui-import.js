/* ============================================================
   ui-import.js —— 导入页交互（Day 11 新增 · 前端临时状态版）
   对应：Day 11 任务「上传课表文件与刷新的状态交互，今天先不接数据库」

   今天做的：只有「上传」的状态反馈——
   点「选择课表文件」→ 弹「上传中」→ 按扩展名分流 → 弹「上传成功 / 上传失败」。

   ⚠️ 临时性（重要）：
   - 不读文件内容、不解析课表、不存库 —— 真解析属 T2/T3，存储属 T4；
   - 「成功/失败」只看文件扩展名，是演示用的模拟分支，接 T2/T3 时整段替换；
   - 成功弹窗文案里带「演示状态」字样，防止误以为课表真的导入了。
   ============================================================ */

/* 模拟上传耗时：太短看不见「加载中」弹窗，太长像卡死，取 1.5 秒 */
const FAKE_UPLOAD_DELAY_MS = 1500;

function setupImportPage() {
  const selectBtn = document.getElementById('import-select-btn');
  const fileInput = document.getElementById('import-file-input');
  /* 页面骨架没到位就不绑（比如将来 HTML 改版漏了 id），不让脚本报错 */
  if (!selectBtn || !fileInput) {
    return;
  }

  /* 处理期间的防连点：disabled 管 UI（变灰 + not-allowed 光标），
     isUploading 标志管逻辑（万一事件比样式快），双保险 */
  let isUploading = false;

  selectBtn.addEventListener('click', () => {
    if (isUploading) {
      return;
    }
    /* file input 平时隐藏，由按钮代它打开系统文件选择框 */
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    /* 先清空选择：不清的话，下次选同一个文件不会触发 change */
    fileInput.value = '';
    if (!file || isUploading) {
      /* 没选文件 = 用户取消了选择框：回到原状，什么都不弹 */
      return;
    }

    isUploading = true;
    selectBtn.disabled = true;

    showStatusModal({
      type: 'loading',
      title: '正在上传课表…',
      desc: file.name,
    });

    setTimeout(() => {
      isUploading = false;
      selectBtn.disabled = false;

      /* 演示分流：只看扩展名（.htm / .html 算成功），其余算失败。
         真正的解析（T2/T3）会替换掉这整段 setTimeout 回调。 */
      const isHtmFile = /\.html?$/i.test(file.name);
      if (isHtmFile) {
        showStatusModal({
          type: 'success',
          title: '上传成功',
          desc: `已收到「${file.name}」。（演示状态：课表解析将在后续版本接入）`,
        });
      } else {
        /* 失败提示 = 发生了什么 + 怎么办，不让用户猜 */
        showStatusModal({
          type: 'error',
          title: '上传失败',
          desc: `「${file.name}」不是 .htm 课表文件，请从教务系统导出后再选一次。`,
        });
      }
    }, FAKE_UPLOAD_DELAY_MS);
  });
}

/* 本脚本在 body 底部加载，执行到这里时 DOM 已就绪，直接初始化 */
setupImportPage();
