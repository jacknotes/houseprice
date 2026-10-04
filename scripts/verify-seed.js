// Verify that `npm run seed` (into a scratch DB) reproduces the live DB exactly:
// counts, sums, per-city/per-source breakdowns, and full-row spot checks.
// Usage: node scripts/verify-seed.js   (expects data/seed-test.db to exist,
//         created via SEED_DB_PATH=data/seed-test.db npm run seed)
'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const live = new DatabaseSync(path.join(ROOT, 'data', 'app.db'), { readOnly: true });
const seeded = new DatabaseSync(path.join(ROOT, 'data', 'seed-test.db'), { readOnly: true });

const checks = [
  ['cities', 'SELECT COUNT(*) n FROM cities'],
  ['city_index rows', 'SELECT COUNT(*) n FROM city_index'],
  ['city_level rows+sum', 'SELECT COUNT(*) n, SUM(price) s FROM city_level'],
  ['communities', 'SELECT COUNT(*) n FROM communities'],
  ['community_price rows+sum', 'SELECT COUNT(*) n, SUM(price) s FROM community_price'],
  ['per-city communities', 'SELECT ci.code code, COUNT(*) n FROM communities cm JOIN cities ci ON ci.id=cm.city_id GROUP BY cm.city_id ORDER BY ci.code'],
  ['per-source communities', 'SELECT source, COUNT(*) n FROM communities GROUP BY source ORDER BY source'],
  ['with anjuke_url', 'SELECT COUNT(*) n FROM communities WHERE anjuke_url IS NOT NULL'],
  ['with listed_price', 'SELECT COUNT(*) n FROM communities WHERE listed_price IS NOT NULL'],
  ['price month range', 'SELECT MIN(month) a, MAX(month) b FROM community_price'],
];

let ok = true;
for (const [label, sql] of checks) {
  const a = JSON.stringify(live.prepare(sql).all());
  const b = JSON.stringify(seeded.prepare(sql).all());
  const same = a === b;
  if (!same) ok = false;
  console.log(`${same ? 'OK  ' : 'DIFF'} ${label}${same ? '' : `: live=${a} seeded=${b}`}`);
}

// full-row + series spot check on every real-source community
// (ids are renumbered by seed insertion order, so compare rows without id)
const stripId = (rows) => rows.map(({ id, ...rest }) => rest);
const reals = live.prepare("SELECT name FROM communities WHERE source != 'simulated' ORDER BY name").all();
let realOk = 0, realBad = [];
for (const { name } of reals) {
  const ra = live.prepare('SELECT * FROM communities WHERE name = ?').all(name);
  const rb = seeded.prepare('SELECT * FROM communities WHERE name = ?').all(name);
  const pa = live.prepare('SELECT month, price FROM community_price WHERE cid = ? ORDER BY month').all(ra[0].id);
  const pb = seeded.prepare('SELECT month, price FROM community_price WHERE cid = ? ORDER BY month').all(rb[0].id);
  const rowSame = JSON.stringify(stripId(ra)) === JSON.stringify(stripId(rb));
  const seriesSame = JSON.stringify(pa) === JSON.stringify(pb);
  if (rowSame && seriesSame) realOk++;
  else { realBad.push(name); ok = false; }
}
console.log(`real-source communities checked: ${realOk}/${reals.length} exact${realBad.length ? ' — DIFF: ' + realBad.join(', ') : ''}`);
console.log(ok ? 'ALL MATCH — seed reproduces the live DB' : 'MISMATCH FOUND');
