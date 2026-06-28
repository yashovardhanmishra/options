// A per-instrument 1-min series, indexed for clock-driven reads. Bars are sorted
// ascending by the integer time key `u` (the data's opaque IST-as-UTC seconds).
//
// ANTI-LOOKAHEAD is enforced here and is a HARD invariant: a read at clock t may
// only surface a bar with u <= t. `assertNoLookahead` throws if any path would
// return a bar from the future — it's wired into every read as defense-in-depth.

/** Normalize raw bars ([u,o,h,l,c,v,oi] or {…}) -> sorted, de-duped {u,o,h,l,c,v,oi}. */
export function makeSeries(raw) {
  const bars = (raw || []).map((b) =>
    Array.isArray(b)
      ? { u: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5], oi: b[6] }
      : { u: b.u ?? b.time, o: b.o ?? b.open, h: b.h ?? b.high, l: b.l ?? b.low, c: b.c ?? b.close, v: b.v ?? b.volume, oi: b.oi },
  )
  bars.sort((a, b) => a.u - b.u)
  const out = []
  for (const b of bars) {
    if (out.length && out[out.length - 1].u === b.u) out[out.length - 1] = b // keep last on dup minute
    else out.push(b)
  }
  return { bars: out, times: out.map((x) => x.u) }
}

/** Hard anti-lookahead guard. */
export function assertNoLookahead(u, t) {
  if (u > t) throw new Error(`anti-lookahead violation: bar time ${u} > clock ${t}`)
}

/** Index of the last bar with time <= t (binary search), or -1 if none yet. */
export function lastIndexAtOrBefore(times, t) {
  let lo = 0
  let hi = times.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/**
 * The bar visible at clock t. NEVER returns a bar with u > t.
 *   forwardFill=true  (default) -> last bar at/before t (carry through holes).
 *   forwardFill=false           -> the bar only if one exists exactly at t, else null
 *                                  (mark the strike untradeable for that minute).
 */
export function barAt(series, t, { forwardFill = true } = {}) {
  const i = lastIndexAtOrBefore(series.times, t)
  if (i < 0) return null // no data at/before t yet
  const bar = series.bars[i]
  assertNoLookahead(bar.u, t) // can only fail on a bug — that's the point
  if (!forwardFill && bar.u !== t) return null
  return bar
}

/** Close price visible at clock t (or null). */
export function priceAt(series, t, opts) {
  const b = barAt(series, t, opts)
  return b ? b.c : null
}
