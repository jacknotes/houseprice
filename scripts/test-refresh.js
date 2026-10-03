// One-off verification: run refreshAll against a COPY of app.db and report
// what the NBS refresh path actually did (post r.buf->r.body fix).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const src = path.join(__dirname, '..', 'data', 'app.db');
const dst = path.join(__dirname, '..', 'data', 'refresh-test.db');
fs.copyFileSync(src, dst);
for (const suffix of ['-wal', '-shm']) {
  const f = dst + suffix;
  if (fs.existsSync(f)) fs.rmSync(f);
}

const { refreshAll } = require('../server/refresh');
const db = new DatabaseSync(dst);

(async () => {
  const before = db.prepare('SELECT MAX(month) m, COUNT(*) n FROM city_index').get();
  const r = await refreshAll(db, (msg) => console.log('[refresh]', msg));
  const after = db.prepare('SELECT MAX(month) m, COUNT(*) n FROM city_index').get();
  const etag = db.prepare("SELECT value FROM meta WHERE key='nbs_csv_etag'").get();
  console.log('city_index before:', JSON.stringify(before));
  console.log('refresh result:', JSON.stringify(r));
  console.log('city_index after:', JSON.stringify(after));
  console.log('etag stored:', etag ? etag.value : '(none)');
  db.close();
  fs.rmSync(dst);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
