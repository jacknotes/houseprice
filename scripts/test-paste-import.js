// Test the paste-import: render the saved 仁育苑 view HTML to text and post it
'use strict';
const fs = require('fs');
(async () => {
  const html = fs.readFileSync('data/raw/anjuke-view-仁育苑.html', 'utf8');
  // simulate user copy: body innerText (strip tags/scripts/styles)
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const post = await fetch('http://localhost:3000/api/import/community-detail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ city: 'shanghai', name: '塘和家园仁育苑', district: '泗泾', pageText: text }),
  }).then((r) => r.json());
  console.log('import:', JSON.stringify(post));
  const detail = await fetch('http://localhost:3000/api/community/' + post.data.id).then((r) => r.json());
  const d = detail.data;
  console.log('verify:', JSON.stringify({
    source: d.source, built: d.built_year, ownership: d.ownership_type, years: d.property_years,
    households: d.households, listed: d.listed_price, month: d.listed_month, fee: d.property_fee,
    greening: d.greening_rate, plot: d.plot_ratio, latest: d.stats.latest, latestMonth: d.stats.latestMonth,
  }));
})();
