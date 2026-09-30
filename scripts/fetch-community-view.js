// Fetch anjuke community view pages and dump structure for parsing
'use strict';
const fs = require('fs');
const { createClient } = require('../server/http-client');

const client = createClient();
const AJ_BLOCK = (body) => /antibot|verifycode|xxzlGateway|callback\.58\.com|captcha/.test(String(body)) || String(body).length < 3000;

const TARGETS = [
  ['仁育苑', 'https://shanghai.anjuke.com/community/view/818765'],
  ['古楼新苑(东区)', 'https://shanghai.anjuke.com/community/view/611824'],
];

(async () => {
  for (const [name, url] of TARGETS) {
    const r = await client.get(url, { warmupUrl: 'https://www.anjuke.com/', retries: 1, timeoutMs: 20000, isBlocked: AJ_BLOCK, referer: 'https://shanghai.anjuke.com/' });
    const body = r.body ? r.body.toString('utf8') : '';
    console.log('===', name, 'status:', r.status, 'len:', body.length, 'blocked:', AJ_BLOCK(body));
    if (r.status !== 200 || AJ_BLOCK(body)) { console.log('head:', JSON.stringify(body.slice(0, 150))); continue; }
    fs.writeFileSync(`data/raw/anjuke-view-${name}.html`, body);
    for (const key of ['均价', '建成年代', '竣工', '权属类别', '产权年限', '总户数', '楼栋总数', '物业费', '绿化率', '容积率', '物业公司', '开发商']) {
      const i = body.indexOf(key);
      if (i >= 0) {
        const frag = body.slice(Math.max(0, i - 60), i + 180).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        console.log(`  [${key}]`, JSON.stringify(frag).slice(0, 280));
      } else console.log(`  [${key}] not found`);
    }
    await new Promise((res) => setTimeout(res, 1800));
  }
})();
