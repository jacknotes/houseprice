// Quick import smoke test: posts a user CSV for 咸宁碧桂园 then reads it back.
const rows = [
  ['2015-12', 3200], ['2016-08', 3190], ['2017-12', 3660], ['2018-08', 4900],
  ['2019-08', 4880], ['2020-08', 4810], ['2021-10', 5350], ['2022-08', 5370],
  ['2023-08', 5300], ['2024-08', 4980], ['2025-08', 4800], ['2026-09', 4520],
];
const text = rows.map((r) => r.join(',')).join('\n');
const post = fetch('http://localhost:3000/api/import/community', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ city: 'xianning', name: '咸宁碧桂园', district: '温泉', text }),
}).then((r) => r.json());
post.then(async (j) => {
  console.log('import:', JSON.stringify(j));
  const list = await fetch('http://localhost:3000/api/communities?city=xianning').then((r) => r.json());
  const target = list.data.find((c) => c.name === '咸宁碧桂园');
  const detail = await fetch('http://localhost:3000/api/community/' + target.id).then((r) => r.json());
  console.log('detail source:', detail.data.source, '| points:', detail.data.prices.length, '| latest:', detail.data.stats.latest, detail.data.stats.latestMonth);
});
