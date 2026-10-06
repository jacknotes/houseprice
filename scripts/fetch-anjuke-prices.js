// 安居客 模拟小区 -> 真实详情/挂牌均价 补真抓取器
// 目标: 6 城市(上海/武汉/北京/广州/深圳/咸宁) source='simulated' 的小区
// 链路: search /sale/rd1/?q=<name> -> community/view/<id> -> parseCommunityView -> 入库 anjuke-real + 重锚定
// 合规: 复用 server/http-client(暖场Cookie/限速/退避)；被反爬拦截时立即优雅退出等下一轮，绝不绕过
// 会话: 若 data/raw/anjuke-cookie.txt 存在，包装脚本会以 ANJUKE_COOKIE 注入（用户浏览器过一次验证后的 Cookie）
// 用法: node scripts/fetch-anjuke-prices.js run|status
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { createClient } = require('../server/http-client');
const { parseCommunityView } = require('../server/parsers');
const client = createClient();
// 与 refresh.js 同款的安居客拦截判定：反爬页特征 或 响应体过小
const AJ_BLOCK = (body) => /antibot|verifycode|xxzlGateway|callback\.58\.com/.test(String(body)) || String(body).length < 2000;

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const STATE_FILE = path.join(RAW, 'anjuke-state.json');
const COOKIE_FILE = path.join(RAW, 'anjuke-cookie.txt');
const RUN_CAP = 10;              // 每轮最多处理的小区数（约 20 个请求）
const PACING_MS = 3200;

const CITIES = [
  { code: 'shanghai', name: '上海', host: 'shanghai' },
  { code: 'wuhan', name: '武汉', host: 'wuhan' },
  { code: 'beijing', name: '北京', host: 'beijing' },
  { code: 'guangzhou', name: '广州', host: 'guangzhou' },
  { code: 'shenzhen', name: '深圳', host: 'shenzhen' },
  { code: 'xianning', name: '咸宁', host: 'xianning' },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const saveJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); };

function targets() {
  const db = new DatabaseSync(path.join(ROOT, 'data', 'app.db'), { readOnly: true });
  const out = [];
  for (const c of CITIES) {
    const city = db.prepare('SELECT id FROM cities WHERE code=?').get(c.code);
    if (!city) continue;
    for (const t of db.prepare("SELECT id, name FROM communities WHERE city_id=? AND source='simulated' ORDER BY id").all(city.id)) {
      out.push({ ...t, city: c });
    }
  }
  return out;
}

async function run() {
  const state = readJson(STATE_FILE, { done: {} });
  const list = targets().filter((t) => !state.done[`${t.city.code}:${t.name}`]);
  const total = targets().length;
  if (list.length === 0) { console.log('anjuke: all targets resolved'); return; }
  console.log(`anjuke: ${total - list.length}/${total} resolved, ${list.length} pending this session`);
  let processed = 0, harvested = 0;
  for (const t of list) {
    if (processed >= RUN_CAP) break;
    const host = `${t.city.host}.anjuke.com`;
    const key = `${t.city.code}:${t.name}`;
    try {
      // 1) 搜索页 -> view id
      const sr = await client.get(`https://${host}/sale/rd1/?q=${encodeURIComponent(t.name)}`, {
        warmupUrl: `https://${host}/`,
        isBlocked: AJ_BLOCK,
      });
      if (!sr.status || sr.err) { console.log('network error —— 本轮结束，等下一轮'); return; }
      const sBody = sr.body.toString('utf8');
      if (AJ_BLOCK(sBody)) { console.log('anjuke-blocked: 搜索页被人机校验拦截 —— 本轮结束，等下一轮'); return; }
      const link = sBody.match(/(?:https?:)?\/\/[a-z]+\.anjuke\.com\/community\/view\/(\d+)/);
      if (!link) {
        state.done[key] = 'no-match';
        saveJson(STATE_FILE, state);
        console.log(`no-match ${t.city.name} ${t.name}`);
        processed++;
        continue;
      }
      await sleep(PACING_MS);
      // 2) view 详情 -> 解析
      const vr = await client.get(`https://${host}/community/view/${link[1]}`, {
        referer: `https://${host}/sale/rd1/`,
        isBlocked: AJ_BLOCK,
      });
      if (!vr.status || vr.err) { console.log('network error —— 本轮结束，等下一轮'); return; }
      const vBody = vr.body.toString('utf8');
      if (AJ_BLOCK(vBody)) { console.log('anjuke-blocked: 详情页被人机校验拦截 —— 本轮结束，等下一轮'); return; }
      const f = parseCommunityView(vBody);
      if (!f.listed_price) {
        state.done[key] = 'no-match';
        saveJson(STATE_FILE, state);
        console.log(`no-price ${t.city.name} ${t.name} (view ${link[1]})`);
        processed++;
        continue;
      }
      // 3) 入库 + 重锚定
      const wdb = new DatabaseSync(path.join(ROOT, 'data', 'app.db'));
      const city = wdb.prepare('SELECT id FROM cities WHERE code=?').get(t.city.code);
      const row = wdb.prepare('SELECT id FROM communities WHERE city_id=? AND name=?').get(city.id, t.name);
      wdb.prepare(`UPDATE communities SET built_year=COALESCE(?,built_year), ownership_type=COALESCE(?,ownership_type),
        property_years=COALESCE(?,property_years), households=COALESCE(?,households), property_fee=COALESCE(?,property_fee),
        greening_rate=COALESCE(?,greening_rate), plot_ratio=COALESCE(?,plot_ratio), listed_price=?, listed_month=?,
        anjuke_url=?, source='anjuke-real',
        note='详情与挂牌均价来自安居客（真实）；历史走势为官方指数形态推算' WHERE id=?`)
        .run(f.built_year_raw, f.ownership_type, f.property_years, f.households || null,
          f.property_fee, f.greening_rate, f.plot_ratio, f.listed_price, f.listed_month,
          `https://${host}/community/view/${link[1]}`, row.id);
      const prices = wdb.prepare('SELECT month, price FROM community_price WHERE cid=? ORDER BY month').all(row.id);
      if (prices.length) {
        const last = prices[prices.length - 1].price;
        if (last > 0) {
          const k = f.listed_price / last;
          const upd = wdb.prepare('UPDATE community_price SET price = ROUND(price * ?, 0) WHERE cid=? AND month=?');
          for (const p of prices) upd.run(k, row.id, p.month);
        }
      }
      state.done[key] = 'done';
      saveJson(STATE_FILE, state);
      harvested++;
      processed++;
      console.log(`OK ${t.city.name} ${t.name}: ${f.listed_price} 元/㎡ (${f.listed_month || '?'})`);
      wdb.close();
    } catch (e) {
      if (/blocked|antibot|verifycode/i.test(e.message)) {
        console.log(`anjuke-blocked: ${e.message.slice(0, 80)} —— 本轮结束，等下一轮`);
        saveJson(STATE_FILE, state);
        return;
      }
      console.log(`ERR ${t.city.name} ${t.name}: ${e.message.slice(0, 100)}`);
      processed++;
    }
    await sleep(PACING_MS);
  }
  console.log(`anjuke run done: harvested=${harvested}, resolved=${Object.keys(state.done).length}/${total}`);
}

function status() {
  const state = readJson(STATE_FILE, { done: {} });
  // 按目标逐一判定，而非键数量差——done 里可能含已转 fang-real 的陈旧键
  const list = targets().filter((t) => !state.done[`${t.city.code}:${t.name}`]);
  console.log(list.length === 0 ? 'complete' : `pending (${list.length} left)`);
}
const cmd = process.argv[2] || 'run';
if (cmd === 'run') run().catch((e) => { console.error(e); process.exit(1); });
else if (cmd === 'status') status();
else { console.error('usage: node scripts/fetch-anjuke-prices.js run|status'); process.exit(1); }
