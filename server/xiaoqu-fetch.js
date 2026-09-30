// Best-effort fetcher for community (小区) real details + current listed price
// from Anjuke xiaoqu pages. Uses the hardened http-client (browser headers,
// cookie warm-up, retries, optional proxy/manual cookie). Anti-bot may still
// block; every failure mode returns a structured result so the UI can tell
// the user what to do (e.g. manual import).
'use strict';
const { createClient } = require('./http-client');

const client = createClient();
const AJ_BLOCK = (body) => /antibot|verifycode|xxzlGateway|callback\.58\.com|captcha/.test(String(body)) || String(body).length < 1500;

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// parse a detail page for the fields we care about (tolerant of layout variants)
function parseXiaoquDetail(html) {
  const s = String(html);
  const out = {};
  const grab = (patterns) => {
    for (const re of patterns) {
      const m = s.match(re);
      if (m) return stripTags(m[1]);
    }
    return null;
  };
  out.name = grab([/<h1[^>]*>([^<]{2,30})<\/h1>/, /<title>\s*([^,<_]{2,30})/]) || null;
  const priceRaw = grab([/(\d{3,6})\s*元\/㎡/, /(\d{3,6})\s*元\/平/]);
  out.listed_price = priceRaw ? +priceRaw : null;
  out.listed_month = (() => {
    const m = s.match(/(\d{4})年(\d{1,2})月[^<]{0,10}均价/);
    return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}` : null;
  })();
  const kv = {};
  const dlRe = /<(?:dt|span|div)[^>]*>\s*([^<>{}]{2,10}：?)\s*<\/(?:dt|span|div)>\s*<[^>]*>\s*([^<>]{1,30}?)\s*</g;
  let km;
  while ((km = dlRe.exec(s))) {
    const k = km[1].replace(/[：:\s]/g, '');
    kv[k] = stripTags(km[2]);
  }
  const pick = (keys, num) => {
    for (const k of keys) {
      if (kv[k] != null && kv[k] !== '-') {
        const v = num ? parseFloat(kv[k].replace(/[^\d.]/g, '')) : kv[k];
        if (Number.isFinite(v)) return v;
        if (!num && kv[k]) return kv[k];
      }
    }
    for (const k of keys) {
      const m = s.match(new RegExp(`${k}[^\\d]{0,40}(\\d{2,4}(?:\\.\\d+)?)`));
      if (m) return +m[1];
    }
    return null;
  };
  out.built_year = pick(['建成年代', '建成年份', '竣工时间', '建筑年代'], true);
  out.buildings = pick(['楼栋数', '楼栋总数', '栋数'], true);
  out.households = pick(['房屋总数', '总户数', '户数'], true);
  out.plot_ratio = pick(['容积率'], true);
  out.greening_rate = pick(['绿化率', '绿化面积'], true);
  out.property_fee = pick(['物业费', '物业管理费'], false);
  return out;
}

async function fetchCommunityReal(cityPy, keyword) {
  const kw = encodeURIComponent(keyword);
  // one warm-up per session: homepage sets anjuke cookies before any data page
  const warm = await client.get('https://www.anjuke.com/', { retries: 1, timeoutMs: 15000, isBlocked: AJ_BLOCK });
  const attempts = [
    { label: 'anjuke-xiaoqu-subdomain', url: `https://${cityPy}.xiaoqu.anjuke.com/?kw=${kw}` },
    { label: 'anjuke-m-xiaoqu', url: `https://m.anjuke.com/${cityPy}/xiaoqu/?kw=${kw}` },
    { label: 'anjuke-fang-xiaoqu', url: `https://${cityPy}.fang.anjuke.com/xiaoqu/?kw=${kw}` },
  ];
  const tried = [];
  if (warm.status !== 200) tried.push(`warmup:status${warm.status}`);
  for (const a of attempts) {
    const r = await client.get(a.url, { retries: 1, timeoutMs: 18000, isBlocked: AJ_BLOCK, referer: 'https://www.anjuke.com/' });
    if (r.status !== 200) { tried.push(`${a.label}:status${r.status}`); continue; }
    const body = r.body.toString('utf8');
    if (AJ_BLOCK(body)) { tried.push(`${a.label}:antibot`); continue; }
    // find first detail link whose surrounding text mentions the keyword
    const linkRe = /<a[^>]+href="(https?:\/\/[^"]+?\/xiaoqu(?:\/detail)?\/(\d+)[^"]*)"[^>]*>([\s\S]{0,120}?)<\/a>/g;
    let m, hit = null;
    while ((m = linkRe.exec(body))) {
      const text = stripTags(m[3]);
      if (text.includes(keyword) || m[1].includes(keyword)) { hit = { url: m[1], name: text }; break; }
    }
    if (!hit) {
      const any = body.match(/https?:\/\/[a-z]+\.anjuke\.com\/xiaoqu\/detail\/(\d+)/);
      if (any) hit = { url: any[0], name: null };
    }
    if (!hit) { tried.push(`${a.label}:no-detail-link`); continue; }
    await new Promise((res) => setTimeout(res, 1200));
    const d = await client.get(hit.url, { retries: 1, timeoutMs: 18000, isBlocked: AJ_BLOCK, referer: a.url });
    const dbody = d.body.toString('utf8');
    if (d.status !== 200 || AJ_BLOCK(dbody)) { tried.push('detail-blocked'); continue; }
    const fields = parseXiaoquDetail(dbody);
    if (!fields.listed_price && !fields.built_year) { tried.push('detail-parse-empty'); continue; }
    return {
      ok: true, via: a.label, url: hit.url, matched_name: hit.name || fields.name,
      fields, tried,
    };
  }
  return {
    ok: false,
    error: '安居客反爬拦截，未能获取小区数据（本机 IP 或出口 IP 被限制）',
    hint: '可复制浏览器里的安居客 Cookie 到环境变量 ANJUKE_COOKIE，或配置 FETCH_PROXY_URL 走代理；也可以在“数据管理”页手动导入（可达到100%真实）',
    tried,
  };
}

module.exports = { fetchCommunityReal, parseXiaoquDetail };
