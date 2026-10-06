// Shared data parsers (used by transform scripts and the runtime refresh worker)
'use strict';

function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// NBS 70-city CSV (values are index points: 环比=上月100, 同比=上年同月100)
// -> { "<城市>": { months, newIdx(chained), newMom, newYoy, secondIdx, secondMom, secondYoy } }
function parseNbsCsv(text) {
  const clean = String(text).replace(/^\uFEFF/, '').trim();
  const lines = clean.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const COL = {};
  header.forEach((h, i) => (COL[h] = i));

  const cities = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c = parseCsvLine(lines[i]);
    const city = c[COL['CITY']], date = c[COL['DATE']], kind = c[COL['FixedBase']];
    const ym = date.replace(/^(\d{4})\/(\d{1,2})\/\d+$/, (_, y, m) => `${y}-${String(m).padStart(2, '0')}`);
    const newV = num(c[COL['CommodityHouseIDX']]);
    const secV = num(c[COL['SecondHandIDX']]);
    if (!city || !ym || !kind) continue;
    if (!cities[city]) cities[city] = {};
    if (!cities[city][ym]) cities[city][ym] = {};
    const slot = cities[city][ym];
    if (kind === '环比') { slot.newMom = newV; slot.secMom = secV; }
    else if (kind === '同比') { slot.newYoy = newV; slot.secYoy = secV; }
  }

  const monthsAll = [...new Set(Object.values(cities).flatMap((m) => Object.keys(m)))].sort();
  const result = {};
  for (const [city, byMonth] of Object.entries(cities)) {
    const months = monthsAll.filter((m) => byMonth[m]);
    const series = { months: [], newIdx: [], newMom: [], newYoy: [], secondIdx: [], secondMom: [], secondYoy: [] };
    let nIdx = null, sIdx = null;
    for (const m of months) {
      const r = byMonth[m];
      if (r.newMom != null) nIdx = nIdx == null ? 100 : nIdx * (r.newMom / 100);
      if (r.secMom != null) sIdx = sIdx == null ? 100 : sIdx * (r.secMom / 100);
      if (nIdx == null && sIdx == null && r.newYoy == null) continue;
      series.months.push(m);
      series.newIdx.push(nIdx == null ? null : +nIdx.toFixed(2));
      series.newMom.push(r.newMom);
      series.newYoy.push(r.newYoy);
      series.secondIdx.push(sIdx == null ? null : +sIdx.toFixed(2));
      series.secondMom.push(r.secMom);
      series.secondYoy.push(r.secYoy);
    }
    result[city] = series;
  }
  return result;
}

// Anjuke fangjia SSR table -> [{ ym, price }] ascending (up/down arrow sign lost here; mom recomputed by caller)
function parseAnjukeTable(html) {
  const s = String(html);
  const rows = [];
  const re = /<div class="td first"[^>]*>\s*20(\d{2})年(\d{1,2})月房价\s*<\/div>\s*<div class="td"[^>]*>\s*([\d\-\.]+)(?:元\/㎡)?\s*<\/div>\s*<div class="td"[^>]*>(?:<div class="(up|down)"[^>]*><\/div>)?\s*([\d\-\.]+)%/g;
  let m;
  while ((m = re.exec(s))) {
    const year = 2000 + +m[1], month = +m[2];
    const price = m[3] === '-' ? null : +m[3];
    const mom = m[5] === '-' || !price ? null : (m[4] === 'down' ? -+m[5] : +m[5]);
    if (price != null) rows.push({ ym: `${year}-${String(month).padStart(2, '0')}`, price, momListed: mom });
  }
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.ym)) seen.set(r.ym, r);
  return [...seen.values()].sort((a, b) => a.ym.localeCompare(b.ym));
}

// Parse anjuke community/view detail page -> structured fields
function parseCommunityView(html) {
  const s = String(html);
  const out = {};
  const label = (name) => {
    const re = new RegExp(`>\\s*${name}\\s*</div>\\s*<div class="hover"[^>]*>\\s*<div class="value[^"]*"[^>]*>\\s*([\\s\\S]{0,160}?)\\s*</div>`, 'i');
    const m = s.match(re);
    return m ? m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : null;
  };
  out.built_year_raw = label('竣工时间');
  out.ownership_type = label('权属类别');
  out.property_years = label('产权年限');
  const hh = label('总户数');
  if (hh) {
    const n = parseFloat(hh.replace(/[^\d.]/g, ''));
    out.households = Number.isFinite(n) ? n : null;
    out.households_raw = hh;
  }
  out.property_fee = label('物业费');
  out.greening_rate = label('绿化率');
  out.plot_ratio = label('容积率');
  // 新版详情页: <span class="average" data-v-..>13977</span> <span class="unit" data-v-..>元/㎡</span> ... <p class="house-price_title">10月挂牌均价</p>
  const pm = s.match(/<span class="average"[^>]*>(\d{4,6})<\/span>\s*<span class="unit"[^>]*>元[\s\S]{0,400}?(\d{1,2})月挂牌均价/);
  if (pm) {
    out.listed_price = +pm[1];
    const now = new Date();
    out.listed_month = `${now.getFullYear()}-${String(pm[2]).padStart(2, '0')}`;
  }
  const nm = s.match(/<h1[^>]*>([^<]{2,40})<\/h1>/);
  out.page_name = nm ? nm[1].trim() : null;
  return out;
}

// Parse pasted anjuke community page TEXT (user copies the rendered page) -> fields
// Note: rendered page text duplicates each value (hover layer + visible layer), e.g.
// "权属类别 经济适用房 经济适用房" — values are deduped after extraction.
function dedupeValue(v) {
  if (v == null) return v;
  const m = String(v).trim().match(/^(.+?)\s+\1$/);
  return m ? m[1] : String(v).trim();
}
function parseDetailText(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const out = {};
  const grab = (re, group = 1) => {
    const m = t.match(re);
    if (!m) return null;
    return dedupeValue(m[group]);
  };
  out.built_year_raw = grab(/竣工时间\s*(.{1,120}?)\s*(?=产权年限|权属类别|总户数|建筑类型|所属商圈|绿化率|容积率|物业费|物业公司|开发商|小区地址|在售房源|统一供暖|供水供电|停车位)/);
  out.ownership_type = grab(/权属类别\s*([^\s]{2,12}?)(?=\s*(?:产权年限|竣工时间|总户数|楼栋|绿化率|容积率|物业费|物业公司|开发商|建筑类型|$))/);
  out.property_years = grab(/产权年限\s*(\d{1,2}年)/);
  const hh = grab(/总户数\s*(\d+)\s*户?/);
  if (hh) out.households = +hh;
  const gr = grab(/绿化率\s*([\d.]+)/);
  if (gr) out.greening_rate = +gr;
  const pr = grab(/容积率\s*([\d.]+)/);
  if (pr) out.plot_ratio = +pr;
  out.property_fee = grab(/物业费\s*([\d.]+\s*元\/[^\s]{1,10})/);
  const pm = t.match(/(\d{4,6})\s*元\/㎡\s*(\d{1,2})月挂牌均价/);
  if (pm) {
    out.listed_price = +pm[1];
    out.listed_month = `${new Date().getFullYear()}-${String(pm[2]).padStart(2, '0')}`;
  }
  const nm = grab(/小区名称\s*([^\s]{3,30})/);
  if (nm) out.page_name = nm;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null && v !== ''));
}

module.exports = { parseNbsCsv, parseAnjukeTable, parseCsvLine, parseCommunityView, parseDetailText };
