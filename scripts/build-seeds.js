// Export the CURRENT live database (data/app.db) as seed datasets under
// data/processed/, so a fresh clone + `npm run seed` reproduces this project's
// full state: every community (real prices/details included) and all city
// index/level series — not the initial 10-per-city simulated demo set.
//
// Read-only against the live DB; safe to run while the server is up.
// Usage: node scripts/build-seeds.js
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'data', 'app.db');
const OUT = path.join(ROOT, 'data', 'processed');
fs.mkdirSync(OUT, { recursive: true });

const db = new DatabaseSync(DB, { readOnly: true });
const cityName = Object.fromEntries(
  db.prepare('SELECT id, name FROM cities').all().map((r) => [r.id, r.name]),
);

/* ---------- city_index.json: NBS 70-city official index series ---------- */
const idx = {};
for (const r of db
  .prepare('SELECT city_id, month, new_idx, new_mom, new_yoy, sec_idx, sec_mom, sec_yoy FROM city_index ORDER BY city_id, month')
  .iterate()) {
  // JSON keys follow the transform-nbs.js contract that server/seed.js reads
  const s = (idx[cityName[r.city_id]] ??= { months: [], newIdx: [], newMom: [], newYoy: [], secondIdx: [], secondMom: [], secondYoy: [] });
  s.months.push(r.month);
  s.newIdx.push(r.new_idx); s.newMom.push(r.new_mom); s.newYoy.push(r.new_yoy);
  s.secondIdx.push(r.sec_idx); s.secondMom.push(r.sec_mom); s.secondYoy.push(r.sec_yoy);
}
fs.writeFileSync(path.join(OUT, 'city_index.json'), JSON.stringify(idx));

/* ---------- city_level.json: anjuke city listing-price series (sparse ok) ---------- */
const lvl = {};
for (const r of db
  .prepare('SELECT city_id, month, price, mom, source FROM city_level ORDER BY city_id, month')
  .iterate()) {
  (lvl[cityName[r.city_id]] ??= []).push({ ym: r.month, price: r.price, mom: r.mom, source: r.source || 'anjuke' });
}
fs.writeFileSync(path.join(OUT, 'city_level.json'), JSON.stringify(lvl));

/* ---------- communities.json: every community + full monthly series ---------- */
const DETAIL = [
  'built_year', 'buildings', 'households', 'plot_ratio', 'greening_rate',
  'property_fee', 'listed_price', 'listed_month', 'anjuke_url', 'ownership_type', 'property_years',
];
const comms = [];
const priceStmt = db.prepare('SELECT month, price FROM community_price WHERE cid = ? ORDER BY month');
for (const c of db.prepare('SELECT * FROM communities ORDER BY city_id, id').all()) {
  const series = priceStmt.all(c.id);
  const out = {
    city: cityName[c.city_id], district: c.district, name: c.name,
    source: c.source || 'simulated', note: c.note,
  };
  for (const k of DETAIL) if (c[k] != null) out[k] = c[k];
  out.months = series.map((r) => r.month);
  out.prices = series.map((r) => r.price);
  comms.push(out);
}
fs.writeFileSync(path.join(OUT, 'communities.json'), JSON.stringify(comms));

const priceRows = comms.reduce((a, c) => a + c.months.length, 0);
console.log(`exported: city_index=${Object.keys(idx).length} cities, city_level={${Object.entries(lvl).map(([k, v]) => `${k}:${v.length}`).join(', ')}}, communities=${comms.length}, priceRows=${priceRows}`);
