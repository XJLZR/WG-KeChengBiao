/* ============================================================
   tools/test-list-parser.js —— 列表式解析器单测（Day 29 · A 方案）
   ------------------------------------------------------------
   验三件事：
     ① 别名表：不同写法的表头都能认出同一字段
     ② 值容错：同一个字段的不同写法都能解析成同一个结果
     ③ 不回归：原有标准格式、合并规则、错误三分类未被破坏

   用法：node tools/test-list-parser.js [真实样本路径]
   ============================================================ */

const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

/* parser.js 依赖浏览器全局 DOMParser，Node 里用 jsdom 补上 */
global.DOMParser = new JSDOM('').window.DOMParser;
const P = require(path.resolve(__dirname, '../js/parser.js'));

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.log(`  ✗ ${label}\n      期望 ${e}\n      实际 ${a}`); }
}

/* 用二维数组拼一张列表式课表 HTML，表头文字与取值由调用方决定 */
function makeTable(headers, rows) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const head = '<tr>' + headers.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr>';
  const body = rows
    .map((r) => '<tr>' + r.map((c) => `<td>${esc(c)}</td>`).join('') + '</tr>')
    .join('');
  return `<html><body><table>${head}${body}</table></body></html>`;
}

/* ---------- ① 别名单测 ---------- */

console.log('【一】字段别名');
const aliasCases = [
  ['标准写法', ['课程名称', '周次', '星期', '节次']],
  ['短写法', ['课程名', '周次', '星期', '节次']],
  ['教室/老师', ['课程', '上课周次', '周几', '上课节次', '教室', '老师']],
  ['科目/教学周', ['科目', '教学周', '星期几', '课节', '上课地点', '任课教师']],
];
for (const [label, headers] of aliasCases) {
  const html = makeTable(headers, [['高等数学', '1-8', '1', '0102']]);
  const r = P.parseCourseTable(html);
  check(label + ' → 能解析', r.ok && r.courses.length, 1);
  check(label + ' → 课程名', r.ok && r.courses[0].name, '高等数学');
}

console.log('【二】单元格取值容错');
const weekCases = [
  ['1', [1]],
  ['1-16周', [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]],
  ['1-8,10-12', [1,2,3,4,5,6,7,8,10,11,12]],
  ['第1-4周', [1,2,3,4]],
  ['1-8周(单)', [1,3,5,7]],
  ['1-8周(双)', [2,4,6,8]],
];
for (const [input, expected] of weekCases) {
  check(`周次「${input}」`, P.parseWeeksValue(input), expected);
}
check('周次乱码 → null', P.parseWeeksValue('第一学期'), null);

const weekdayCases = [
  ['1', 1], ['7', 7], ['一', 1], ['日', 7], ['天', 7],
  ['星期一', 1], ['周日', 7], ['礼拜三', 3], ['Mon', 1], ['Sunday', 7],
];
for (const [input, expected] of weekdayCases) {
  check(`星期「${input}」`, P.parseWeekdayValue(input), expected);
}
check('星期乱码 → null', P.parseWeekdayValue('上午'), null);

const periodCases = [
  ['0102', [1, 2]],
  ['08', [8]],
  ['第1-2节', [1, 2]],
  ['[01-02]节', [1, 2]],
  ['1,2', [1, 2]],
  ['101112', [10, 11, 12]],
  ['345', [3, 4, 5]],
];
for (const [input, expected] of periodCases) {
  check(`节次「${input}」`, P.parsePeriodsValue(input), expected);
}
check('节次超范围 → null', P.parsePeriodsValue('第13-14节'), null);

console.log('【三】组合：换成另一所学校的写法，整表可解析');
{
  const html = makeTable(
    ['科目', '教学周', '星期几', '课节', '教室', '任课教师'],
    [
      ['线性代数', '1-16周', '星期一', '第1-2节', '教5-201', '张三'],
      ['线性代数', '1-16周', '星期三', '第3-4节', '教5-201', '张三'],
      ['体育', '1-8周(单)', '星期五', '第5-6节', '操场', '李四'],
      ['体育', '1-8周(双)', '星期五', '第5-6节', '操场', '李四'],
    ]
  );
  const r = P.parseCourseTable(html);
  check('整表解析成功', r.ok, true);
  /* 前两条星期不同 → 两门；后两条同名同星期同节次同地点 → 合并成一门，周次并集 1-8 */
  check('识别出门数', r.courses.length, 3);
  const sports = r.courses.find((c) => c.name === '体育');
  check('单双周合并为 1-8', sports && sports.weeks, [1,2,3,4,5,6,7,8]);
  check('奇数周课保留', r.courses.filter((c) => c.name === '线性代数').length, 2);
}

console.log('【四】错误分类未被破坏');
{
  const noPeriods = P.parseCourseTable(makeTable(['课程名称', '周次', '星期'], [['课', '1-8', '1']]));
  check('缺节次列 → NOT_COURSE_FILE', noPeriods.ok === false && noPeriods.error.code, 'NOT_COURSE_FILE');

  const empty = P.parseCourseTable('   ');
  check('空文件 → FILE_EMPTY', empty.ok === false && empty.error.code, 'FILE_EMPTY');

  const zero = P.parseCourseTable(makeTable(['课程名称', '周次', '星期', '节次'], [['', '', '', '']]));
  check('零记录 → ZERO_RECORDS', zero.ok === false && zero.error.code, 'ZERO_RECORDS');

  const notTable = P.parseCourseTable('<html><body><p>hello</p></body></html>');
  check('不是课表 → NOT_COURSE_FILE', notTable.ok === false && notTable.error.code, 'NOT_COURSE_FILE');
}

/* ---------- ⑤ 真实样本回归 ---------- */

const sample = process.argv[2];
if (sample && fs.existsSync(sample)) {
  console.log('【五】真实样本回归');
  const r = P.parseCourseTable(fs.readFileSync(sample, 'utf8'));
  console.log('  结果：ok=' + r.ok + ' 课程数=' + (r.courses ? r.courses.length : '-')
    + ' stats=' + JSON.stringify(r.stats));
  check('样本可解析', r.ok, true);
  check('课程数', r.courses ? r.courses.length : 0, 32);
  check('全部课程字段完整', r.courses.filter((c) => c.name && c.weekday && c.periods.length && c.weeks.length).length,
    r.courses.length);
}

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
