const s = require('fs').readFileSync('data/raw/anjuke-view-仁育苑.html', 'utf8');
const i = s.indexOf('挂牌均价');
const seg = s.slice(i - 900, i + 60);
// print tag-stripped but keep order
const lines = seg.split(/(?=<div|<\/div|<p|<\/p)/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 2);
console.log(lines.join('\n'));
