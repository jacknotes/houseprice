// Transform NBS 70-city CSV into chained fixed-base index series (JSON for seeding).
// Usage: node scripts/transform-nbs.js
const fs = require('fs');
const path = require('path');
const { parseNbsCsv } = require('../server/parsers');

const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'raw', '70cityprice.csv'), 'utf8');
const result = parseNbsCsv(raw);

const outDir = path.join(__dirname, '..', 'data', 'processed');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'city_index.json'), JSON.stringify(result));

for (const city of ['北京', '上海', '广州', '深圳', '武汉']) {
  const s = result[city];
  const peak = Math.max(...s.newIdx.filter((x) => x != null));
  console.log(`${city}: months=${s.months.length} ${s.months[0]}->${s.months[s.months.length - 1]} peak=${peak.toFixed(1)}@${s.months[s.newIdx.indexOf(peak)]}`);
}
console.log('cities:', Object.keys(result).length);
