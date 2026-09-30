// HTTP API + static server
// Usage: node server/index.js   (PORT env optional, default 3000)
'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { M } = require('./city-meta');
const { refreshAll, client, AJ_BLOCK, NBS_MIRRORS } = require('./refresh');
const { fetchCommunityReal } = require('./xiaoqu-fetch');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'app.db');
const db = new DatabaseSync(DB_PATH);
const app = express();
app.use(express.json({ limit: '2mb' }));

const ok = (res, data) => res.json({ ok: true, data });
let refreshing = false;

/* ---------- helpers ---------- */
const q = (sql, ...params) => db.prepare(sql).all(...params);
const get = (sql, ...params) => db.prepare(sql).get(...params);

function cityRowToMeta(r) {
  return { id: r.id, code: r.code, name: r.name, province: r.province, tier: r.tier, in70: !!r.in70, featured: !!r.featured };
}
function cityByCode(code) {
  return get('SELECT * FROM cities WHERE code = ?', String(code || '').toLowerCase());
}

/* ---------- meta / cities ---------- */
app.get('/api/health', (req, res) => ok(res, { status: 'up' }));

app.get('/api/meta', (req, res) => {
  const latest = get('SELECT MAX(month) AS m FROM city_index').m;
  const meta = Object.fromEntries(q('SELECT key, value FROM meta').map((r) => [r.key, r.value]));
  let lastRefresh = null;
  try { lastRefresh = meta.last_refresh ? JSON.parse(meta.last_refresh) : null; } catch { /* ignore */ }
  ok(res, { latestMonth: latest, ...meta, last_refresh: lastRefresh });
});

app.post('/api/refresh', async (req, res) => {
  if (refreshing) return res.status(409).json({ ok: false, error: '刷新正在进行中' });
  refreshing = true;
  try {
    const result = await refreshAll(db, (m) => console.log('[refresh]', m));
    ok(res, result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  } finally {
    refreshing = false;
  }
});

app.get('/api/cities', (req, res) => {
  const rows = q(`
    SELECT c.*, (SELECT COUNT(*) FROM communities cm WHERE cm.city_id = c.id) AS communityCount,
           EXISTS(SELECT 1 FROM city_level l WHERE l.city_id = c.id) AS hasLevel
    FROM cities c ORDER BY c.featured DESC, c.id`);
  ok(res, rows.map((r) => ({ ...cityRowToMeta(r), communityCount: r.communityCount, hasLevel: !!r.hasLevel })));
});

/* ---------- city index series ---------- */
// /api/series/cities?codes=beijing,shanghai&metric=sec_idx|new_idx|sec_mom|new_mom|sec_yoy|new_yoy&start=2015-01&end=2026-08
const METRICS = new Set(['new_idx', 'new_mom', 'new_yoy', 'sec_idx', 'sec_mom', 'sec_yoy']);
app.get('/api/series/cities', (req, res) => {
  const metric = METRICS.has(req.query.metric) ? req.query.metric : 'sec_idx';
  const codes = String(req.query.codes || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 80);
  if (!codes.length) {
    // no codes given -> all cities (for ranking views)
    codes.push(...q('SELECT code FROM cities WHERE in70 = 1 ORDER BY id').map((r) => r.code));
  }
  if (!codes.length) return ok(res, { cities: {} });
  const start = /^\d{4}-\d{2}$/.test(req.query.start || '') ? req.query.start : null;
  const end = /^\d{4}-\d{2}$/.test(req.query.end || '') ? req.query.end : null;
  const out = { cities: {} };
  for (const code of codes) {
    const city = cityByCode(code);
    if (!city) continue;
    const rows = q(
      `SELECT month, ${metric} AS v FROM city_index WHERE city_id = ? ${start ? 'AND month >= ?' : ''} ${end ? 'AND month <= ?' : ''} ORDER BY month`,
      city.id, ...(start ? [start] : []), ...(end ? [end] : [])
    );
    out.cities[code] = { name: city.name, months: rows.map((r) => r.month), values: rows.map((r) => r.v) };
  }
  ok(res, out);
});

// /api/series/aggregate?tier=一线&metric=sec_idx|all  -> equal-weight average of member cities
app.get('/api/series/aggregate', (req, res) => {
  const tier = req.query.tier === '二线' ? '二线' : '一线';
  const metric = req.query.metric === 'all' ? 'all' : (METRICS.has(req.query.metric) ? req.query.metric : 'sec_idx');
  const cols = metric === 'all' ? [...METRICS] : [metric];
  const selects = cols.map((c) => `AVG(ci.${c}) AS ${c}`).join(', ');
  const rows = q(
    `SELECT ci.month AS month, ${selects}
     FROM city_index ci JOIN cities c ON c.id = ci.city_id
     WHERE c.tier = ? GROUP BY ci.month ORDER BY ci.month`, tier
  );
  const out = { tier, months: rows.map((r) => r.month) };
  for (const c of cols) {
    out[c] = rows.map((r) => (r[c] == null ? null : +r[c].toFixed(2)));
  }
  ok(res, out);
});

/* ---------- city detail ---------- */
app.get('/api/city/:code', (req, res) => {
  const city = cityByCode(req.params.code);
  if (!city) return res.status(404).json({ ok: false, error: 'city not found' });
  const idx = q('SELECT * FROM city_index WHERE city_id = ? ORDER BY month', city.id);
  const lvl = q('SELECT month, price, mom, source FROM city_level WHERE city_id = ? ORDER BY month', city.id);
  const comms = q(
    `SELECT cm.id, cm.name, cm.district, cm.source,
            (SELECT price FROM community_price p WHERE p.cid = cm.id ORDER BY month DESC LIMIT 1) AS latest
     FROM communities cm WHERE cm.city_id = ? ORDER BY cm.name`, city.id
  );
  ok(res, {
    city: cityRowToMeta(city),
    index: {
      months: idx.map((r) => r.month),
      newIdx: idx.map((r) => r.new_idx), newMom: idx.map((r) => r.new_mom), newYoy: idx.map((r) => r.new_yoy),
      secIdx: idx.map((r) => r.sec_idx), secMom: idx.map((r) => r.sec_mom), secYoy: idx.map((r) => r.sec_yoy),
    },
    level: lvl,
    communities: comms,
  });
});

/* ---------- communities ---------- */
app.get('/api/communities', (req, res) => {
  const city = cityByCode(req.query.city);
  const kw = String(req.query.keyword || '').trim();
  const cond = [];
  const params = [];
  if (city) { cond.push('cm.city_id = ?'); params.push(city.id); }
  if (kw) { cond.push('(cm.name LIKE ? OR cm.district LIKE ?)'); params.push(`%${kw}%`, `%${kw}%`); }
  const rows = q(`
    SELECT cm.id, cm.name, cm.district, cm.source, cm.note,
           cm.built_year, cm.buildings, cm.households, cm.plot_ratio, cm.greening_rate,
           cm.property_fee, cm.listed_price, cm.listed_month, cm.anjuke_url,
           c.name AS cityName, c.code AS cityCode,
           (SELECT price FROM community_price p WHERE p.cid = cm.id ORDER BY month DESC LIMIT 1) AS latest,
           (SELECT month FROM community_price p WHERE p.cid = cm.id ORDER BY month DESC LIMIT 1) AS latestMonth,
           (SELECT COUNT(*) FROM community_price p WHERE p.cid = cm.id) AS points
    FROM communities cm JOIN cities c ON c.id = cm.city_id
    ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
    ORDER BY c.id, cm.name`, ...params);
  ok(res, rows);
});

app.get('/api/community/:id', (req, res) => {
  const row = get('SELECT cm.*, c.name AS cityName, c.code AS cityCode FROM communities cm JOIN cities c ON c.id = cm.city_id WHERE cm.id = ?', req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'not found' });
  const prices = q('SELECT month, price FROM community_price WHERE cid = ? ORDER BY month', row.id);
  const series = prices.map((r) => r.price);
  const peak = series.length ? Math.max(...series) : null;
  const last = series.length ? series[series.length - 1] : null;
  const peakIdx = series.indexOf(peak);
  const back = (n) => (series.length > n ? series[series.length - 1 - n] : null);
  const mom3 = back(3) ? +(((last / back(3)) - 1) * 100).toFixed(2) : null;
  const mom12 = back(12) ? +(((last / back(12)) - 1) * 100).toFixed(2) : null;
  ok(res, {
    id: row.id, name: row.name, district: row.district, source: row.source, note: row.note,
    cityName: row.cityName, cityCode: row.cityCode,
    built_year: row.built_year, buildings: row.buildings, households: row.households,
    plot_ratio: row.plot_ratio, greening_rate: row.greening_rate, property_fee: row.property_fee,
    listed_price: row.listed_price, listed_month: row.listed_month, anjuke_url: row.anjuke_url,
    months: prices.map((r) => r.month), prices: series,
    stats: { latest: last, latestMonth: prices.length ? prices[prices.length - 1].month : null, peak, peakMonth: peakIdx >= 0 ? prices[peakIdx].month : null, dropFromPeak: peak ? +(((last / peak) - 1) * 100).toFixed(2) : null, mom3, mom12 },
  });
});

app.get('/api/hot', (req, res) => {
  const city = cityByCode(req.query.city);
  if (!city) return res.status(400).json({ ok: false, error: 'city required' });
  const rows = q(
    `SELECT cm.id, cm.name, cm.district, cm.source FROM communities cm WHERE cm.city_id = ?`, city.id
  );
  const items = rows.map((cm) => {
    const prices = q('SELECT month, price FROM community_price WHERE cid = ? ORDER BY month', cm.id).map((r) => r.price);
    const n = prices.length;
    const mom3 = n > 3 ? +(((prices[n - 1] / prices[n - 4]) - 1) * 100).toFixed(2) : null;
    const mom12 = n > 12 ? +(((prices[n - 1] / prices[n - 13]) - 1) * 100).toFixed(2) : null;
    return { ...cm, latest: prices[n - 1], latestMonth: null, mom3, mom12 };
  });
  const rank = (key, dir) => items.filter((x) => x[key] != null).sort((a, b) => dir * (a[key] - b[key])).slice(0, 5);
  ok(res, {
    risers: rank('mom3', -1).filter((x) => x.mom3 > 0),
    fallers: rank('mom3', 1).filter((x) => x.mom3 < 0),
  });
});

/* ---------- CSV import ---------- */
function parseRows(text) {
  const rows = [];
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.trim();
    if (!line || /^(年月|month|date)/i.test(line)) continue;
    const cells = line.split(/[,，\t]/).map((s) => s.trim());
    const m = cells[0].match(/^(\d{4})[-/.年](\d{1,2})/);
    const price = parseFloat(String(cells[1]).replace(/[^\d.]/g, ''));
    if (m && Number.isFinite(price)) {
      rows.push({ ym: `${m[1]}-${String(m[2]).padStart(2, '0')}`, price });
    }
  }
  rows.sort((a, b) => a.ym.localeCompare(b.ym));
  return rows;
}

app.post('/api/import/community', (req, res) => {
  const { city, name, district, text, replace = true } = req.body || {};
  const c = cityByCode(city);
  if (!c) return res.status(400).json({ ok: false, error: '无效城市' });
  if (!name || !String(name).trim()) return res.status(400).json({ ok: false, error: '缺少小区名称' });
  const rows = parseRows(text);
  if (rows.length < 2) return res.status(400).json({ ok: false, error: '有效数据行不足（至少需要 2 行：年月,均价）' });
  let id = get('SELECT id FROM communities WHERE city_id = ? AND name = ?', c.id, String(name).trim())?.id;
  db.exec('BEGIN');
  try {
    if (id && replace) db.prepare('DELETE FROM community_price WHERE cid = ?').run(id);
    if (!id) {
      id = Number(db.prepare('INSERT INTO communities (name,city_id,district,source,note) VALUES (?,?,?,?,?)')
        .run(String(name).trim(), c.id, district ? String(district).trim() : null, 'user', '用户导入的真实数据').lastInsertRowid);
    } else {
      db.prepare('UPDATE communities SET source = ?, note = ?, district = COALESCE(?, district) WHERE id = ?')
        .run('user', '用户导入的真实数据', district ? String(district).trim() : null, id);
    }
    const ins = db.prepare('INSERT OR REPLACE INTO community_price VALUES (?,?,?)');
    for (const r of rows) ins.run(id, r.ym, r.price);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ ok: false, error: String(e) });
  }
  ok(res, { id, rows: rows.length, range: [rows[0].ym, rows[rows.length - 1].ym] });
});

app.post('/api/import/city-level', (req, res) => {
  const { city, text } = req.body || {};
  const c = cityByCode(city);
  if (!c) return res.status(400).json({ ok: false, error: '无效城市' });
  const rows = parseRows(text);
  if (rows.length < 2) return res.status(400).json({ ok: false, error: '有效数据行不足（至少需要 2 行：年月,均价）' });
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM city_level WHERE city_id = ?').run(c.id);
    const ins = db.prepare('INSERT OR REPLACE INTO city_level VALUES (?,?,?,?,?)');
    let prev = null;
    for (const r of rows) {
      const mom = prev ? +(((r.price / prev) - 1) * 100).toFixed(2) : null;
      ins.run(c.id, r.ym, r.price, mom, 'user');
      prev = r.price;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ ok: false, error: String(e) });
  }
  ok(res, { city: c.code, rows: rows.length, range: [rows[0].ym, rows[rows.length - 1].ym] });
});

/* ---------- community real detail (import or live fetch) ---------- */
// derived history: anchor to the city's official second-hand index shape (or its real
// listing-price series for cities outside the 70-city program), re-based so the latest
// point equals the community's real listed price.
function generateDerivedHistory(cityId, listedPrice, lastMonth) {
  let anchor = q('SELECT month, sec_idx AS v FROM city_index WHERE city_id = ? AND sec_idx IS NOT NULL ORDER BY month', cityId);
  if (anchor.length < 24) {
    anchor = q('SELECT month, price AS v FROM city_level WHERE city_id = ? ORDER BY month', cityId);
  }
  if (anchor.length < 12) return null;
  const last = anchor[anchor.length - 1];
  const base = last.v ? listedPrice / last.v : null;
  if (!base) return null;
  const end = lastMonth && /^\d{4}-\d{2}$/.test(lastMonth) && lastMonth > last.month ? lastMonth : last.month;
  const months = [];
  let [y, m] = anchor[0].month.split('-').map(Number);
  while (y < +end.slice(0, 4) || (y === +end.slice(0, 4) && m <= +end.slice(5, 7))) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  const byMonth = Object.fromEntries(anchor.map((r) => [r.month, r.v]));
  const prices = months.map((mm, i) => {
    const a = byMonth[mm];
    if (a == null) return null;
    return Math.round((base * a) / 10) * 10;
  });
  return { months, prices };
}

app.post('/api/import/community-detail', (req, res) => {
  const { city, name, district, built_year, buildings, households, plot_ratio, greening_rate, property_fee, listed_price, text } = req.body || {};
  const c = cityByCode(city);
  if (!c) return res.status(400).json({ ok: false, error: '无效城市' });
  if (!name || !String(name).trim()) return res.status(400).json({ ok: false, error: '缺少小区名称' });
  const rows = text ? parseRows(text) : [];
  let id;
  db.exec('BEGIN');
  try {
    id = get('SELECT id FROM communities WHERE city_id = ? AND name = ?', c.id, String(name).trim())?.id;
    if (!id) {
      id = Number(db.prepare('INSERT INTO communities (name,city_id,district,source,note) VALUES (?,?,?,?,?)')
        .run(String(name).trim(), c.id, district ? String(district).trim() : null, 'user', '用户导入的真实数据').lastInsertRowid);
    }
    db.prepare(`UPDATE communities SET
      district = COALESCE(?, district), built_year = ?, buildings = ?, households = ?,
      plot_ratio = ?, greening_rate = ?, property_fee = ?, listed_price = ?,
      listed_month = (SELECT MAX(month) FROM community_price WHERE cid = ?),
      note = '用户导入的真实数据' WHERE id = ?`)
      .run(
        district ? String(district).trim() : null,
        Number.isFinite(+built_year) && +built_year > 1900 ? +built_year : null,
        Number.isFinite(+buildings) && +buildings > 0 ? +buildings : null,
        Number.isFinite(+households) && +households > 0 ? +households : null,
        Number.isFinite(+plot_ratio) && +plot_ratio > 0 ? +plot_ratio : null,
        Number.isFinite(+greening_rate) && +greening_rate > 0 ? +greening_rate : null,
        property_fee ? String(property_fee).trim() : null,
        Number.isFinite(+listed_price) && +listed_price > 0 ? +listed_price : null,
        id, id
      );
    if (rows.length >= 2) {
      db.prepare('DELETE FROM community_price WHERE cid = ?').run(id);
      const ins = db.prepare('INSERT OR REPLACE INTO community_price VALUES (?,?,?)');
      for (const r of rows) ins.run(id, r.ym, r.price);
      db.prepare("UPDATE communities SET source = 'user', note = '用户导入的真实数据' WHERE id = ?").run(id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ ok: false, error: String(e) });
  }
  ok(res, { id, historyRows: rows.length });
});

const CITY_PY = { beijing: 'bj', shanghai: 'sh', shenzhen: 'sz', guangzhou: 'gz', xianning: 'xn', wuhan: 'wh', tianjin: 'tj', hangzhou: 'hz', nanjing: 'nj', chengdu: 'cd', chongqing: 'cq', xian: 'xa', zhengzhou: 'zz', changsha: 'cs', hefei: 'hf' };

app.post('/api/community/fetch-real', async (req, res) => {
  const { city, keyword } = req.body || {};
  const c = cityByCode(city);
  if (!c) return res.status(400).json({ ok: false, error: '无效城市' });
  if (!keyword || !String(keyword).trim()) return res.status(400).json({ ok: false, error: '请输入小区关键词' });
  const py = CITY_PY[c.code] || c.code;
  const r = await fetchCommunityReal(py, String(keyword).trim());
  if (!r.ok) return res.status(502).json({ ok: false, error: r.error, hint: r.hint, tried: r.tried });
  const f = r.fields;
  const name = (r.matched_name || f.name || String(keyword).trim()).replace(/\s*(房价|二手房|小区).*$/, '').trim() || String(keyword).trim();
  db.exec('BEGIN');
  let id;
  try {
    id = get('SELECT id FROM communities WHERE city_id = ? AND name = ?', c.id, name)?.id;
    if (!id) {
      id = Number(db.prepare('INSERT INTO communities (name,city_id,district,source,note) VALUES (?,?,?,?,?)')
        .run(name, c.id, null, 'anjuke-real', '小区详情与挂牌均价来自安居客（真实）；历史走势由官方指数形态推算').lastInsertRowid);
    } else {
      db.prepare('UPDATE communities SET source = ?, note = ? WHERE id = ?')
        .run('anjuke-real', '小区详情与挂牌均价来自安居客（真实）；历史走势由官方指数形态推算', id);
    }
    db.prepare('UPDATE communities SET built_year = COALESCE(?, built_year), buildings = COALESCE(?, buildings), households = COALESCE(?, households), plot_ratio = COALESCE(?, plot_ratio), greening_rate = COALESCE(?, greening_rate), property_fee = COALESCE(?, property_fee), listed_price = COALESCE(?, listed_price), anjuke_url = ? WHERE id = ?')
      .run(f.built_year, f.buildings, f.households, f.plot_ratio, f.greening_rate, f.property_fee, f.listed_price, r.url, id);
    if (f.listed_price) {
      const latestDb = get('SELECT MAX(month) AS m FROM city_index').m;
      const hist = generateDerivedHistory(c.id, f.listed_price, latestDb);
      if (hist) {
        db.prepare('DELETE FROM community_price WHERE cid = ?').run(id);
        const ins = db.prepare('INSERT OR REPLACE INTO community_price VALUES (?,?,?)');
        hist.months.forEach((mm, i) => { if (hist.prices[i] != null) ins.run(id, mm, hist.prices[i]); });
        db.prepare('UPDATE communities SET listed_month = ? WHERE id = ?').run(hist.months[hist.months.length - 1], id);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ ok: false, error: String(e) });
  }
  ok(res, { id, name, fields: f, url: r.url, via: r.via });
});

/* ---------- network diagnosis (which data paths work from this machine) ---------- */
app.get('/api/diag/network', async (req, res) => {
  const checks = [];
  const run = async (name, fn) => {
    const t0 = Date.now();
    try {
      checks.push({ name, ...(await fn()), ms: Date.now() - t0 });
    } catch (e) {
      checks.push({ name, ok: false, note: String(e.message || e), ms: Date.now() - t0 });
    }
  };
  await run('70城指数镜像（jsDelivr）', async () => {
    const r = await client.get(NBS_MIRRORS[0], { retries: 0, timeoutMs: 15000 });
    const ok = r.status === 200 && r.body.toString('utf8').includes('CommodityHouseIDX');
    return { ok, status: r.status, note: ok ? '可达' : '不可达或内容异常' };
  });
  await run('70城指数备用镜像（GitHub raw）', async () => {
    const r = await client.get(NBS_MIRRORS[1], { retries: 0, timeoutMs: 15000 });
    const ok = r.status === 200 && r.body.toString('utf8').includes('CommodityHouseIDX');
    return { ok, status: r.status, note: ok ? '可达' : '不可达（国内网络常见）' };
  });
  await run('安居客·城市房价页（深圳）', async () => {
    const r = await client.get('https://www.anjuke.com/fangjia/shenzhen/', {
      warmupUrl: 'https://www.anjuke.com/', retries: 0, timeoutMs: 18000, isBlocked: AJ_BLOCK,
    });
    const body = r.body.toString('utf8');
    const ok = r.status === 200 && /元\/㎡/.test(body) && !AJ_BLOCK(body);
    return { ok, status: r.status, note: ok ? '可达' : (r.status === 200 ? '被反爬拦截' : '不可达') };
  });
  await run('安居客·小区搜索', async () => {
    const r = await client.get('https://m.anjuke.com/bj/xiaoqu/?kw=test', { retries: 0, timeoutMs: 15000, isBlocked: AJ_BLOCK });
    const body = r.body.toString('utf8');
    const ok = r.status === 200 && !AJ_BLOCK(body);
    return { ok, status: r.status, note: ok ? '可达' : (r.status === 200 ? '被反爬拦截' : '不可达') };
  });
  ok(res, {
    checks,
    proxy: client.proxyUrl ? `已配置代理: ${client.proxyUrl}` : '未配置代理（可设 FETCH_PROXY_URL）',
    manualCookie: client.manualCookie ? '已配置 ANJUKE_COOKIE' : '未配置 ANJUKE_COOKIE',
  });
});

/* ---------- static frontend ---------- */
const DIST = path.join(ROOT, 'dist');
app.use(express.static(DIST));
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(DIST, 'index.html'));
  }
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`房价走势系统已启动: http://localhost:${PORT}`);
  if (process.env.REFRESH_ON_START !== '0') {
    setTimeout(() => {
      refreshAll(db, (m) => console.log('[refresh]', m)).catch((e) => console.log('[refresh] failed:', e.message));
    }, 2000);
  }
});
