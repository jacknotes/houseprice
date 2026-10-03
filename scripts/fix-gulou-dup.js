// Merge the duplicate 古楼新苑东区 rows: keep the original (has price series),
// apply real fields + re-anchor history to the real listed price, delete the dup.
'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'app.db'));
const sh = db.prepare("SELECT id FROM cities WHERE code = 'shanghai'").get();
const rows = db.prepare("SELECT id, name, district, source, listed_price, anjuke_url FROM communities WHERE city_id = ? AND name LIKE '古楼新苑%'").all(sh.id);
console.log('rows:', JSON.stringify(rows));
const withPrices = rows.find((r) => db.prepare('SELECT COUNT(*) AS c FROM community_price WHERE cid = ?').get(r.id).c > 12);
const dups = rows.filter((r) => r.id !== (withPrices && withPrices.id));
if (!withPrices) { console.error('no original with prices'); process.exit(1); }
db.exec('BEGIN');
try {
  for (const d of dups) {
    db.prepare('DELETE FROM community_price WHERE cid = ?').run(d.id);
    db.prepare('DELETE FROM communities WHERE id = ?').run(d.id);
    console.log('deleted dup id', d.id);
  }
  db.prepare(`UPDATE communities SET
    district = '泗泾', built_year = '2013年', ownership_type = '动迁配套房', property_years = '70年',
    households = 560, plot_ratio = 2.0, greening_rate = 40.0, property_fee = '1.20元/平米/月',
    listed_price = 25032, listed_month = '2026-10',
    anjuke_url = 'https://shanghai.anjuke.com/community/view/611824',
    source = 'anjuke-real',
    note = '详情与挂牌均价来自安居客（真实）；历史走势为官方指数形态推算'
    WHERE id = ?`).run(withPrices.id);
  // re-anchor history to the real listed price
  const prices = db.prepare('SELECT month, price FROM community_price WHERE cid = ? ORDER BY month').all(withPrices.id);
  const last = prices[prices.length - 1].price;
  const k = 25032 / last;
  const upd = db.prepare('UPDATE community_price SET price = ROUND(price * ?, 0) WHERE cid = ? AND month = ?');
  for (const p of prices) upd.run(k, withPrices.id, p.month);
  db.exec('COMMIT');
  console.log(`merged: kept id=${withPrices.id}, re-anchored ×${k.toFixed(4)} (last=${last} -> 25032)`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('failed:', e.message);
  process.exit(1);
}
