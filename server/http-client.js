// Hardened HTTP client for polite low-volume scraping of public price pages.
// - realistic browser header set
// - cookie jar with optional homepage warm-up (anti-bot gateways usually check cookies)
// - retry with exponential backoff
// - optional outbound proxy (FETCH_PROXY_URL=http://host:port, CONNECT tunneling for https)
// - optional manual cookie injection (ANJUKE_COOKIE=<string copied from your browser>)
'use strict';
const https = require('https');
const http = require('http');
const net = require('net');
const tls = require('tls');
const { URL } = require('url');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function browserHeaders(extra) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': '"Chromium";v="126", "Not:A-Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-user': '?1',
    ...extra,
  };
}

class CookieJar {
  constructor() { this.byDomain = new Map(); }
  store(url, setCookieList) {
    if (!setCookieList) return;
    let host;
    try { host = new URL(url).hostname; } catch { return; }
    const jar = this.byDomain.get(host) || {};
    for (const raw of setCookieList) {
      const first = String(raw).split(';')[0];
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name && value) jar[name] = value;
    }
    this.byDomain.set(host, jar);
  }
  header(url) {
    let host;
    try { host = new URL(url).hostname; } catch { return null; }
    // exact host first, then parent domains (a.b.com also sees b.com cookies)
    const parts = host.split('.');
    const merged = {};
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts.slice(i).join('.');
      Object.assign(merged, this.byDomain.get(d) || {});
    }
    Object.assign(merged, this.byDomain.get(host) || {});
    const pairs = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
    return pairs.length ? pairs.join('; ') : null;
  }
  mergeRaw(raw) {
    // manual cookie string like "a=1; b=2" applied to all anjuke/ke domains is handled by caller
    for (const part of String(raw).split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (!name) continue;
      const jar = this.byDomain.get('_manual') || {};
      jar[name] = value;
      this.byDomain.set('_manual', jar);
    }
  }
  headerWithManual(url, manualDomains) {
    const base = this.header(url);
    if (!manualDomains) return base;
    let host;
    try { host = new URL(url).hostname; } catch { return base; }
    const applies = manualDomains.some((d) => host === d || host.endsWith('.' + d));
    if (!applies) return base;
    const manual = this.byDomain.get('_manual') || {};
    const pairs = Object.entries(manual).map(([k, v]) => `${k}=${v}`);
    return [base, pairs.join('; ')].filter(Boolean).join('; ') || null;
  }
}

function connectViaProxy(proxyUrl, targetHost, targetPort, timeoutMs) {
  return new Promise((resolve, reject) => {
    let pu;
    try { pu = new URL(proxyUrl); } catch (e) { return reject(new Error('FETCH_PROXY_URL 无效: ' + e.message)); }
    const socket = net.connect({ host: pu.hostname, port: +(pu.port || 80) });
    socket.setTimeout(timeoutMs || 15000);
    let buf = '';
    socket.on('connect', () => {
      socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: keep-alive\r\n\r\n`);
    });
    socket.on('data', function onData(chunk) {
      buf += chunk.toString('latin1');
      if (!/\r\n\r\n/.test(buf)) return;
      socket.removeListener('data', onData);
      if (/HTTP\/1\.[01] 200/.test(buf)) resolve(socket);
      else { socket.destroy(); reject(new Error('代理 CONNECT 失败: ' + buf.split('\r\n')[0])); }
    });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('代理连接超时')); });
    socket.once('error', (e) => reject(new Error('代理连接错误: ' + e.message)));
  });
}

// single GET, returns { status, headers, body(Buffer) }
function rawGet(urlStr, { timeoutMs = 20000, cookie = null, referer = null, extraHeaders = null } = {}) {
  return new Promise((resolve) => {
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const headers = browserHeaders({
      'Host': u.hostname,
      ...(referer ? { Referer: referer } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders,
    });
    const proxyUrl = process.env.FETCH_PROXY_URL || '';
    const doReq = async () => {
      if (proxyUrl && isHttps) {
        const tunnel = await connectViaProxy(proxyUrl, u.hostname, +(u.port || 443), timeoutMs);
        return https.request({
          host: u.hostname, port: +(u.port || 443), path: u.pathname + u.search, method: 'GET', headers,
          timeout: timeoutMs,
          createConnection: () => tls.connect({ socket: tunnel, servername: u.hostname }),
        });
      }
      const mod = isHttps ? https : http;
      return mod.request({
        host: u.hostname, port: +(u.port || (isHttps ? 443 : 80)), path: u.pathname + u.search, method: 'GET', headers,
        timeout: timeoutMs,
      });
    };
    doReq().then((req) => {
      req.on('response', (res) => {
        const chunks = [];
        res.on('data', (ch) => chunks.push(ch));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', (e) => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), err: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, body: Buffer.alloc(0), err: 'timeout' }); });
      req.end();
    }).catch((e) => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), err: e.message }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * createClient: cookie-jar + retry GET.
 * opts.proxyUrl   — override env FETCH_PROXY_URL
 * opts.manualCookie — env ANJUKE_COOKIE style string, applied on manualCookieDomains
 */
function createClient(opts = {}) {
  const jar = new CookieJar();
  const proxyUrl = opts.proxyUrl !== undefined ? opts.proxyUrl : (process.env.FETCH_PROXY_URL || '');
  const manualCookie = opts.manualCookie !== undefined ? opts.manualCookie : (process.env.ANJUKE_COOKIE || '');
  const manualDomains = opts.manualCookieDomains || ['anjuke.com', 'ke.com', 'lianjia.com', 'fang.com'];
  if (manualCookie) jar.mergeRaw(manualCookie);

  async function getOnce(url, { referer, timeoutMs, extraHeaders } = {}) {
    const cookie = jar.headerWithManual(url, manualDomains);
    const res = await rawGet(url, { timeoutMs, cookie, referer, extraHeaders });
    if (res.headers && res.headers['set-cookie']) jar.store(url, res.headers['set-cookie']);
    return res;
  }

  async function get(url, { referer = null, timeoutMs = 20000, retries = 2, backoffMs = 900, isBlocked = null, warmupUrl = null, okStatuses = [200] } = {}) {
    // optional warm-up page first (collects cookies from the same site)
    if (warmupUrl) {
      await getOnce(warmupUrl, { timeoutMs });
      await sleep(300 + Math.floor(Math.random() * 400));
    }
    let last = { status: 0, headers: {}, body: Buffer.alloc(0), err: 'not attempted' };
    for (let attempt = 0; attempt <= retries; attempt++) {
      last = await getOnce(url, { referer, timeoutMs, extraHeaders: attempt > 0 ? { 'sec-fetch-site': 'same-origin' } : null });
      const body = last.body.toString('utf8');
      const blocked = isBlocked ? isBlocked(body) : false;
      if (okStatuses.includes(last.status) && !blocked) return last;
      if (attempt < retries) await sleep(backoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 300));
    }
    return last;
  }

  return { get, jar, proxyUrl: proxyUrl || null, manualCookie: !!manualCookie };
}

module.exports = { createClient, browserHeaders, UA };
