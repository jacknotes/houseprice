export async function api(path) {
  const r = await fetch(path);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || '请求失败');
  return j.data;
}

export async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || '请求失败');
  return j.data;
}

export const fmtPrice = (v) => (v == null ? '—' : v >= 10000 ? (v / 10000).toFixed(2) + ' 万/㎡' : v + ' 元/㎡');
export const fmtPct = (v) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%');
export const fmtIdx = (v) => (v == null ? '—' : v.toFixed(1));
