// 房天下(esf.fang.com) 模拟小区 -> 真实挂牌均价 补真抓取器
// 目标: 将 5 城市(上海/武汉/北京/广州/深圳)中 source='simulated' 的小区升级为 fang-real
//      咸宁(通山)被房天下与安居客双侧人机校验拦截，保持锚定安居客均价的模拟曲线，不在本脚本范围
// 合规边界: 只读公开列表/详情页；低频(2.2-3.4s/请求)、每轮限量、遇滑块验证自动退避等待，绝不绕过
// 阶段(全部断点续跑):
//   discover : 按字母索引分页收集 小区名->loupan链接，进度存 fang-state.json
//   fetch    : 精确/同项目模糊匹配后抓“参考均价”，结果存 fang-report.json（ok 的缓存复用）
//   apply    : 入库 source='fang-real' + listed_price + 历史曲线按真实价重锚定
// 用法: node scripts/fetch-fang-prices.js discover|fetch|apply
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const LINKS_FILE = path.join(RAW, 'fang-links.json');
const REPORT_FILE = path.join(RAW, 'fang-report.json');
const STATE_FILE = path.join(RAW, 'fang-state.json');

const CITIES = [
  { code: 'shanghai', name: '上海', host: 'sh' },
  { code: 'wuhan', name: '武汉', host: 'wuhan' },
  { code: 'beijing', name: '北京', host: 'bj' },
  { code: 'guangzhou', name: '广州', host: 'gz' },
  { code: 'shenzhen', name: '深圳', host: 'sz' },
];
const LETTERS_ALL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
// 拼音首字母表：覆盖库内全部模拟小区首字（缺失的字会打日志并被跳过）
const PY = {
  泰:'T',开:'K',海:'H',莱:'L',九:'J',三:'S',仁:'R',世:'S',上:'S',大:'D',田:'T',古:'G',保:'B',耀:'Y',
  塘:'T',新:'X',金:'J',泗:'S',玖:'J',同:'T',方:'F',龙:'L',安:'A',华:'H',丰:'F',望:'W',北:'B',中:'Z',
  芳:'F',京:'J',和:'H',猎:'L',骏:'J',光:'G',祈:'Q',岭:'L',时:'S',科:'K',半:'B',蔚:'W',长:'C',水:'S',
  幸:'X',桂:'G',万:'W',百:'B',前:'Q',南:'N',城:'C',清:'Q',名:'M',隆:'L',文:'W',井:'J',洋:'Y',迎:'Y',
  凝:'N',瑞:'R',天:'T',东:'D',嘉:'J',裕:'Y',公:'G',色:'J',山:'S',荣:'R',纸:'Z',粤:'Y',汇:'H',咸:'X',御:'Y',淦:'G',
};
const DISCOVER_MAX_PAGES = 30;   // 每轮最多抓的索引页数（限速下约 2 分钟）
const FETCH_MAX = 12;            // 每轮最多抓的详情页数

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, dflt) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : dflt);
const saveJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); };

async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', Accept: 'text/html,*/*' },
    redirect: 'manual',
  });
  const loc = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && loc) {
    if (String(loc).includes('check.html')) throw new Error('blocked-by-slider-captcha');
    return get(loc.startsWith('http') ? loc : new URL(loc, url).href);
  }
  return { status: res.status, text: await res.text() };
}
async function getSlow(url) { const r = await get(url); await sleep(2200 + Math.random() * 1200); return r; }

function simulatedByCity() {
  const db = new DatabaseSync(path.join(ROOT, 'data', 'app.db'), { readOnly: true });
  const out = {};
  for (const c of CITIES) {
    const row = db.prepare('SELECT id FROM cities WHERE code=?').get(c.code);
    if (!row) continue;
    // 含 fang-real：已抓到的价格留在目标池里靠 ok 缓存跳过，保证报告计数稳定、不重复入库
    out[c.code] = db.prepare("SELECT id, name FROM communities WHERE city_id=? AND source IN ('simulated','fang-real') ORDER BY id").all(row.id);
  }
  return out;
}

function letterOf(name) {
  const ch = name[0];
  if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase();
  if (PY[ch]) return PY[ch];
  console.log(`  !! 拼音表缺字: ${name} 首字「${ch}」，请补充 PY 表`);
  return null;
}

/* ---------- discover ---------- */
async function discover() {
  const state = readJson(STATE_FILE, { discover: {} });
  const sim = simulatedByCity();
  let pagesFetched = 0;
  for (const c of CITIES) {
    const targets = sim[c.code] || [];
    const letters = [...new Set(targets.map((t) => letterOf(t.name)).filter(Boolean))].sort();
    const idxFile = path.join(RAW, `fang-index-${c.code}.json`);
    const index = readJson(idxFile, {});
    const st = (state.discover[c.code] = state.discover[c.code] || {});
    for (const L of letters) {
      if (pagesFetched >= DISCOVER_MAX_PAGES) { saveJson(STATE_FILE, state); console.log('reach page cap, will continue next run'); return; }
      if (st[L] === 'done') continue;
      let page = st[L] && st[L].page || 1;
      let total = st[L] && st[L].total || 1;
      while (page <= total) {
        if (pagesFetched >= DISCOVER_MAX_PAGES) { st[L] = { page, total }; saveJson(STATE_FILE, state); console.log('reach page cap, will continue next run'); return; }
        const url = page === 1 ? `https://${c.host}.esf.fang.com/housing/letter_${L}.htm` : `https://${c.host}.esf.fang.com/housing/letter_${L}_${page}.htm`;
        try {
          const { text } = await getSlow(url);
          const tp = text.match(/共(\d+)页/);
          if (tp) total = Math.min(Number(tp[1]), 30);
          const re = /<a[^>]+title="([^"]{2,40})"[^>]+href='([^']*\/loupan\/\d+\.htm)'[^>]*>/g;
          let m, added = 0;
          while ((m = re.exec(text))) {
            const title = m[1].trim();
            const urlAbs = m[2].startsWith('//') ? 'https:' + m[2] : m[2].startsWith('http') ? m[2] : `https://${c.host}.esf.fang.com` + m[2];
            if (!index[title]) { index[title] = urlAbs; added++; }
          }
          console.log(`[${c.name} ${L} p${page}/${total}] entries+${added}, index=${Object.keys(index).length}`);
          pagesFetched++;
          page++;
        } catch (e) {
          console.log(`[${c.name} ${L} p${page}] ${e.message} —— 退避 90s 后结束本轮`);
          st[L] = { page, total };
          saveJson(STATE_FILE, state);
          return;
        }
      }
      st[L] = 'done';
      saveJson(STATE_FILE, state);
      saveJson(idxFile, index);
    }
    saveJson(idxFile, index);
  }
  saveJson(STATE_FILE, state);
  console.log('discover: 本轮完成');
}

/* ---------- fetch ---------- */
async function fetchPrices() {
  const sim = simulatedByCity();
  const report = readJson(REPORT_FILE, []);
  // 兼容旧格式：早期报告只有武汉且无 city 字段
  const norm = report.map((r) => ({ ...r, city: r.city || 'wuhan' }));
  const prevOk = new Map(norm.filter((r) => r.status === 'ok').map((r) => [`${r.city}:${r.name}`, r]));
  const out = [];
  const known = new Map(norm.map((r) => [`${r.city}:${r.name}`, r]));
  let fetched = 0;
  for (const c of CITIES) {
    const idxFile = path.join(RAW, `fang-index-${c.code}.json`);
    const index = readJson(idxFile, {});
    for (const t of (sim[c.code] || [])) {
      const key = `${c.code}:${t.name}`;
      if (prevOk.has(key)) { out.push(prevOk.get(key)); continue; }
      const prev = known.get(key);
      let link = index[t.name];
      let proxy = null;
      if (!link) {
        // 同项目模糊匹配：排除别墅/写字楼/商铺等不同产品形态，优先最短名（最接近本体）
        const base = t.name;
        const cand = Object.entries(index)
          .filter(([title]) => title.includes(base) || base.includes(title))
          .filter(([title]) => !/别墅|写字楼|商铺|SOHO|公寓|车位|车库/.test(title))
          .sort((a, b) => a[0].length - b[0].length);
        if (cand.length) { link = cand[0][1]; proxy = cand[0][0]; }
      }
      if (!link) {
        // 尚未发现：discover 没扫完则 pending；扫完仍无可接受候选(含被产品形态过滤) => 终态 no-match
        const st = readJson(STATE_FILE, { discover: {} });
        const letters = [...new Set((sim[c.code] || []).map((x) => letterOf(x.name)).filter(Boolean))];
        const done = letters.length > 0 && letters.every((L) => st.discover[c.code] && st.discover[c.code][L] === 'done');
        out.push(prev && (prev.status === 'no-link' || prev.status === 'no-match' || prev.status === 'rejected') && done
          ? prev
          : { city: c.code, name: t.name, status: done ? 'no-match' : 'pending', simulatedNow: lastPrice(db0(), t.id) });
        continue;
      }
      if (fetched >= FETCH_MAX) { out.push(prev || { city: c.code, name: t.name, status: 'pending', link }); continue; }
      try {
        const { text } = await getSlow(link);
        const body = text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        const pm = body.match(/(\d{1,2})月参考均价\s*(\d{4,6})\s*元\/㎡/);
        const mm = body.match(/环比上月\s*([↑↓])\s*([\d.]+)%/);
        if (!pm) { out.push({ city: c.code, name: t.name, status: 'no-price', url: link }); console.log(`NO-PRICE ${c.name} ${t.name}`); fetched++; continue; }
        const month = `${new Date().getFullYear()}-${pm[1].padStart(2, '0')}`;
        const price = Number(pm[2]);
        const mom = mm ? (mm[1] === '↓' ? -1 : 1) * Number(mm[2]) : null;
        const simNow = lastPrice(db0(), t.id);
        const delta = simNow ? Math.round((price / simNow - 1) * 1000) / 10 : null;
        out.push({ city: c.code, name: t.name, status: 'ok', url: link, proxy, month, price, mom, simulatedNow: simNow, deltaPct: delta });
        console.log(`OK ${c.name} ${t.name}${proxy ? ` (同项目:${proxy})` : ''}: ${price} 元/㎡ (${month}), 模拟末值 ${simNow} (${delta > 0 ? '+' : ''}${delta}%)`);
        fetched++;
      } catch (e) {
        out.push(prev || { city: c.code, name: t.name, status: 'error', url: link, error: e.message });
        console.log(`ERR ${c.name} ${t.name}: ${e.message}`);
      }
    }
  }
  saveJson(REPORT_FILE, out);
  const ok = out.filter((r) => r.status === 'ok').length;
  console.log(`\nreport: ok=${ok}/${out.length}, saved -> ${REPORT_FILE}`);
}
// 延迟打开只读连接，避免与 apply 阶段写锁冲突
let _ro = null;
function db0() { if (!_ro) _ro = new DatabaseSync(path.join(ROOT, 'data', 'app.db'), { readOnly: true }); return _ro; }
function lastPrice(db, cid) {
  const r = db.prepare('SELECT price FROM community_price WHERE cid=? ORDER BY month DESC LIMIT 1').get(cid);
  return r ? r.price : null;
}

/* ---------- apply ---------- */
async function apply() {
  const report = readJson(REPORT_FILE, []);
  const db = new DatabaseSync(path.join(ROOT, 'data', 'app.db'));
  let n = 0;
  for (const r of report) {
    if (r.status !== 'ok' || !r.price) continue;
    const city = CITIES.find((c) => c.code === r.city);
    const row = db.prepare('SELECT id FROM communities WHERE city_id=(SELECT id FROM cities WHERE code=?) AND name=?').get(r.city, r.name);
    if (!row) continue;
    db.exec('BEGIN');
    try {
      const proxyNote = r.proxy ? `（同项目「${r.proxy}」参考）` : '';
      db.prepare(`UPDATE communities SET listed_price=?, listed_month=?, source='fang-real',
        note='挂牌均价来自房天下（真实，' || ? || '）' || ? || '；历史走势为官方指数形态推算。来源: ' || ?
        WHERE id=?`).run(r.price, r.month, r.month, proxyNote, r.url, row.id);
      const prices = db.prepare('SELECT month, price FROM community_price WHERE cid=? ORDER BY month').all(row.id);
      if (prices.length) {
        const last = prices[prices.length - 1].price;
        if (last > 0) {
          const k = r.price / last;
          const upd = db.prepare('UPDATE community_price SET price = ROUND(price * ?, 0) WHERE cid=? AND month=?');
          for (const p of prices) upd.run(k, row.id, p.month);
        }
      }
      db.exec('COMMIT');
      n++;
      console.log(`applied ${r.name}: ${r.price} 元/㎡ (${r.month})`);
    } catch (e) {
      db.exec('ROLLBACK');
      console.error(`apply failed ${r.name}:`, e.message);
    }
  }
  console.log(`applied ${n}`);
}

/* ---------- status: complete | pending ---------- */
async function status() {
  const state = readJson(STATE_FILE, { discover: {} });
  const sim = simulatedByCity();
  const report = readJson(REPORT_FILE, []);
  const okKeys = new Set(report.filter((r) => r.status === 'ok').map((r) => `${r.city}:${r.name}`));
  for (const c of CITIES) {
    const letters = [...new Set((sim[c.code] || []).map((t) => letterOf(t.name)).filter(Boolean))];
    for (const L of letters) {
      if (state.discover[c.code] === 'done') continue;
      if (state.discover[c.code] && state.discover[c.code][L] === 'done') continue;
      // 索引可能已能覆盖全部目标（大城部分字母就够了）
      const index = readJson(path.join(RAW, `fang-index-${c.code}.json`), {});
      const missing = (sim[c.code] || []).filter((t) => {
        if (okKeys.has(`${c.code}:${t.name}`)) return false;
        const base = t.name;
        return !index[t.name] && !Object.keys(index).some((title) =>
          (title.includes(base) || base.includes(title)) && !/别墅|写字楼|商铺|SOHO|公寓|车位|车库/.test(title));
      });
      if (missing.length > 0) return console.log('pending');
    }
  }
  const unresolved = report.filter((r) => r.status === 'pending' || r.status === 'error');
  if (unresolved.length > 0) return console.log('pending');
  console.log('complete');
}

async function main() {
  const cmd = process.argv[2] || 'discover';
  fs.mkdirSync(RAW, { recursive: true });
  if (cmd === 'discover') return discover();
  if (cmd === 'fetch') return fetchPrices();
  if (cmd === 'apply') return apply();
  if (cmd === 'status') return status();
  console.error('usage: node scripts/fetch-fang-prices.js discover|fetch|apply|status');
  process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
