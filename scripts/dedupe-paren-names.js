// Merge paren-named duplicates from the anjuke bulk import:
// keep the crawled anjuke-real entry (rich fields + url), rename it to our clean
// name, and delete our seeded duplicate.
'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'app.db'));
const sh = db.prepare("SELECT id FROM cities WHERE code = 'shanghai'").get();

// [keptOfficialName, ourNameToDelete]
const PAIRS = [
  ['金港花园(一期公寓住宅)', '金港花园一期'],
  ['金港花园(二期公寓住宅)', '金港花园二期'],
  ['古楼新苑(东区)', '古楼新苑东区'],
  ['古楼新苑(西区)', '古楼新苑西区'],
  ['新凯家园(一期)', '新凯家园一期'],
  ['泗泾新苑(西区)', '泗泾新苑西区'],
];
// special: 建发玖珑湾 is the official name of 玖龙湾 -> keep crawled, rename, delete ours
const RENAME_MAP = { '金港花园(一期公寓住宅)': '金港花园一期', '金港花园(二期公寓住宅)': '金港花园二期' };

db.exec('BEGIN');
try {
  for (const [keptName, delName] of PAIRS) {
    const kept = db.prepare('SELECT id, source FROM communities WHERE city_id = ? AND name = ?').get(sh.id, keptName);
    const del = db.prepare('SELECT id, source FROM communities WHERE city_id = ? AND name = ?').get(sh.id, delName);
    if (!kept || !del) { console.log('skip pair (missing):', keptName, delName); continue; }
    if (kept.source !== 'anjuke-real') { console.log('skip pair (kept not real):', keptName); continue; }
    const clean = RENAME_MAP[keptName] || keptName;
    db.prepare('UPDATE communities SET name = ? WHERE id = ?').run(clean, kept.id);
    db.prepare('DELETE FROM community_price WHERE cid = ?').run(del.id);
    db.prepare('DELETE FROM communities WHERE id = ?').run(del.id);
    console.log(`merged: ${delName} -> ${clean} (kept id ${kept.id})`);
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('failed:', e.message);
  process.exit(1);
}
const total = db.prepare('SELECT COUNT(*) AS c FROM communities WHERE city_id = ?').get(sh.id).c;
console.log('上海小区总数 now:', total);
