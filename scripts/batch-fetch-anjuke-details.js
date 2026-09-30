// Batch-fetch real community details from anjuke community/view pages for all
// Shanghai communities. For each community:
//   search /sale/rd1/?q=<name|alias> -> first /community/view/<id> link -> view page -> parse fields
// Updates DB fields (built_year, ownership_type, property_years, households, property_fee,
// greening_rate, plot_ratio, listed_price, listed_month, anjuke_url) and re-anchors the
// simulated history so its latest point equals the real listed price.
// Idempotent: communities already fetched (anjuke_url set) are skipped unless --force.
// Usage: node scripts/batch-fetch-anjuke-details.js [--force] [--limit=N]
'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { createClient } = require('../server/http-client');
const { parseCommunityView } = require('../server/parsers');

const ROOT = path.join(__dirname, '..');
const db = new DatabaseSync(path.join(ROOT, 'data', 'app.db'));
const client = createClient();
const AJ_BLOCK = (body) => /antibot|verifycode|xxzlGateway|callback\.58\.com|captcha/.test(String(body)) || String(body).length < 3000;
const DELAY = +(process.env.FETCH_DELAY_MS || 1600);

// search-term aliases (anjuke's official names differ from ours)
const ALIAS = {
  新凯家园银杏苑: '新凯城银杏苑',
  新凯家园玉兰苑: '新凯城玉兰苑',
  新凯家园香樟苑: '新凯城香樟苑',
  新凯家园尚樱苑: '新凯城尚樱苑',
  新凯家园紫竹苑: '新凯城紫竹苑',
  新凯家园枫景苑: '新凯城枫景苑',
  古楼新苑东区: '古楼新苑',
  古楼新苑西区: '古楼新苑',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const force = process.argv.includes('--force');
const limArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limArg ? +limArg.split('=')[1] : Infinity;

(async () => {
  // schema: add new columns if missing
  const cols = db.prepare('PRAGMA table_info(communities)').all().map((c) => c.name);
  for (const col of ['ownership_type TEXT', 'property_years TEXT']) {
    const name = col.split(' ')[0];
    if (!cols.includes(name)) db.exec(`ALTER TABLE communities ADD COLUMN ${col}`);
  }

  const city = db.prepare("SELECT id FROM cities WHERE code = 'shanghai'").get();
  const rows = db.prepare('SELECT id, name, district, listed_price FROM communities WHERE city_id = ? ORDER BY id').all(city.id);
  const targets = rows.filter((r) => force || !db.prepare('SELECT anjuke_url FROM communities WHERE id = ?').get(r.id).anjuke_url).slice(0, limit);
  console.log(`targets: ${targets.length}/${rows.length} (force=${!!force})`);

  let okCount = 0, failCount = 0;
  const failures = [];
  for (const [i, row] of targets.entries()) {
    const q = ALIAS[row.name] || row.name;
    let viewId = null;
    // 1) search page -> first community/view link
    const sr = await client.get(`https://shanghai.anjuke.com/sale/rd1/?q=${encodeURIComponent(q)}`, {
      warmupUrl: 'https://www.anjuke.com/', retries: 1, timeoutMs: 20000, isBlocked: AJ_BLOCK, referer: 'https://shanghai.anjuke.com/',
    });
    const sBody = sr.body ? sr.body.toString('utf8') : '';
    const link = sBody.match(/https:\/\/shanghai\.anjuke\.com\/community\/view\/(\d+)/);
    if (link) viewId = link[1];
    if (!viewId) {
      failCount++;
      failures.push(`${row.name}: search failed (${sr.status}${AJ_BLOCK(sBody) ? ', antibot' : ''})`);
      console.log(`[${i + 1}/${targets.length}] ${row.name}: search failed`);
      await sleep(DELAY + Math.random() * 1500);
      continue;
    }
    // 2) view page -> parse
    await sleep(800 + Math.random() * 600);
    const vr = await client.get(`https://shanghai.anjuke.com/community/view/${viewId}`, {
      retries: 1, timeoutMs: 20000, isBlocked: AJ_BLOCK, referer: 'https://shanghai.anjuke.com/sale/',
    });
    const vBody = vr.body ? vr.body.toString('utf8') : '';
    if (vr.status !== 200 || AJ_BLOCK(vBody)) {
      failCount++;
      failures.push(`${row.name}: view failed (${vr.status})`);
      console.log(`[${i + 1}/${targets.length}] ${row.name}: view failed`);
      await sleep(DELAY + Math.random() * 1500);
      continue;
    }
    const f = parseCommunityView(vBody);
    if (!f.ownership_type && !f.listed_price) {
      failCount++;
      failures.push(`${row.name}: parse empty (view ${viewId})`);
      console.log(`[${i + 1}/${targets.length}] ${row.name}: parse empty`);
      await sleep(1500);
      continue;
    }
    // 3) update DB
    const built = f.built_year_raw || null;
    db.prepare(`UPDATE communities SET
      built_year = COALESCE(?, built_year),
      ownership_type = COALESCE(?, ownership_type),
      property_years = COALESCE(?, property_years),
      households = COALESCE(?, households),
      property_fee = COALESCE(?, property_fee),
      greening_rate = COALESCE(?, greening_rate),
      plot_ratio = COALESCE(?, plot_ratio),
      listed_price = COALESCE(?, listed_price),
      listed_month = COALESCE(?, listed_month),
      anjuke_url = ?,
      source = 'anjuke-real',
      note = '详情与挂牌均价来自安居客（真实）；历史走势为官方指数形态推算'
      WHERE id = ?`).run(
      built, f.ownership_type, f.property_years, f.households || null,
      f.property_fee, f.greening_rate, f.plot_ratio,
      f.listed_price || null, f.listed_month || null,
      `https://shanghai.anjuke.com/community/view/${viewId}`, row.id
    );
    // 4) re-anchor history so the latest point equals the real listed price
    if (f.listed_price) {
      const prices = db.prepare('SELECT month, price FROM community_price WHERE cid = ? ORDER BY month').all(row.id);
      if (prices.length > 12) {
        const last = prices[prices.length - 1].price;
        const k = f.listed_price / last;
        if (Math.abs(k - 1) > 0.001) {
          const upd = db.prepare('UPDATE community_price SET price = ROUND(price * ?, 0) WHERE cid = ? AND month = ?');
          db.exec('BEGIN');
          try {
            for (const p of prices) upd.run(k, row.id, p.month);
            db.exec('COMMIT');
          } catch (e2) { db.exec('ROLLBACK'); }
        }
      }
    }
    okCount++;
    console.log(`[${i + 1}/${targets.length}] ${row.name}: OK ${f.listed_price || '-'}元/㎡ ${f.ownership_type || ''} ${f.built_year_raw || ''} ${f.households || ''}户`);
    await sleep(DELAY + Math.random() * 1500);
  }
  console.log(`\ndone: ok=${okCount}, failed=${failCount}`);
  if (failures.length) console.log('failures:\n' + failures.join('\n'));
})();
