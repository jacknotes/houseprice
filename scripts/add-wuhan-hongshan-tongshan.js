// 合并重复小区 + 新增武汉洪山/白沙洲与咸宁通山县小区（幂等，可重复执行）
// 用法: node scripts/add-wuhan-hongshan-tongshan.js
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const db = new DatabaseSync(path.join(ROOT, 'data', 'app.db'));

/* ---------- 1. 去重：紫微名庭(simulated) 合并进 紫薇茗庭(anjuke-real) ---------- */
const dupSim = db.prepare("SELECT id FROM communities WHERE name = '紫微名庭' AND source = 'simulated'").all();
const dupReal = db.prepare("SELECT id FROM communities WHERE name = '紫薇茗庭' AND source = 'anjuke-real'").all();
if (dupSim.length === 1 && dupReal.length === 1) {
  db.exec('BEGIN');
  db.prepare('DELETE FROM community_price WHERE cid = ?').run(dupSim[0].id);
  db.prepare('DELETE FROM communities WHERE id = ?').run(dupSim[0].id);
  db.exec('COMMIT');
  console.log(`dedupe: 删除模拟的“紫微名庭”(id ${dupSim[0].id})，保留真实的“紫薇茗庭”(id ${dupReal[0].id})`);
} else {
  console.log('dedupe: 未找到预期的 紫微名庭(simulated)/紫薇茗庭(anjuke-real) 组合，跳过（可能已合并）');
}

/* ---------- 2. 锚定曲线（与 build-seeds.js 同一套算法） ---------- */
const nbs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'processed', 'city_index.json'), 'utf8'));
const levels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'processed', 'city_level.json'), 'utf8'));

function anchorFromIndex(city) {
  const s = nbs[city];
  const out = { months: [], norm: [] };
  const base = s.secondIdx.find((v) => v != null);
  for (let i = 0; i < s.months.length; i++) {
    if (s.secondIdx[i] == null) continue;
    out.months.push(s.months[i]);
    out.norm.push(s.secondIdx[i] / base);
  }
  return out;
}
function anchorFromLevel(city) {
  const arr = levels[city];
  return { months: arr.map((r) => r.ym), norm: arr.map((r) => r.price / arr[0].price) };
}
function wobble(key, month, i) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const phase = (h % 628) / 100;
  const m = +month.slice(5, 7);
  const seasonal = 0.006 * Math.sin((m / 12) * Math.PI * 2 + phase);
  const drift = 0.004 * Math.sin(i * 0.35 + phase * 2);
  const noise = (((h ^ (i * 2654435761)) >>> 0) % 1000) / 100000 - 0.005;
  return 1 + seasonal + drift + noise;
}

/* [district, name, 当前挂牌价(≈2026, 元/㎡)] */
const WUHAN = [
  // 用户指定（洪山·万科广场/白沙洲一带）
  ['白沙洲', '万科城市之光', 17000],
  ['白沙洲', '万科光澜道', 17500],
  ['白沙洲', '龙湖天璞', 19000],
  ['白沙洲', '南国都市2期', 13500],
  ['白沙洲', '城际花园尚街', 14500],
  // 同片区补充
  ['白沙洲', '万科金色城市', 15500],
  ['白沙洲', '世茂林屿岸', 14000],
  ['白沙洲', '清能清江锦城', 16000],
  ['南湖', '保利心语', 18500],
  ['南湖', '金地格林小城', 19500],
  ['南湖', '名流人和天地', 15000],
];
const TONGSHAN = [
  // 用户指定（咸宁·通山县）
  ['通山县', '隆鼎丽都', 4800],
  ['通山县', '文博园', 4200],
  ['通山县', '井湾村', 3600],
  ['通山县', '水岸花园', 4200],
  ['通山县', '洋河金湾', 4500],
  ['通山县', '清华府', 5000],
  ['通山县', '迎宾新城', 3900],
  ['通山县', '凝香花都', 4300],
  ['通山县', '瑞华中央花园', 5200],
  ['通山县', '天下阳光花园', 4600],
  // 安居客通山县板块其它小区（名称来自 xianning.anjuke.com 通山县小区大全）
  ['通山县', '东都半岛', 5200],
  ['通山县', '嘉和城', 4700],
  ['通山县', '裕融城', 4500],
  ['通山县', '公务员小区', 4300],
  ['通山县', '金日花园', 4200],
  ['通山县', '金色花园', 4100],
  ['通山县', '山城明珠', 4400],
  ['通山县', '荣华园', 4000],
  ['通山县', '纸厂大院', 3600],
];

const wuhanAnchor = anchorFromIndex('武汉');
const xnAnchor = anchorFromLevel('咸宁');
const note = '模拟趋势：曲线形态锚定该城市官方指数/真实均价，绝对价格仅示意，可在“数据管理”导入真实数据替换';
const insComm = db.prepare('INSERT INTO communities (name,city_id,district,source,note) VALUES (?,?,?,?,?)');
const insPrice = db.prepare('INSERT OR REPLACE INTO community_price VALUES (?,?,?)');

function addBatch(cityCode, cityName, anchor, rows) {
  const city = db.prepare('SELECT id FROM cities WHERE code = ?').get(cityCode);
  if (!city) { console.error(`${cityName} not found`); return; }
  const normLast = anchor.norm[anchor.norm.length - 1];
  let added = 0, skipped = 0;
  db.exec('BEGIN');
  try {
    for (const [district, name, current] of rows) {
      const exists = db.prepare('SELECT id FROM communities WHERE city_id = ? AND name = ?').get(city.id, name);
      if (exists) { skipped++; continue; }
      const base = current / normLast;
      const prices = anchor.months.map((m, i) => Math.round((base * anchor.norm[i] * wobble(cityName + name, m, i)) / 10) * 10);
      const r = insComm.run(name, city.id, district, 'simulated', note);
      const cid = Number(r.lastInsertRowid);
      for (let i = 0; i < anchor.months.length; i++) insPrice.run(cid, anchor.months[i], prices[i]);
      added++;
      console.log(`added: ${cityName}·${district} ${name} (${prices[0]} → ${prices[prices.length - 1]} 元/㎡, ${prices.length} 个月)`);
    }
    db.exec('COMMIT');
    console.log(`${cityName}: added=${added}, skipped(exists)=${skipped}`);
  } catch (e) {
    db.exec('ROLLBACK');
    console.error(`${cityName} failed:`, e.message);
    process.exitCode = 1;
  }
}

addBatch('wuhan', '武汉', wuhanAnchor, WUHAN);
addBatch('xianning', '咸宁', xnAnchor, TONGSHAN);

const total = db.prepare('SELECT COUNT(*) c FROM communities').get().c;
console.log('total communities now:', total);
