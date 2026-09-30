// Incrementally add Songjiang/Jiading (Shanghai) communities to the LIVE database
// without reseeding (preserves any user-imported data). Idempotent: skips existing.
// Usage: node scripts/add-songjiang-jiading.js
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const db = new DatabaseSync(path.join(ROOT, 'data', 'app.db'));

// [district, name, currentPrice(≈2026-09, 元/㎡)]
const SEED = [
  ['松江', '泰晤士小镇', 31000], ['松江', '开元地中海', 34000], ['松江', '海德名园', 36000],
  ['松江', '莱顿小城', 42000], ['松江', '九城湖滨', 41000],
  ['嘉定', '龙湖郦城', 40000], ['嘉定', '安亭新镇', 30000], ['嘉定', '华润中央公园', 47000],
  ['嘉定', '金地格林世界', 44000],
  // 松江·泗泾 / 洞泾片区（动迁大居与新老小区）
  ['泗泾', '塘和家园顺康苑', 20000], ['泗泾', '塘和家园齐康苑', 20000], ['泗泾', '塘和家园久康苑', 20000],
  ['泗泾', '塘和家园君康苑', 20000], ['泗泾', '塘和家园德悦苑', 20000], ['泗泾', '塘和家园登云苑', 20000],
  ['泗泾', '塘和家园仁育苑', 19000], ['泗泾', '塘和家园海康苑', 21000], ['泗泾', '塘和家园桂花锦苑', 23500],
  ['洞泾', '塘和家园山茶雅苑', 21800],
  ['泗泾', '新凯家园钟秀苑', 20000], ['泗泾', '新凯家园枫景苑', 21000], ['泗泾', '新凯家园银杏苑', 23000],
  ['泗泾', '新凯家园玉兰苑', 22400], ['泗泾', '新凯家园香樟苑', 21500], ['泗泾', '新凯家园尚樱苑', 21000],
  ['泗泾', '新凯家园紫竹苑', 21000], ['泗泾', '新凯家园一期', 24000], ['泗泾', '新凯家园二期', 20000],
  ['泗泾', '金港花园一期', 25000], ['泗泾', '金港花园二期', 24500],
  ['泗泾', '泗泾新苑东区', 19000], ['泗泾', '泗泾新苑西区', 19000],
  ['泗泾', '玖龙湾', 26000], ['泗泾', '古楼新苑东区', 19000], ['泗泾', '古楼新苑西区', 19000],
  ['泗泾', '紫微名庭', 24000], ['泗泾', '同润山河小城', 29000],
  ['洞泾', '同润菲诗艾伦', 26000], ['老城', '方舟园', 21000],
];

// anchor: Shanghai second-hand chained index (same math as build-seeds.js)
const nbs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'processed', 'city_index.json'), 'utf8'));
const s = nbs['上海'];
const firstIdx = s.secondIdx.find((v) => v != null);
const anchor = { months: [], norm: [] };
for (let i = 0; i < s.months.length; i++) {
  if (s.secondIdx[i] == null) continue;
  anchor.months.push(s.months[i]);
  anchor.norm.push(s.secondIdx[i] / firstIdx);
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

const shanghai = db.prepare("SELECT id FROM cities WHERE code = 'shanghai'").get();
if (!shanghai) { console.error('上海 not found in cities'); process.exit(1); }
const note = '模拟趋势：曲线形态锚定上海官方指数，绝对价格仅示意，可在“数据管理”导入真实数据替换';
const insComm = db.prepare('INSERT INTO communities (name,city_id,district,source,note) VALUES (?,?,?,?,?)');
const insPrice = db.prepare('INSERT OR REPLACE INTO community_price VALUES (?,?,?)');
const normLast = anchor.norm[anchor.norm.length - 1];

let added = 0, skipped = 0;
db.exec('BEGIN');
try {
  for (const [district, name, current] of SEED) {
    const exists = db.prepare('SELECT id FROM communities WHERE city_id = ? AND name = ?').get(shanghai.id, name);
    if (exists) { skipped++; continue; }
    const base = current / normLast;
    const prices = anchor.months.map((m, i) => Math.round((base * anchor.norm[i] * wobble(name, m, i)) / 10) * 10);
    const r = insComm.run(name, shanghai.id, district, 'simulated', note);
    const cid = Number(r.lastInsertRowid);
    for (let i = 0; i < anchor.months.length; i++) insPrice.run(cid, anchor.months[i], prices[i]);
    added++;
    console.log(`added: ${district} · ${name} (${prices[0]} → ${prices[prices.length - 1]} 元/㎡, ${prices.length} 个月)`);
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('failed:', e.message);
  process.exit(1);
}
console.log(`done: added=${added}, skipped(exists)=${skipped}`);
