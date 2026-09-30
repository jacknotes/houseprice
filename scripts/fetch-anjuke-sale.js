// Fetch the two anjuke sale pages the user provided, dump key fragments to
// check reachability and parse structure.
'use strict';
const { createClient } = require('../server/http-client');

const client = createClient();
const AJ_BLOCK = (body) => /antibot|verifycode|xxzlGateway|callback\.58\.com|captcha/.test(String(body)) || String(body).length < 3000;

const URLS = [
  ['仁育苑', 'https://shanghai.anjuke.com/sale/rd1/?q=%E4%BB%81%E8%82%B2%E8%8B%91'],
  ['古楼新苑(东区)', 'https://shanghai.anjuke.com/sale/?comm_id=611824&q=%E5%8F%A4%E6%A5%BC%E6%96%B0%E8%8B%91%28%E4%B8%9C%E5%8C%BA%29'],
];

(async () => {
  const warm = await client.get('https://www.anjuke.com/', { retries: 1, timeoutMs: 15000, isBlocked: AJ_BLOCK });
  console.log('warmup:', warm.status, warm.body ? warm.body.length : 0);
  for (const [name, url] of URLS) {
    const r = await client.get(url, { warmupUrl: 'https://www.anjuke.com/', retries: 1, timeoutMs: 20000, isBlocked: AJ_BLOCK, referer: 'https://www.anjuke.com/' });
    const body = r.body ? r.body.toString('utf8') : '';
    console.log('===', name, 'status:', r.status, 'len:', body.length, 'blocked:', AJ_BLOCK(body));
    if (r.status !== 200 || AJ_BLOCK(body)) {
      console.log('head:', JSON.stringify(body.slice(0, 200)));
      continue;
    }
    for (const key of ['仁育苑', '古楼新苑', '均价', '竣工', '建成', '权属', '产权年限', '总户数', '户数', '楼栋', '物业费', '绿化率', '容积率', '年代']) {
      const i = body.indexOf(key);
      if (i >= 0) {
        const frag = body.slice(Math.max(0, i - 80), i + 160).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        console.log(`  [${key}]`, JSON.stringify(frag).slice(0, 240));
      }
    }
    require('fs').writeFileSync(`data/raw/anjuke-sale-${name}.html`, body);
    console.log('  saved: data/raw/anjuke-sale-' + name + '.html');
  }
})();
