// Incremental data refresh worker (runs at startup and on demand).
//
// Cost/robustness design:
//  - NBS 70-city index: ONE conditional GET to the jsDelivr mirror (If-None-Match/etag),
//    with retry fallback to raw.githubusercontent.com. No new month -> HTTP 304 (~200B).
//    New month -> ~5MB CSV, parsed in-memory, upserted (~1-2s).
//  - Anjuke city listing price (深圳/咸宁): homepage warm-up -> cookie jar -> target pages,
//    retry w/ backoff; anti-bot blocks are tolerated and reported, never fatal.
//  - Anti-blocking: browser-like headers + cookie jar + retries; optional outbound proxy
//    (FETCH_PROXY_URL) and manual cookie injection (ANJUKE_COOKIE) via env.
//  - Everything runs async AFTER the server is listening; env REFRESH_ON_START=0 disables.
'use strict';
const { parseNbsCsv, parseAnjukeTable } = require('./parsers');
const { createClient } = require('./http-client');

const NBS_MIRRORS = [
  'https://cdn.jsdelivr.net/gh/hugohe3/70cityprice@main/70cityprice.csv',
  'https://raw.githubusercontent.com/hugohe3/70cityprice/main/70cityprice.csv',
];
const ANJUKE_CITIES = [
  ['深圳', 'shenzhen'],
  ['咸宁', 'xianning'],
];
const AJ_BLOCK = (body) => /antibot|verifycode|xxzlGateway|callback\.58\.com/.test(String(body)) || String(body).length < 2000;

const client = createClient();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function refreshNbs(db, log) {
  const meta = (k) => db.prepare('SELECT value FROM meta WHERE key = ?').get(k);
  const etagRow = meta('nbs_csv_etag');
  let result = { source: null, status: 'failed', detail: '' };
  for (const url of NBS_MIRRORS) {
    const r = await client.get(url, {
      retries: 2,
      backoffMs: 1200,
      timeoutMs: 25000,
      okStatuses: [200, 304],
      extraHeaders: etagRow ? { 'If-None-Match': etagRow.value } : {},
    });
    if (r.status === 304) {
      log('NBS: 上游无更新 (304 Not Modified)');
      return { source: url, status: 'not-modified', detail: '上游无新数据 (304)' };
    }
    if (r.status !== 200 || !r.buf || !r.buf.length) {
      log(`NBS: 镜像失败 ${url} -> ${r.status || r.err}`);
      continue;
    }
    const csv = r.buf.toString('utf8');
    if (!csv.includes('CommodityHouseIDX')) {
      log('NBS: 响应不是有效的CSV，跳过');
      continue;
    }
    const parsed = parseNbsCsv(csv);
    const cityRows = db.prepare('SELECT id, name FROM cities').all();
    const byName = Object.fromEntries(cityRows.map((row) => [row.name, row.id]));
    const upsert = db.prepare('INSERT OR REPLACE INTO city_index VALUES (?,?,?,?,?,?,?,?)');
    let rows = 0;
    db.exec('BEGIN');
    try {
      for (const [name, s] of Object.entries(parsed)) {
        const id = byName[name];
        if (!id) continue;
        for (let i = 0; i < s.months.length; i++) {
          upsert.run(id, s.months[i], s.newIdx[i], s.newMom[i], s.newYoy[i], s.secondIdx[i], s.secondMom[i], s.secondYoy[i]);
          rows++;
        }
      }
      const etag = (r.headers && r.headers.etag) || null;
      if (etag) db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('nbs_csv_etag', etag);
      db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('index_source', '国家统计局70个大中城市商品住宅销售价格指数（月度，环比链式合成定基指数；启动时自动更新）');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return { source: url, status: 'failed', detail: String(e) };
    }
    log(`NBS: 已更新 ${rows} 行（70城指数）`);
    return { source: url, status: 'updated', detail: `${rows} 行` };
  }
  return result;
}

async function refreshAnjuke(db, log) {
  const out = {};
  for (const [name, code] of ANJUKE_CITIES) {
    // homepage warm-up collects anjuke cookies before hitting the data page
    const r = await client.get(`https://www.anjuke.com/fangjia/${code}/`, {
      warmupUrl: 'https://www.anjuke.com/',
      referer: 'https://www.anjuke.com/',
      timeoutMs: 18000,
      retries: 1,
      backoffMs: 2000,
      isBlocked: AJ_BLOCK,
    });
    const body = r.body ? r.body.toString('utf8') : '';
    if (r.status !== 200 || !/元\/㎡/.test(body)) {
      const why = r.status === 200 ? '反爬拦截' : (r.err || ('status ' + r.status));
      log(`安居客[${name}]: 未取到（${why}），跳过`);
      out[code] = 'blocked-or-empty';
      await sleep(2000);
      continue;
    }
    const rows = parseAnjukeTable(body);
    if (!rows.length) {
      out[code] = 'parse-empty';
      continue;
    }
    const city = db.prepare('SELECT id FROM cities WHERE code = ?').get(code);
    if (!city) continue;
    const upsert = db.prepare('INSERT OR REPLACE INTO city_level VALUES (?,?,?,?,?)');
    const prev = db.prepare('SELECT price FROM city_level WHERE city_id = ? AND month < ? ORDER BY month DESC LIMIT 1').get(city.id, rows[0].ym);
    db.exec('BEGIN');
    try {
      for (const row of rows) {
        const mom = prev ? +(((row.price / prev.price) - 1) * 100).toFixed(2) : (row.momListed ?? null);
        upsert.run(city.id, row.ym, row.price, mom, 'anjuke');
        prev = { price: row.price };
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      out[code] = 'db-error';
      continue;
    }
    log(`安居客[${name}]: 更新 ${rows.length} 个月度挂牌均价`);
    out[code] = `updated:${rows.length}`;
    await sleep(2000);
  }
  return out;
}

async function refreshAll(db, log = console.log) {
  const started = Date.now();
  const result = { startedAt: new Date().toISOString(), nbs: null, anjuke: null };
  try {
    result.nbs = await refreshNbs(db, log);
  } catch (e) {
    result.nbs = { status: 'failed', detail: String(e) };
    log('NBS 刷新异常: ' + e.message);
  }
  try {
    // ANJUKE_REFRESH=0 时跳过安居客刷新：机房 IP 每次都会被人机校验拦截，
    // 反复请求只会白白触发对方风控；安居客数据改由本机抓取任务负责
    if (process.env.ANJUKE_REFRESH === '0') {
      result.anjuke = { status: 'skipped', detail: 'ANJUKE_REFRESH=0' };
      log('安居客刷新: 已按 ANJUKE_REFRESH=0 跳过');
    } else {
      result.anjuke = await refreshAnjuke(db, log);
    }
  } catch (e) {
    result.anjuke = { status: 'failed', detail: String(e) };
    log('安居客刷新异常: ' + e.message);
  }
  result.costMs = Date.now() - started;
  db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('last_refresh', JSON.stringify(result));
  log(`刷新完成，耗时 ${(result.costMs / 1000).toFixed(1)}s`);
  return result;
}

module.exports = { refreshAll, client, AJ_BLOCK, NBS_MIRRORS };
