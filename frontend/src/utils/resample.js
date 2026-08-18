// Frontend OHLCV+OI resampling and date-range filtering.
//
// Raw candles come from /api/chart as:
//   { time: <unix seconds>, open, high, low, close, volume, oi }
// `time` encodes the IST wall clock as UTC seconds, so flooring by interval
// groups within the IST trading day exactly as a trader expects.

// Interval length in seconds for each timeframe label.
export const INTERVALS = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '10m': 600,
  '15m': 900,
  '20m': 1200,
  '30m': 1800,
  '45m': 2700,
  '1h': 3600,
  '90m': 5400,
  '2h': 7200,
  '1D': 86400,
}

export const TIMEFRAMES = ['1m', '3m', '5m', '10m', '15m', '20m', '30m', '45m', '1h', '90m', '2h', '1D']

/**
 * Parse any timeframe label to seconds: '5m', '90m', '2h', '1D', or a bare
 * number ('7' -> 7 minutes) for the custom box. Falls back to the INTERVALS map.
 */
export function tfToSeconds(tf) {
  const s = String(tf ?? '').trim().toLowerCase()
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs|hour|hours|d|day|days)?$/)
  if (!m) return INTERVALS[tf] ?? 60
  const n = parseFloat(m[1])
  const u = m[2] || 'm'
  if (u[0] === 'h') return Math.round(n * 3600)
  if (u[0] === 'd') return Math.round(n * 86400)
  return Math.round(n * 60)
}

/**
 * Resample raw 1-minute candles into `tf`.
 * Aggregation per bucket: open=first, high=max, low=min, close=last,
 * volume=sum, oi=last. Output is ascending and unique (lightweight-charts safe).
 */
// NSE cash/index session opens at 09:15 IST. Intraday bars are anchored to that
// open (09:15–10:15, 10:15–11:15, …) rather than the clock hour, matching how
// Indian charting platforms bucket intraday candles.
//
// The window is a PARAMETER because not every instrument trades NSE hours: MCX energy
// (natural gas) runs 09:00 → 23:30/23:55 IST. Every caller that omits it gets the NSE
// window, so the option-chain + Nifty-spot charts are unchanged.
// A session spans [openSec, openSec + lenSec). The closing print is the CLOSE tick, not
// the open of a new bar — some days include it, some don't. Fold it (and anything after)
// into the last in-session bar so it never spawns a lone closing candle on timeframes
// where lenSec is a whole multiple of the step.
export const NSE_SESSION = {
  openSec: 9 * 3600 + 15 * 60, // 33300 (09:15 from IST midnight)
  lenSec: 6 * 3600 + 15 * 60, // 22500 (09:15 → 15:30)
}
// MCX energy (natural gas): 09:00 IST through end of day — covers both the 23:30 winter
// close and the 23:55 summer close without truncating either.
export const MCX_ENERGY_SESSION = {
  openSec: 9 * 3600, // 32400 (09:00)
  lenSec: 15 * 3600, // 09:00 → 24:00
}

// Start of the bucket `time` falls into for interval `step` (seconds). Intraday
// (< 1 day) anchors to each IST day's session open; daily and above floor to IST
// midnight (the calendar trading day).
export function bucketStart(time, step, session = NSE_SESSION) {
  if (step >= 86400) return Math.floor(time / step) * step
  const dayStart = Math.floor(time / 86400) * 86400
  const open = dayStart + session.openSec
  const off = time - open
  if (off < 0) return open // fold any pre-open ticks into the first session bar
  // Clamp to the last bucket that OPENS inside the session so the closing print folds
  // into it (e.g. NSE 15m: last open = 15:15, never a fresh 15:30 bar).
  const lastOff = Math.floor((session.lenSec - 1) / step) * step
  return open + Math.min(Math.floor(off / step) * step, lastOff)
}

export function resample(raw, tf, session = NSE_SESSION) {
  if (!raw || raw.length === 0) return []

  const step = tfToSeconds(tf)
  if (!step || step <= 60) return raw // 1-minute (or finer) = passthrough

  const buckets = new Map()
  const order = []

  for (const c of raw) {
    // Anchor intraday buckets to the session open (1D -> IST midnight).
    const bt = bucketStart(c.time, step, session)
    let b = buckets.get(bt)
    if (!b) {
      b = {
        time: bt,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: 0,
        oi: c.oi,
      }
      buckets.set(bt, b)
      order.push(bt)
    } else {
      if (c.high > b.high) b.high = c.high
      if (c.low < b.low) b.low = c.low
      b.close = c.close // last in the group
      b.oi = c.oi // last in the group
    }
    b.volume += c.volume
  }

  // `order` is already ascending because `raw` is ascending.
  return order.map((t) => buckets.get(t))
}

/**
 * Keep candles whose time is within [fromSec, toSec]. Null bound = open-ended.
 */
export function filterByRange(data, fromSec, toSec) {
  if (fromSec == null && toSec == null) return data
  return data.filter(
    (c) =>
      (fromSec == null || c.time >= fromSec) &&
      (toSec == null || c.time <= toSec),
  )
}

/**
 * Convert a <input type="date"> value ("YYYY-MM-DD") to unix seconds in the
 * same wall-clock-as-UTC space used by the candle data.
 * endOfDay=true returns 23:59:59 so a TO date is inclusive of its whole day.
 */
export function dateStrToSec(s, endOfDay = false) {
  if (!s) return null
  const ms = Date.parse(s + 'T00:00:00Z')
  if (Number.isNaN(ms)) return null
  return Math.floor(ms / 1000) + (endOfDay ? 86399 : 0)
}

/**
 * Inverse of dateStrToSec — unix seconds -> "YYYY-MM-DD" (UTC parts).
 * Used to seed the date pickers from the loaded data's span.
 */
export function secToDateStr(sec) {
  if (sec == null) return ''
  return new Date(sec * 1000).toISOString().slice(0, 10)
}
