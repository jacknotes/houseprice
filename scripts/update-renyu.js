// Update 仁育苑 from the already-fetched saved view HTML (real anjuke data)
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { parseCommunityView } = require('../server/parsers');

const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'app.db'));
const sh = db.prepare("SELECT id FROM cities WHERE code = 'shanghai'").get();
const row = db.prepare("SELECT id, name FROM communities WHERE city_id = ? AND name = '塘和家园仁育苑'").get(sh.id);
if (!row) { console.error('仁育苑 not found'); process.exit(1); }
const f = parseCommunityView(fs.readFileSync('data/raw/anjuke-view-仁育苑.html', 'utf8'));
console.log('parsed:', JSON.stringify(f));
db.prepare(`UPDATE communities SET
  built_year = COALESCE(?, built_year), ownership_type = COALESCE(?, ownership_type),
  property_years = COALESCE(?, property_years), households = COALESCE(?, households),
  property_fee = COALESCE(?, property_fee), greening_rate = COALESCE(?, greening_rate),
  plot_ratio = COALESCE(?, plot_ratio), listed_price = COALESCE(?, listed_price),
  listed_month = COALESCE(?, listed_month), anjuke_url = ?,
  source = 'anjuke-real',
  note = '详情与挂牌均价来自安居客（真实）；历史走势为官方指数形态推算'
  WHERE id = ?`).run(
  f.built_year_raw, f.ownership_type, f.property_years, f.households || null,
  f.property_fee, f.greening_rate, f.plot_ratio,
  f.listed_price || null, f.listed_month || null,
  'https://shanghai.anjuke.com/community/view/818765', row.id
);
// re-anchor history to the real listed price
if (f.listed_price) {
  const prices = db.prepare('SELECT month, price FROM community_price WHERE cid = ? ORDER BY month').all(row.id);
  const last = prices[prices.length - 1].price;
  const k = f.listed_price / last;
  const upd = db.prepare('UPDATE community_price SET price = ROUND(price * ?, 0) WHERE cid = ? AND month = ?');
  db.exec('BEGIN');
  for (const p of prices) upd.run(k, row.id, p.month);
  db.exec('COMMIT');
  console.log(`history re-anchored ×${k.toFixed(4)} (last=${last} -> ${f.listed_price})`);
}
console.log('updated:', row.name);
