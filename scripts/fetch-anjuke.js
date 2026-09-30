// Download anjuke fangjia pages: main + per-year pages for each city
// Usage: node scripts/fetch-anjuke.js
const https = require('https');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const cities = ['beijing', 'shanghai', 'guangzhou', 'xianning'];
const years = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const outDir = path.join(__dirname, '..', 'data', 'raw');
fs.mkdirSync(outDir, { recursive: true });

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://www.anjuke.com/',
      },
      timeout: 25000,
    }, (res) => {
      if (res.statusCode >= 301 && res.statusCode <= 303 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location));
      }
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e) }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const targets = [];
  for (const c of cities) {
    targets.push({ city: c, name: `${c}_main`, url: `https://www.anjuke.com/fangjia/${c}/` });
    for (const y of years) targets.push({ city: c, name: `${c}_${y}`, url: `https://www.anjuke.com/fangjia/${c}${y}/` });
  }
  let ok = 0;
  for (const t of targets) {
    const r = await get(t.url);
    const has = /元\/㎡/.test(r.body);
    fs.writeFileSync(path.join(outDir, `anjuke_${t.name}.html`), r.body);
    if (has) ok++;
    console.log(`${t.name}: ${r.status} ${r.body.length} ${has ? 'HAS_DATA' : '-'}`);
    await sleep(1200);
  }
  console.log('done, pages with data:', ok, '/', targets.length);
})();
