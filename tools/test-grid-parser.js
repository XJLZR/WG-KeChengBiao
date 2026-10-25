/* ============================================================
   tools/test-grid-parser.js —— 网格式解析器单测
   ------------------------------------------------------------
   两层验证：
     ① 纯函数单测（周次/节次/星期的各种写法）
     ② 真文件端到端：用 SheetJS 读一份真实的二进制 .xls，
        再交给 grid-parser 解析，断言课程数量与关键字段。

   为什么必须用真文件：格式规则是从真实导出文件里抠出来的，
   构造的假数据只能验证「我以为的规则」，验证不了真实数据。

   用法：node tools/test-grid-parser.js <课表文件路径>
   不给路径时只跑纯函数单测。
   ============================================================ */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const gp = require(path.join(ROOT, 'js/grid-parser.js'));
const XLSX = require(path.join(ROOT, 'js/vendor/xlsx.full.min.js'));

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${label}\n      期望 ${e}\n      实际 ${a}`);
  }
}

/* ---------- ① 纯函数单测 ---------- */

console.log('【一】周次解析');
check('1-8[周]', gp.parseGridWeeks('1-8[周]'), [1, 2, 3, 4, 5, 6, 7, 8]);
check('12-15[周]', gp.parseGridWeeks('12-15[周]'), [12, 13, 14, 15]);
check('14[周]', gp.parseGridWeeks('14[周]'), [14]);
check('1-6,8-16[周]', gp.parseGridWeeks('1-6,8-16[周]'),
  [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
check('1-16周(单)', gp.parseGridWeeks('1-16周(单)'), [1, 3, 5, 7, 9, 11, 13, 15]);
check('1-16周(双)', gp.parseGridWeeks('1-16周(双)'), [2, 4, 6, 8, 10, 12, 14, 16]);
check('无周字 → null', gp.parseGridWeeks('1-8'), null);
check('乱码 → null', gp.parseGridWeeks('第一学期'), null);

console.log('【二】节次解析');
check('[01-02]节', gp.parseGridPeriods('[01-02]节'), [1, 2]);
check('[03-04-05]节', gp.parseGridPeriods('[03-04-05]节'), [3, 4, 5]);
check('[06-07-08-09]节', gp.parseGridPeriods('[06-07-08-09]节'), [6, 7, 8, 9]);
check('第1-2节', gp.parseGridPeriods('第1-2节'), [1, 2]);
check('0102（两位一节）', gp.parseGridPeriods('0102'), [1, 2]);
check('08（单节）', gp.parseGridPeriods('08'), [8]);
check('101112（10,11,12 节）', gp.parseGridPeriods('101112'), [10, 11, 12]);
check('345（单字切）', gp.parseGridPeriods('345'), [3, 4, 5]);
check('超出 12 节 → null', gp.parseGridPeriods('[13-14]节'), null);

console.log('【三】星期解析');
check('星期一', gp.parseGridWeekday('星期一'), 1);
check('星期日', gp.parseGridWeekday('星期日'), 7);
check('周日', gp.parseGridWeekday('周日'), 7);
check('周一', gp.parseGridWeekday('周一'), 1);
check('Mon', gp.parseGridWeekday('Mon'), 1);
check('课程名称 → null', gp.parseGridWeekday('课程名称'), null);

/* ---------- ② 真文件端到端 ---------- */

const file = process.argv[2];
if (!file) {
  console.log('\n[跳过] 未提供课表文件，只跑了纯函数单测。');
} else if (!fs.existsSync(file)) {
  console.log('\n[跳过] 文件不存在：' + file);
} else {
  console.log('【四】真实文件端到端');
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

  const layout = gp.detectGridLayout(rows);
  check('识别到表头行下标', layout && layout.headerIndex, 2);
  check('识别到 7 个星期列', layout && Object.keys(layout.weekdayCols).length, 7);

  const result = gp.parseGridTable(rows);
  console.log('  解析结果：ok=' + result.ok + ' 课程数=' + (result.courses ? result.courses.length : '-')
    + ' stats=' + JSON.stringify(result.stats));

  if (!result.ok) {
    fail++;
    console.log('  ✗ 解析失败：' + JSON.stringify(result.error));
  } else {
    const list = result.courses;
    check('课程总数', list.length, 18);

    const find = (name, wd) => list.find((c) => c.name === name && c.weekday === wd);

    const el = find('大学英语B3', 2);
    check('大学英语B3 周二 周次', el && el.weeks,
      [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    check('大学英语B3 周二 节次', el && el.periods, [1, 2]);
    check('大学英语B3 周二 地点', el && el.location, 'L4201');
    check('大学英语B3 周二 教师', el && el.teacher, '汤菁菁');

    const pe = find('模拟电子技术', 2);
    check('模拟电子技术 周二 节次', pe && pe.periods, [3, 4]);
    check('模拟电子技术 周二 周次首尾', pe && [pe.weeks[0], pe.weeks[pe.weeks.length - 1]], [2, 15]);

    const sport = find('大学体育(3)(乒乓球B)', 4);
    check('多行课程名被合并', !!sport, true);
    check('体育课地点（中文）', sport && sport.location, '钟楼乒乓球室');

    const lab = find('大学物理实验（下）', 2);
    check('跨节次合并为一门', lab && lab.periods, [6, 7, 8, 9]);
    check('同一格重复出现→周次合并', lab && lab.weeks, [3, 4, 5, 6, 7, 8]);

    const single = find('大学英语B3', 5);
    check('单周 [14周]', single && single.weeks, [14]);

    /* 全部课程都必须有 name/weekday/periods/weeks 四个必填字段 */
    const bad = list.filter((c) => !c.name || !c.weekday || !c.periods || !c.weeks);
    check('无残缺课程', bad.length, 0);
    /* id 必须唯一 */
    check('id 唯一', new Set(list.map((c) => c.id)).size, list.length);
  }
}

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
