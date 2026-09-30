// Parse anjuke fangjia SSR table: month rows -> {month, price, mom}
// Usage: node parse-anjuke-table.js <city>  (reads data/raw/anjuke_<city>.html)
const fs = require('fs');
const city = process.argv[2] || 'shenzhen';
const s = fs.readFileSync(`data/raw/anjuke_${city}.html`, 'utf8');
const rows = [];
const re = /<div class="td first"[^>]*>\s*20(\d{2})年(\d{1,2})月房价\s*<\/div>\s*<div class="td"[^>]*>\s*([\d\-\.]+)(?:元\/㎡)?\s*<\/div>\s*<div class="td"[^>]*>(?:<div class="(up|down)"[^>]*><\/div>)?\s*([\d\-\.]+)%/g;
let m;
while ((m = re.exec(s))) {
  const year = 2000 + +m[1], month = +m[2];
  const price = m[3] === '-' ? null : +m[3];
  const mom = m[5] === '-' ? null : (m[4] === 'down' ? -+m[5] : +m[5]);
  rows.push({ ym: `${year}-${String(month).padStart(2, '0')}`, price, mom });
}
// dedupe & sort
const seen = new Map();
for (const r of rows) if (!seen.has(r.ym)) seen.set(r.ym, r);
const list = [...seen.values()].sort((a, b) => a.ym.localeCompare(b.ym));
console.log('city:', city, 'rows:', list.length);
if (list.length) {
  console.log('range:', list[0].ym, '->', list[list.length - 1].ym);
  console.log('first:', JSON.stringify(list[0]), 'last:', JSON.stringify(list[list.length - 1]));
  fs.writeFileSync(`data/raw/anjuke_${city}.json`, JSON.stringify(list, null, 1));
  console.log('saved data/raw/anjuke_' + city + '.json');
}
