// Debug parseDetailText on the real rendered page text
'use strict';
const fs = require('fs');
const { parseDetailText } = require('../server/parsers');
const html = fs.readFileSync('data/raw/anjuke-view-仁育苑.html', 'utf8');
const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const i = text.indexOf('权属类别');
console.log('context around 权属类别:');
console.log(JSON.stringify(text.slice(i - 120, i + 320)));
const j = text.indexOf('挂牌均价');
console.log('\ncontext around 挂牌均价:');
console.log(JSON.stringify(text.slice(j - 120, j + 80)));
console.log('\nparsed:', JSON.stringify(parseDetailText(text)));
