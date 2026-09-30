// Smoke tests for the new community endpoints
(async () => {
  // 1) fetch-real (expected: blocked from this sandbox IP -> structured error)
  const fr = await fetch('http://localhost:3000/api/community/fetch-real', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ city: 'beijing', keyword: '华清嘉园' }),
  }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  console.log('fetch-real:', JSON.stringify(fr).slice(0, 260));

  // 2) community-detail import
  const imp = await fetch('http://localhost:3000/api/import/community-detail', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      city: 'beijing', name: '华清嘉园', district: '海淀',
      built_year: 2000, buildings: 8, households: 640, plot_ratio: 2.6, greening_rate: 30,
      property_fee: '1.2元/㎡/月', listed_price: 86000,
      text: '2015-01,82000\n2016-01,95000\n2017-01,105000\n2021-01,118000\n2023-01,102000\n2026-08,86000',
    }),
  }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  console.log('import-detail:', JSON.stringify(imp));

  // 3) read back
  if (imp.ok) {
    const d = await fetch('http://localhost:3000/api/community/' + imp.data.id).then((r) => r.json());
    console.log('readback:', JSON.stringify({ source: d.data.source, built: d.data.built_year, listed: d.data.listed_price, points: d.data.prices.length, latest: d.data.stats.latest }));
  }
})();
