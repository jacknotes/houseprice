// Inspect the fetched 仁育苑 sale page: community links, prices, metadata fields
'use strict';
const fs = require('fs');
const s = fs.readFileSync('data/raw/anjuke-sale-仁育苑.html', 'utf8');

// 1) find community links / ids
const commLinks = [...s.matchAll(/https:\/\/shanghai\.anjuke\.com\/community\/[^"'\s>]+/g)].map((m) => m[0]);
console.log('community links:', [...new Set(commLinks)].slice(0, 6));
const commIds = [...s.matchAll(/comm[_-]?id["'=:\s]+(\d{4,9})/gi)].map((m) => m[1]);
console.log('comm ids:', [...new Set(commIds)].slice(0, 8));

// 2) price-like patterns (listing total prices & unit prices)
const unitPrices = [...s.matchAll(/(\d{4,6})\s*元\/㎡/g)].map((m) => +m[1]);
console.log('unit price samples:', unitPrices.slice(0, 15), 'count:', unitPrices.length);

// 3) any meta rows
for (const key of ['均价', '建成', '竣工', '权属', '产权', '户数', '楼栋总数', '物业费', '绿化率', '容积率', '小区简介', '挂牌']) {
  const i = s.indexOf(key);
  if (i >= 0) {
    const frag = s.slice(Math.max(0, i - 100), i + 200).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    console.log(`[${key}]`, JSON.stringify(frag).slice(0, 260));
  } else {
    console.log(`[${key}] not found`);
  }
}

// 4) count listing cards
const listCards = (s.match(/property-content-info/g) || []).length;
console.log('listing cards:', listCards);
