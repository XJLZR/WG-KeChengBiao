/* ============================================================
   schedule-code.js —— 课表口令共享模块（Day 25，契约 2.5）
   口令 = 房间号 + 钥匙：所有课程接口按它过滤读写（拍板方案 B）。
   生成规则：6 位大写字母数字，去掉易混淆的 0/O/1/I —— 与云函数
   functions/courses/index.js 的 CODE_PATTERN 是同一份规则，两边都要守。
   存储位置：浏览器 localStorage（Day 25 拍板：口令与设置一样不上云、
   存本地；换设备 = 重新输口令，或用分享链接 网址?code=口令 直达）。
   首页 / 导入页 / 入口页 / 检查台共用；只依赖 localStorage，无其他依赖。
   ============================================================ */

/* 口令字符集：34 个易辨认字符（去掉 0/O/1/I）。
   6 位 → 34^6 ≈ 15 亿种组合，校园场景撞不上。 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* 与云函数同一份格式规则 */
const SCHEDULE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

/* localStorage 键名 */
const SCHEDULE_CODE_STORAGE_KEY = 'wg-schedule-code';

/** 校验口令格式是否合法 */
function isValidScheduleCode(code) {
  return typeof code === 'string' && SCHEDULE_CODE_PATTERN.test(code);
}

/** 读当前口令：没存过，或存的内容已不合法 → null（调用方应引导去入口页） */
function getScheduleCode() {
  const value = localStorage.getItem(SCHEDULE_CODE_STORAGE_KEY);
  return isValidScheduleCode(value) ? value : null;
}

/** 保存口令（入口页创建/输入成功后调用） */
function setScheduleCode(code) {
  localStorage.setItem(SCHEDULE_CODE_STORAGE_KEY, code);
}

/** 清除口令（「换课表」用：清掉后回首页会自动跳入口页） */
function clearScheduleCode() {
  localStorage.removeItem(SCHEDULE_CODE_STORAGE_KEY);
}

/**
 * 自动生成一个口令（Day 25 拍板：只自动生成，不支持自定义）。
 * 用 crypto.getRandomValues 而不是 Math.random：
 * 口令是这门课表的「钥匙」，随机源必须是密码学级别的。
 * 字符集恰好 34 个，256 能被 32 整除（每字节取模无偏），取模取值公平。
 */
function generateScheduleCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/** 从网址 ?code= 取口令（分享链接直达；小写自动转大写），没有或不合法返回 null */
function scheduleCodeFromUrl() {
  const raw = new URLSearchParams(window.location.search).get('code');
  if (raw === null) return null;
  const code = raw.trim().toUpperCase();
  return isValidScheduleCode(code) ? code : null;
}

/**
 * 给接口地址追加 ?code=（地址已有 query 时用 & 接）。
 * 口令没设置时返回 null —— 调用方应先跳入口页，
 * 而不是发一个注定 MISSING_CODE 的请求。
 */
function apiUrlWithCode(url) {
  const code = getScheduleCode();
  if (!code) return null;
  return `${url}${url.includes('?') ? '&' : '?'}code=${encodeURIComponent(code)}`;
}
