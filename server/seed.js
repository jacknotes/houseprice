// Create SQLite DB and load processed seed data. Idempotent: rebuilds tables each run.
// Usage: node server/seed.js
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { M } = require('./city-meta');

const ROOT = path.join(__dirname, '..');
const PROC = path.join(ROOT, 'data', 'processed');
const DB_PATH = path.join(ROOT, 'data', 'app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
DROP TABLE IF EXISTS cities;
DROP TABLE IF EXISTS city_index;
DROP TABLE IF EXISTS city_level;
DROP TABLE IF EXISTS communities;
DROP TABLE IF EXISTS community_price;
DROP TABLE IF EXISTS meta;
CREATE TABLE cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT UNIQUE NOT NULL,
  province TEXT,
  tier TEXT,
  in70 INTEGER DEFAULT 0,
  featured INTEGER DEFAULT 0
);
CREATE TABLE city_index (
  city_id INTEGER NOT NULL,
  month TEXT NOT NULL,
  new_idx REAL, new_mom REAL, new_yoy REAL,
  sec_idx REAL, sec_mom REAL, sec_yoy REAL,
  PRIMARY KEY (city_id, month)
);
CREATE TABLE city_level (
  city_id INTEGER NOT NULL,
  month TEXT NOT NULL,
  price REAL NOT NULL,
  mom REAL,
  source TEXT DEFAULT 'anjuke',
  PRIMARY KEY (city_id, month)
);
CREATE TABLE communities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  city_id INTEGER NOT NULL,
  district TEXT,
  source TEXT DEFAULT 'simulated',
  note TEXT,
  built_year INTEGER,
  buildings INTEGER,
  households INTEGER,
  plot_ratio REAL,
  greening_rate REAL,
  property_fee TEXT,
  listed_price REAL,
  listed_month TEXT,
  anjuke_url TEXT,
  ownership_type TEXT,
  property_years TEXT
);
CREATE TABLE community_price (
  cid INTEGER NOT NULL,
  month TEXT NOT NULL,
  price REAL NOT NULL,
  PRIMARY KEY (cid, month)
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX idx_comm_city ON communities(city_id);
CREATE INDEX idx_comm_name ON communities(name);
`);

const insCity = db.prepare('INSERT INTO cities (code,name,province,tier,in70,featured) VALUES (?,?,?,?,?,?)');
const insIdx = db.prepare('INSERT OR REPLACE INTO city_index VALUES (?,?,?,?,?,?,?,?)');
const insLvl = db.prepare('INSERT OR REPLACE INTO city_level VALUES (?,?,?,?,?)');
const insComm = db.prepare('INSERT INTO communities (name,city_id,district,source,note) VALUES (?,?,?,?,?)');const insCPrice = db.prepare('INSERT OR REPLACE INTO community_price VALUES (?,?,?)');

const cityId = {};
db.exec('BEGIN');
for (const [name, [code, province, tier]] of Object.entries(M)) {
  const in70 = tier !== '三线及以下' ? 1 : 0;
  const featured = ['beijing', 'shanghai', 'guangzhou', 'shenzhen', 'xianning'].includes(code) ? 1 : 0;
  const r = insCity.run(code, name, province, tier, in70, featured);
  cityId[name] = Number(r.lastInsertRowid);
}

const nbs = JSON.parse(fs.readFileSync(path.join(PROC, 'city_index.json'), 'utf8'));
let idxRows = 0;
for (const [name, s] of Object.entries(nbs)) {
  const id = cityId[name];
  if (!id) continue;
  for (let i = 0; i < s.months.length; i++) {
    insIdx.run(id, s.months[i], s.newIdx[i], s.newMom[i], s.newYoy[i], s.secondIdx[i], s.secondMom[i], s.secondYoy[i]);
    idxRows++;
  }
}

const levels = JSON.parse(fs.readFileSync(path.join(PROC, 'city_level.json'), 'utf8'));
let lvlRows = 0;
for (const [name, arr] of Object.entries(levels)) {
  const id = cityId[name];
  if (!id) continue;
  for (const r of arr) {
    insLvl.run(id, r.ym, r.price, r.mom ?? null, 'anjuke');
    lvlRows++;
  }
}

const comms = JSON.parse(fs.readFileSync(path.join(PROC, 'communities.json'), 'utf8'));
let cPriceRows = 0;
for (const c of comms) {
  const id = cityId[c.city];
  if (!id) continue;
  const r = insComm.run(c.name, id, c.district, c.source, c.note);
  const cid = Number(r.lastInsertRowid);
  for (let i = 0; i < c.months.length; i++) {
    insCPrice.run(cid, c.months[i], c.prices[i]);
    cPriceRows++;
  }
}
db.prepare('INSERT INTO meta VALUES (?,?)').run('seeded_at', new Date().toISOString());
db.prepare('INSERT INTO meta VALUES (?,?)').run('index_source', '国家统计局70个大中城市商品住宅销售价格指数（月度，环比链式合成定基指数）');
db.prepare('INSERT INTO meta VALUES (?,?)').run('level_source', '安居客城市挂牌均价（历史房价页）');
db.exec('COMMIT');

console.log(`seeded: cities=${Object.keys(M)} count=${Object.keys(M).length}, indexRows=${idxRows}, levelRows=${lvlRows}, communities=${comms.length}, communityPrices=${cPriceRows}, db=${DB_PATH}`);
