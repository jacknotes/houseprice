// Dump precise fragments of the community view page to design the parser
'use strict';
const fs = require('fs');
const s = fs.readFileSync('data/raw/anjuke-view-仁育苑.html', 'utf8');
for (const key of ['挂牌均价', '竣工时间', '权属类别', '产权年限', '总户数', '绿化率', '容积率', '物业费', '建成年代', '小区名称']) {
  const i = s.indexOf(key);
  if (i < 0) { console.log(`[${key}] not found`); continue; }
  console.log(`\n### ${key} @${i}`);
  console.log(JSON.stringify(s.slice(i - 20, i + 320)).slice(0, 500));
}
