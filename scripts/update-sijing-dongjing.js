// Update Sijing/Dongjing communities per user feedback:
//  - rename 顺康苑/齐康苑 to 塘和家园顺康苑/塘和家园齐康苑 (keep ids & prices)
//  - drop the standalone 塘和家园 / 新凯家园 placeholder entries (superseded by the full 苑 list)
//  - fix 同润山河小城 district: 新桥 -> 泗泾
//  - insert the full 塘和家园 / 新凯家园(新凯城) 苑 list + 金港花园一期/二期, 泗泾新苑东/西区, 玖龙湾, 古楼新苑东/西区
// Idempotent. Usage: node scripts/update-sijing-dongjing.js
'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const db = new DatabaseSync(path.join(ROOT, 'data', 'app.db'));
const shanghai = db.prepare("SELECT id FROM cities WHERE code = 'shanghai'").get();
const note = '模拟趋势：曲线形态锚定上海官方指数，绝对价格仅示意，可在“数据管理”导入真实数据替换';

// [district, name, currentPrice(≈2026-09, 元/㎡)]
const NEW = [
  ['泗泾', '塘和家园久康苑', 20000], ['泗泾', '塘和家园君康苑', 20000], ['泗泾', '塘和家园德悦苑', 20000],
  ['泗泾', '塘和家园登云苑', 20000], ['泗泾', '塘和家园仁育苑', 19000], ['泗泾', '塘和家园海康苑', 21000],
  ['泗泾', '塘和家园桂花锦苑', 23500], ['洞泾', '塘和家园山茶雅苑', 21800],
  ['泗泾', '新凯家园钟秀苑', 20000], ['泗泾', '新凯家园枫景苑', 21000], ['泗泾', '新凯家园银杏苑', 23000],
  ['泗泾', '新凯家园玉兰苑', 22400], ['泗泾', '新凯家园香樟苑', 21500], ['泗泾', '新凯家园尚樱苑', 21000],
  ['泗泾', '新凯家园紫竹苑', 21000], ['泗泾', '新凯家园一期', 24000], ['泗泾', '新凯家园二期', 20000],
  ['泗泾', '金港花园一期', 25000], ['泗泾', '金港花园二期', 24500],
  ['泗泾', '泗泾新苑东区', 19000], ['泗泾', '泗泾新苑西区', 19000],
  ['泗泾', '玖龙湾', 26000], ['泗泾', '古楼新苑东区', 19000], ['泗泾', '古楼新苑西区', 19000],
];

const log = [];
db.exec('BEGIN');
try {
  // 1) renames (keep ids & price series)
  const ren = db.prepare('UPDATE communities SET name = ?, note = ? WHERE name = ? AND city_id = ?');
  for (const [from, to] of [['顺康苑', '塘和家园顺康苑'], ['齐康苑', '塘和家园齐康苑']]) {
    const r = ren.run(to, note, from, shanghai.id);
    log.push(`rename: ${from} -> ${to} (${r.changes})`);
  }
  // 2) fix 同润山河小城 district
  const fix = db.prepare("UPDATE communities SET district = '泗泾' WHERE name = '同润山河小城' AND district = '新桥'");
  log.push(`fix 同润山河小城 district -> 泗泾 (${fix.changes})`);
  // 3) drop standalone placeholders
  const delC = db.prepare('DELETE FROM communities WHERE name = ? AND city_id = ?');
  const delP = db.prepare('DELETE FROM community_price WHERE cid = ?');
  for (const name of ['塘和家园', '新凯家园']) {
    const row = db.prepare('SELECT id FROM communities WHERE name = ? AND city_id = ?').get(name, shanghai.id);
    if (row) { delP.run(row.id); delC.run(name, shanghai.id); log.push(`removed placeholder: ${name}`); }
  }
  // 4) insert new communities (anchor: Shanghai second-hand index, same math as build-seeds)
  const fs = require('fs');
  const nbs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'processed', 'city_index.json'), 'utf8'));
  const s = nbs['上海'];
  const firstIdx = s.secondIdx.find((v) => v != null);
  const anchor = { months: [], norm: [] };
  for (let i = 0; i < s.months.length; i++) {
    if (s.secondIdx[i] == null) continue;
    anchor.months.push(s.months[i]);
    anchor.norm.push(s.secondIdx[i] / firstIdx);
  }
  const normLast = anchor.norm[anchor.norm.length - 1];
  const wobble = (key, month, i) => {
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const phase = (h % 628) / 100;
    const m = +month.slice(5, 7);
    return 1 + 0.006 * Math.sin((m / 12) * Math.PI * 2 + phase) + 0.004 * Math.sin(i * 0.35 + phase * 2)
      + ((((h ^ (i * 2654435761)) >>> 0) % 1000) / 100000 - 0.005);
  };
  const insComm = db.prepare('INSERT INTO communities (name,city_id,district,source,note) VALUES (?,?,?,?,?)');
  const insPrice = db.prepare('INSERT OR REPLACE INTO community_price VALUES (?,?,?)');
  let added = 0;
  for (const [district, name, current] of NEW) {
    const exists = db.prepare('SELECT id FROM communities WHERE city_id = ? AND name = ?').get(shanghai.id, name);
    if (exists) { log.push(`skip (exists): ${name}`); continue; }
    const base = current / normLast;
    const prices = anchor.months.map((m, i) => Math.round((base * anchor.norm[i] * wobble(name, m, i)) / 10) * 10);
    const cid = Number(insComm.run(name, shanghai.id, district, 'simulated', note).lastInsertRowid);
    for (let i = 0; i < anchor.months.length; i++) insPrice.run(cid, anchor.months[i], prices[i]);
    added++;
    log.push(`added: ${district} · ${name} (现价≈${current})`);
  }
  db.exec('COMMIT');
  log.forEach((l) => console.log(l));
  console.log(`done, added=${added}`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('failed:', e.message);
  process.exit(1);
}
