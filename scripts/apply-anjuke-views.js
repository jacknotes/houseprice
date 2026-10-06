// 解析 data/raw/aj-view-*.html（浏览器收割的安居客详情页）并入库 anjuke-real + 重锚定
// 用法: node scripts/apply-anjuke-views.js
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { parseCommunityView } = require('../server/parsers');

const RAW = path.join(__dirname, '..', 'data', 'raw');
const db = new DatabaseSync(path.join(ROOT_dir(), 'data', 'app.db'));
function ROOT_dir() { return path.join(__dirname, '..'); }

const files = fs.readdirSync(RAW).filter((f) => /^aj-view-.+\.html$/.test(f));
let applied = 0, skipped = 0;
for (const f of files) {
  const name = f.replace(/^aj-view-/, '').replace(/\.html$/, '');
  const cityRow = db.prepare(`
    SELECT ci.id, ci.code FROM cities ci JOIN communities cm ON cm.city_id = ci.id
    WHERE cm.name = ? LIMIT 1`).get(name);
  if (!cityRow) { console.log(`skip ${name}: city unknown`); continue; }
  const row = db.prepare('SELECT id, source FROM communities WHERE city_id=? AND name=?').get(cityRow.id, name);
  if (!row) { console.log(`skip ${name}: not in db`); continue; }
  const html = fs.readFileSync(path.join(RAW, f), 'utf8');
  if (/请输入验证码|callback\.58\.com/.test(html) || html.length < 50000) {
    console.log(`skip ${name}: stub/captcha page (${html.length}B)`);
    skipped++;
    continue;
  }
  const fields = parseCommunityView(html);
  if (!fields.listed_price) { console.log(`skip ${name}: no listed_price parsed`); skipped++; continue; }
  const host = cityRow.code === 'shanghai' ? 'shanghai' : cityRow.code;
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE communities SET built_year=COALESCE(?,built_year), ownership_type=COALESCE(?,ownership_type),
      property_years=COALESCE(?,property_years), households=COALESCE(?,households), property_fee=COALESCE(?,property_fee),
      greening_rate=COALESCE(?,greening_rate), plot_ratio=COALESCE(?,plot_ratio), listed_price=?, listed_month=?,
      anjuke_url=?, source='anjuke-real',
      note='详情与挂牌均价来自安居客（真实）；历史走势为官方指数形态推算' WHERE id=?`)
      .run(fields.built_year_raw, fields.ownership_type, fields.property_years, fields.households || null,
        fields.property_fee, fields.greening_rate, fields.plot_ratio, fields.listed_price, fields.listed_month,
        `https://${host}.anjuke.com/community/view/`, row.id);
    const prices = db.prepare('SELECT month, price FROM community_price WHERE cid=? ORDER BY month').all(row.id);
    if (prices.length) {
      const last = prices[prices.length - 1].price;
      if (last > 0) {
        const k = fields.listed_price / last;
        const upd = db.prepare('UPDATE community_price SET price = ROUND(price * ?, 0) WHERE cid=? AND month=?');
        for (const p of prices) upd.run(k, row.id, p.month);
      }
    }
    db.exec('COMMIT');
    fs.unlinkSync(path.join(RAW, f));
    applied++;
    console.log(`applied ${name}: ${fields.listed_price} 元/㎡ (${fields.listed_month || '?'})`);
  } catch (e) {
    db.exec('ROLLBACK');
    console.error(`apply failed ${name}:`, e.message);
  }
}
console.log(`done: applied=${applied}, skipped=${skipped}`);
