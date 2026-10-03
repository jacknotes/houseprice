const TOKEN_KEY = 'hp_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// strip the leading slash so paths resolve relative to the document URL:
// under /houseprice/ (reverse-proxy subpath) they hit /houseprice/api/..., at root they stay /api/...
export async function api(path) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = 'Bearer ' + t;
  const r = await fetch(path.replace(/^\/+/, ''), { headers });
  const j = await r.json();
  if (!j.ok) {
    const e = new Error(j.error || '请求失败');
    e.status = r.status;
    throw e;
  }
  return j.data;
}

export async function post(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers.Authorization = 'Bearer ' + t;
  const r = await fetch(path.replace(/^\/+/, ''), { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) {
    const e = new Error(j.error || '请求失败');
    e.status = r.status;
    throw e;
  }
  return j.data;
}

export const fmtPrice = (v) => (v == null ? '—' : v >= 10000 ? (v / 10000).toFixed(2) + ' 万/㎡' : v + ' 元/㎡');
export const fmtPct = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%');
export const fmtIdx = (v) => (v == null ? '—' : v.toFixed(1));
