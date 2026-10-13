/* lib.js —— 各检查共用的小工具 */
'use strict';
const fs = require('fs');
const path = require('path');

/* 递归收集文件，可排除目录名/文件名 */
function walk(root, exclude = []) {
  const out = [];
  (function rec(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (exclude.includes(name)) continue;
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) rec(full);
      else out.push(full);
    }
  })(root);
  return out;
}

/* 带超时的 fetch，超时/网络错返回 { error } */
async function fetchTimeout(url, opts = {}, ms = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    const text = await res.text();
    return { status: res.status, text, headers: res.headers };
  } catch (e) {
    return { error: e.name === 'AbortError' ? '请求超时(10s)' : e.message };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { walk, fetchTimeout };
