// Calendar time-to-expiry in YEARS, derived ONLY from integer second-keys.
//
// IMPORTANT (per project convention): the data's `unix` is an OPAQUE ORDERED
// INTEGER — the IST wall clock encoded as if it were UTC seconds. We never parse
// the clock value through a timezone-aware Date. The expiry instant (15:30 IST on
// the expiry date) is encoded the SAME way via `Date.UTC` (pure UTC component
// math, NOT local time), so subtracting the two integers gives true elapsed
// seconds and the offset cancels. PURE.

const DAY = 86400
const YEAR = 365.25 * DAY

/** 'YYYY-MM-DD' + HH:MM (IST) -> the matching IST-wall-clock-as-UTC integer key. */
export function sessionUnix(dateStr, hour = 0, minute = 0) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d, hour, minute, 0) / 1000)
}

/** The expiry instant key: 15:30 IST on the expiry date (NSE close), by default. */
export function expiryUnix(expiry, { hour = 15, minute = 30 } = {}) {
  return sessionUnix(expiry, hour, minute)
}

/** T in years between the clock and the expiry instant. Negative once past expiry. */
export function yearsToExpiry(clockUnix, expiry, opts) {
  return (expiryUnix(expiry, opts) - clockUnix) / YEAR
}
