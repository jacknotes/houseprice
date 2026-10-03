// Merge 新凯家园(二期) into 新凯家园二期
'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'app.db'));
const sh = db.prepare("SELECT id FROM cities WHERE code = 'shanghai'").get();
const kept = db.prepare("SELECT id, source FROM communities WHERE city_id = ? AND name = '新凯家园(二期)'").get(sh.id);
const del = db.prepare("SELECT id FROM communities WHERE city_id = ? AND name = '新凯家园二期'").get(sh.id);
console.log('kept:', JSON.stringify(kept), 'del:', JSON.stringify(del));
if (kept && del && kept.source === 'anjuke-real') {
  db.exec('BEGIN');
  db.prepare('DELETE FROM community_price WHERE cid = ?').run(del.id);
  db.prepare('DELETE FROM communities WHERE id = ?').run(del.id);
  db.prepare('UPDATE communities SET name = ? WHERE id = ?').run('新凯家园二期', kept.id);
  db.exec('COMMIT');
  console.log('merged: kept id', kept.id);
} else {
  console.log('skip (check state)');
}
const total = db.prepare('SELECT COUNT(*) AS c FROM communities WHERE city_id = ?').get(sh.id).c;
console.log('上海小区总数 now:', total);
