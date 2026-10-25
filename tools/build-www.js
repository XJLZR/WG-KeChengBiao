/* ============================================================
   tools/build-www.js —— 生成 Capacitor 的 webDir（打包源）
   ------------------------------------------------------------
   为什么需要这一步：
     Capacitor 的 webDir 必须是「一个干净的、只含前端产物的目录」。
     本项目的网页文件直接放在仓库根目录，而根目录里还有
     node_modules/、.git/、docs/、backup-*.json、*.md 等
     —— 这些一旦被打进 APK 就是白白撑大体积、甚至泄露内部资料。
     所以用白名单复制：只把真正要发布的前端文件拷进 www/。

   白名单（改前端新增文件时必须同步这里，否则 App 里会 404）：
     index.html  entry.html  import.html  settings.html
     css/*.css   js/*.js
     icons/      （应用图标，存在才拷）

   用法：node tools/build-www.js
   退出码 0 = 成功；缺文件会明确报出来并以非 0 退出。
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'www');

const HTML_FILES = ['index.html', 'entry.html', 'import.html', 'settings.html'];
const DIRS = ['css', 'js'];
const OPTIONAL_DIRS = ['icons'];

function fail(msg) {
  console.error('[build-www] 失败：' + msg);
  process.exit(1);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (fs.statSync(src).isDirectory()) {
      count += copyDir(src, dst);
    } else {
      fs.copyFileSync(src, dst);
      count++;
    }
  }
  return count;
}

// 1. 清空旧的 www/，保证每次打包都是干净状态（避免删掉的文件残留）
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let copied = 0;
const missing = [];

// 2. 拷 HTML（缺一个就报错：这 4 个页面是应用的完整入口）
for (const f of HTML_FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) {
    missing.push(f);
    continue;
  }
  fs.copyFileSync(src, path.join(OUT, f));
  copied++;
}
if (missing.length) {
  fail('缺少必需的前端文件：' + missing.join(', '));
}

// 3. 拷 css/ 与 js/
for (const d of DIRS) {
  const src = path.join(ROOT, d);
  if (!fs.existsSync(src)) fail('缺少目录：' + d);
  copied += copyDir(src, path.join(OUT, d));
}

// 4. 拷可选目录（图标）
for (const d of OPTIONAL_DIRS) {
  const src = path.join(ROOT, d);
  if (fs.existsSync(src)) copied += copyDir(src, path.join(OUT, d));
}

console.log('[build-www] 完成：' + copied + ' 个文件 -> ' + OUT);
