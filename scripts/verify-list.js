// Verify the final Shanghai community list state
(async () => {
  const d = await fetch('http://localhost:3000/api/communities?city=shanghai').then((r) => r.json());
  const rows = d.data;
  console.log('上海小区总数:', rows.length);
  const th = rows.filter((r) => r.name.includes('塘和家园'));
  const xk = rows.filter((r) => r.name.includes('新凯'));
  console.log('塘和家园系列 (' + th.length + '):', th.map((r) => r.name.replace('塘和家园', '')).join('、'));
  console.log('新凯系列 (' + xk.length + '):', xk.map((r) => r.name).join('、'));
  const sj = rows.filter((r) => r.district === '泗泾');
  const dj = rows.filter((r) => r.district === '洞泾');
  console.log('泗泾片区:', sj.length, '| 洞泾片区:', dj.length);
  const sh = rows.find((r) => r.name === '同润山河小城');
  console.log('同润山河小城 district:', sh && sh.district);
})();
