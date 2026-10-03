// Import 古楼新苑(东区) real fields (extracted from the user-provided anjuke page)
(async () => {
  const pageText = '古楼新苑(东区) 挂牌均价 25032 元/㎡ 10月挂牌均价 竣工时间 2013年 权属类别 动迁配套房 产权年限 70年 总户数 560户 容积率 2.00 绿化率 40.0% 物业费 1.20元/平米/月';
  const r = await fetch('http://localhost:3000/api/import/community-detail', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ city: 'shanghai', name: '古楼新苑东区', district: '泗泾', pageText })
  }).then((x) => x.json());
  console.log('import:', JSON.stringify(r));
  const d = await fetch('http://localhost:3000/api/community/' + r.data.id).then((x) => x.json());
  const v = d.data;
  console.log('verify:', JSON.stringify({ src: v.source, built: v.built_year, owner: v.ownership_type, years: v.property_years, hh: v.households, listed: v.listed_price, month: v.listed_month, latest: v.stats.latest, url: v.anjuke_url }));
})();
