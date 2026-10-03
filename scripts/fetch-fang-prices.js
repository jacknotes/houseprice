// 房天下(esf.fang.com) 小区均价抓取器 —— 将模拟示例升级为真实挂牌均价
// 目标: 武汉 11 个小区（咸宁/通山的房天下与安居客页面均有人机校验，暂保持锚定安居客均价的模拟曲线）
// 阶段:
//   discover : 抓字母索引页，精确匹配小区名 -> loupan 页 URL（存 data/raw/fang-links.json）
//   fetch    : 抓 loupan 页解析“参考均价/环比”，生成对比报告（存 data/raw/fang-report.json）
//   apply    : 按报告写入 listed_price/listed_month/source='fang-real' 并按真实价重锚定历史曲线
// 用法: node scripts/fetch-fang-prices.js discover|fetch|apply
// 限速: 每请求间隔 ~2.5s，只读公开列表/详情页；若出现 check.html 滑块验证则中止（不做绕过）
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const LINKS_FILE = path.join(RAW, 'fang-links.json');
const REPORT_FILE = path.join(RAW, 'fang-report.json');

// 武汉目标小区（exact name in DB）
const WUHAN_NAMES = [
  '万科城市之光', '万科光澜道', '龙湖天璞', '南国都市2期', '城际花园尚街',
  '万科金色城市', '世茂林屿岸', '清能清江锦城', '保利心语', '金地格林小城', '名流人和天地',
];
const LETTERS = ['B', 'C', 'J', 'L', 'M', 'N', 'Q', 'S', 'W'];
const BASE = 'https://wuhan.esf.fang.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

async function discover() {
  const links = {};
  const allEntries = {};
  for (const L of LETTERS) {
    let page = 1, total = 1;
    while (page <= total) {
      const url = page === 1 ? `${BASE}/housing/letter_${L}.htm` : `${BASE}/housing/letter_${L}_${page}.htm`;
      try {
        const { text } = await getSlow(url);
        const tp = text.match(/共(\d+)页/);
        total = tp ? Math.min(Number(tp[1]), 20) : 1;
        const re = /<a[^>]+title="([^"]{2,30})"[^>]+href='([^']*\/loupan\/\d+\.htm)'[^>]*>/g;
        let m;
        while ((m = re.exec(text))) {
          const title = m[1].trim();
          const urlAbs = m[2].startsWith('//') ? 'https:' + m[2] : m[2].startsWith('http') ? m[2] : BASE + m[2];
          if (!allEntries[title]) allEntries[title] = urlAbs;
          if (WUHAN_NAMES.includes(title) && !links[title]) {
            links[title] = urlAbs;
            console.log(`FOUND ${title} -> ${urlAbs}`);
          }
        }
        console.log(`letter_${L} p${page}/${total}: cumulative ${Object.keys(allEntries).length} entries`);
      } catch (e) {
        console.log(`letter_${L} p${page}: ${e.message}`);
        break;
      }
      page++;
    }
  }
  // 模糊候选：目标名与索引名互相包含（处理「南国都市2期」vs「南国都市」这类别名）
  for (const target of WUHAN_NAMES) {
    if (links[target]) continue;
    const base = target.replace(/[/·]/g, '');
    for (const [title, url] of Object.entries(allEntries)) {
      const t2 = title.replace(/[/·]/g, '');
      if (t2.includes(base) || base.includes(t2)) {
        console.log(`FUZZY ${target} ~ "${title}" -> ${url}`);
        break;
      }
    }
  }
  fs.writeFileSync(LINKS_FILE, JSON.stringify(links, null, 1));
  fs.writeFileSync(path.join(RAW, 'fang-index-all.json'), JSON.stringify(allEntries, null, 1));
  const missing = WUHAN_NAMES.filter((n) => !links[n]);
  console.log(`\ndiscovered ${Object.keys(links).length}/${WUHAN_NAMES.length}; missing: ${missing.join(', ') || 'none'}`);
}

async function fetchPrices() {
  const links = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
  const prev = fs.existsSync(REPORT_FILE) ? JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')) : [];
  const prevOk = new Map(prev.filter((r) => r.status === 'ok').map((r) => [r.name, r]));
  const db = new DatabaseSync(path.join(ROOT, 'data', 'app.db'), { readOnly: true });
  const wh = db.prepare("SELECT id FROM cities WHERE code='wuhan'").get();
  const report = [];
  for (const name of WUHAN_NAMES) {
    const url = links[name];
    const row = db.prepare('SELECT id FROM communities WHERE city_id=? AND name=?').get(wh.id, name);
    let simNow = null;
    if (row) {
      const last = db.prepare('SELECT price FROM community_price WHERE cid=? ORDER BY month DESC LIMIT 1').get(row.id);
      simNow = last ? last.price : null;
    }
    if (prevOk.has(name)) {
      const r = prevOk.get(name);
      r.simulatedNow = simNow;
      r.deltaPct = simNow ? Math.round((r.price / simNow - 1) * 1000) / 10 : null;
      report.push(r);
      console.log(`KEEP ${name}: ${r.price} 元/㎡ (cached ok)`);
      continue;
    }
    if (!url) {
      report.push({ name, status: 'no-link', simulatedNow: simNow });
      console.log(`SKIP ${name}: no link`);
      continue;
    }
    try {
      const { text } = await getSlow(url);
      const body = text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const pm = body.match(/(\d{1,2})月参考均价\s*(\d{4,6})\s*元\/㎡/);
      const mm = body.match(/环比上月\s*([↑↓])\s*([\d.]+)%/);
      if (!pm) {
        report.push({ name, status: 'no-price', url });
        console.log(`NO-PRICE ${name} (${url})`);
        continue;
      }
      const month = `${new Date().getFullYear()}-${pm[1].padStart(2, '0')}`;
      const price = Number(pm[2]);
      const mom = mm ? (mm[1] === '↓' ? -1 : 1) * Number(mm[2]) : null;
      const delta = simNow ? Math.round((price / simNow - 1) * 1000) / 10 : null;
      report.push({ name, status: 'ok', url, month, price, mom, simulatedNow: simNow, deltaPct: delta });
      console.log(`OK ${name}: ${price} 元/㎡ (${month}), 环比 ${mom}%, 模拟末值 ${simNow} (${delta > 0 ? '+' : ''}${delta}%)`);
    } catch (e) {
      report.push({ name, status: 'error', url, error: e.message });
      console.log(`ERR ${name}: ${e.message}`);
    }
  }
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 1));
  console.log(`\nreport saved -> ${REPORT_FILE}`);
}

async function apply() {
  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
  const db = new DatabaseSync(path.join(ROOT, 'data', 'app.db'));
  const wh = db.prepare("SELECT id FROM cities WHERE code='wuhan'").get();
  let n = 0;
  for (const r of report) {
    if (r.status !== 'ok' || !r.price) continue;
    const row = db.prepare('SELECT id FROM communities WHERE city_id=? AND name=?').get(wh.id, r.name);
    if (!row) continue;
    db.exec('BEGIN');
    try {
      db.prepare(`UPDATE communities SET listed_price=?, listed_month=?, source='fang-real',
        note='挂牌均价来自房天下（真实，' || ? || '）；历史走势为官方指数形态推算。来源: ' || ?
        WHERE id=?`).run(r.price, r.month, r.month, r.url, row.id);
      // re-anchor history so the last point equals the real price
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
      console.log(`applied ${r.name}: ${r.price} 元/㎡ (${r.month}), curve re-anchored`);
    } catch (e) {
      db.exec('ROLLBACK');
      console.error(`apply failed ${r.name}:`, e.message);
    }
  }
  console.log(`applied ${n} communities`);
}

async function main() {
  const cmd = process.argv[2] || 'discover';
  fs.mkdirSync(RAW, { recursive: true });
  if (cmd === 'discover') return discover();
  if (cmd === 'fetch') return fetchPrices();
  if (cmd === 'apply') return apply();
  console.error('usage: node scripts/fetch-fang-prices.js discover|fetch|apply');
  process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
