/* ============================================================
   ics.js —— 课表日历（.ics）生成器（Day 25 · T10）
   对应：PRD F8、验收 D6 / D7 / D8，RFC 5545（iCalendar）

   输入：契约 2.3 的课程数组 + 设置（settings-store.js 的形状）
   输出：完整的 .ics 文件文本（字符串），由调用方触发下载。
   纯函数：不发请求、不碰 DOM——单测可在 jsdom 里直接比对文本。

   展开规则（PRD D8）：一门课的每个周次 × 该课的星期 = 一个具体日期，
   起止时间取节次时间表里「最早一节的开始」到「最晚一节的结束」。
   周次不连续（1,5,9,13）就只生成那几天的日历，不做重复规则（RRULE）——
   真实课表周次不规则，RRULE 表达不了，逐日展开最诚实也最稳。

   细节口径：
   - 时区：固定 +08:00（Asia/Shanghai，1991 年起无夏令时），
     自带 VTIMEZONE 块——Google 日历等严格解析器要求 TZID 必须有定义；
   - 文本转义：反斜杠 / 分号 / 逗号 / 换行，按 RFC 5545 5.8 节；
   - 行折叠：单行超 74 字节按 UTF-8 字节折行，续行以空格开头（5.1 节）；
   - 行结尾：CRLF（RFC 要求，不能图省事用 \n）。
   ============================================================ */

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' → { y, m, d }。手工拆而非 new Date(str)：
    后者按 UTC 解析，在西半球时区会把日期差出一天。 */
function parseYmd(s) {
  const parts = s.split('-').map(Number);
  return { y: parts[0], m: parts[1], d: parts[2] };
}

/** 学期起点 + 偏移天数 → 'YYYYMMDD'（本地日期，经 Date 进位自动跨月/跨年） */
function icsDate(semesterStart, offsetDays) {
  const { y, m, d } = parseYmd(semesterStart);
  const dt = new Date(y, m - 1, d + offsetDays);
  return `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}`;
}

/** 'YYYYMMDD' + 'HH:MM' → 'YYYYMMDDTHHMMSS'（本地时间，配合 TZID 使用） */
function icsDateTime(dateStr, hm) {
  return `${dateStr}T${hm.replace(':', '')}00`;
}

/** 当前时刻的 UTC 戳（DTSTAMP 必须是 UTC） */
function nowUtcStamp() {
  const n = new Date();
  return (
    `${n.getUTCFullYear()}${pad2(n.getUTCMonth() + 1)}${pad2(n.getUTCDate())}` +
    `T${pad2(n.getUTCHours())}${pad2(n.getUTCMinutes())}${pad2(n.getUTCSeconds())}Z`
  );
}

/** RFC 5545 文本转义：反斜杠、分号、逗号、换行 */
function escapeIcsText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** 行折叠：超过 74 字节按 UTF-8 字节切段，续行前导空格。
    在多字节字符中间切断是允许的——折叠只是传输编码，还原时按字节拼接。 */
function foldLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 74) return line;

  const chunks = [];
  let current = [];
  for (const b of bytes) {
    current.push(b);
    if (current.length === 74) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length > 0) chunks.push(current);

  const decoder = new TextDecoder('utf-8');
  return chunks
    .map((c, i) => (i === 0 ? '' : ' ') + decoder.decode(new Uint8Array(c)))
    .join('\r\n');
}

/** 节次 → { start, end }。越界防御：契约允许 periods 到 30，
    时间表只到 12 节，越界一律按最后一节算（宁可时间怪也不崩）。 */
function periodRange(periods, periodTimes) {
  const min = Math.min(...periods);
  const max = Math.max(...periods);
  const at = (p) => periodTimes[Math.min(p, periodTimes.length) - 1];
  return { start: at(min).start, end: at(max).end };
}

/**
 * 生成整学期课表的 .ics 文本。
 * @param {Array} courses 契约 2.3 课程数组
 * @param {Object} settings { semesterStart, periodTimes }（settings-store 形状）
 * @returns {string} CRLF 结尾的 .ics 文本
 */
function generateIcs(courses, settings) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WG KeChengBiao//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Shanghai',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:CST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
  const stamp = nowUtcStamp();

  courses.forEach((course) => {
    const { start, end } = periodRange(course.periods, settings.periodTimes);
    course.weeks.forEach((week) => {
      /* 学期第 1 周周一 + (周次-1)×7 天 + (星期-1) 天 */
      const offsetDays = (week - 1) * 7 + (course.weekday - 1);
      const dateStr = icsDate(settings.semesterStart, offsetDays);

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${course.id}-W${week}@wg-kechengbiao`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART;TZID=Asia/Shanghai:${icsDateTime(dateStr, start)}`);
      lines.push(`DTEND;TZID=Asia/Shanghai:${icsDateTime(dateStr, end)}`);
      lines.push(`SUMMARY:${escapeIcsText(course.name)}`);
      if (course.location) {
        lines.push(`LOCATION:${escapeIcsText(course.location)}`);
      }
      const metaParts = [];
      if (course.teacher) metaParts.push(course.teacher);
      metaParts.push(`第${Math.min(...course.periods)}-${Math.max(...course.periods)}节`);
      metaParts.push(`第${week}周`);
      lines.push(`DESCRIPTION:${escapeIcsText(metaParts.join(' · '))}`);
      lines.push('END:VEVENT');
    });
  });

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
