// Thin clock-driven I/O over the existing FastAPI endpoints. The ONLY layer that
// touches the network. `base` is the API origin (''=same-origin in the app,
// 'http://localhost:8000' in the Node demo). `token` is the optional Supabase
// bearer (the deployed backend requires it; local dev has auth off).
async function getJson(base, path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const res = await fetch((base || '') + path, { headers })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`)
  return res.json()
}

/** All strikes' 1-min bars for one (expiry, date): {expiry,date,instruments:[{strike,type,bars}]}. */
export const loadDay = (base, expiry, date, token) =>
  getJson(base, `/api/chain_day?expiry=${encodeURIComponent(expiry)}&date=${encodeURIComponent(date)}`, token)

/** Index 1-min history -> [{u,o,h,l,c,v}] (zips the columnar /api/spot payload). */
export async function loadSpot(base, token) {
  const d = await getJson(base, '/api/spot', token)
  return d.t.map((u, i) => ({ u, o: d.o[i], h: d.h[i], l: d.l[i], c: d.c[i], v: d.v[i] }))
}

/** Full per-strike 1-min series (for a held leg across days) -> [{u,o,h,l,c,v,oi}]. */
export async function loadLegSeries(base, expiry, strike, type, token) {
  const arr = await getJson(base, `/api/chart?expiry=${encodeURIComponent(expiry)}&strike=${strike}&type=${type}`, token)
  return arr.map((b) => ({ u: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume, oi: b.oi }))
}

export const loadExpiries = (base, token) => getJson(base, '/api/expiries', token)
export const loadDates = (base, expiry, token) =>
  getJson(base, `/api/dates?expiry=${encodeURIComponent(expiry)}`, token)
