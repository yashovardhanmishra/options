// Date-aware contract lot size, keyed by (isMonthly, EXPIRY). NSE applied each lot
// revision to new WEEKLY series before the MONTHLY (and weeklies/monthlies crossed
// on different dates), so the multiplier depends on whether the expiry is a monthly.
// A leg's multiplier is fixed at its expiry's lot, so historical replays across a
// change MTM correctly. Multi-underlying-capable; only NIFTY is populated today.
//
// NIFTY schedule (effective by expiry), per the confirmed spec:
//   < 2024-04-26                      -> 50   (50->25; TODO verify vs NSE contract master if data reaches here)
//   25 -> 75 window:  weekly  >= 2025-01-02 -> 75 else 25
//                     monthly >= 2025-02-27 -> 75 else 25   (30-Jan-2025 monthly = 25; 02-Jan-2025 weekly = 75)
//   75 -> 65 window:  weekly  >= 2026-01-06 -> 65 else 75
//                     monthly >= 2026-01-27 -> 65 else 75   (30-Dec-2025 monthly = 75)
//
// ISO date strings compare lexicographically == chronologically, so plain `>=`
// on 'YYYY-MM-DD' is correct. Cutoffs are ascending; take the latest one reached.
export const SCHEDULES = {
  NIFTY: {
    base: 50,
    weekly: [
      { from: '2024-04-26', lot: 25 },
      { from: '2025-01-02', lot: 75 },
      { from: '2026-01-06', lot: 65 },
    ],
    monthly: [
      { from: '2024-04-26', lot: 25 },
      { from: '2025-02-27', lot: 75 },
      { from: '2026-01-27', lot: 65 },
    ],
  },
}

/**
 * Lot size for an underlying at a given option expiry.
 * @param {string} underlying  e.g. 'NIFTY'
 * @param {string} expiry      'YYYY-MM-DD'
 * @param {boolean} isMonthly  true if this expiry is the monthly contract (latest expiry in its month)
 */
export function lotSize(underlying, expiry, isMonthly = false) {
  const sched = SCHEDULES[String(underlying).toUpperCase()]
  if (!sched) throw new Error(`No lot-size schedule for underlying "${underlying}"`)
  const cutoffs = isMonthly ? sched.monthly : sched.weekly
  let lot = sched.base
  for (const c of cutoffs) {
    if (expiry >= c.from) lot = c.lot
    else break
  }
  return lot
}

/** Set of expiries that are the LATEST in their calendar month (i.e. the monthly contract). */
export function monthlyExpirySet(allExpiries) {
  const byMonth = new Map()
  for (const e of allExpiries || []) {
    const ym = e.slice(0, 7) // 'YYYY-MM'
    const cur = byMonth.get(ym)
    if (!cur || e > cur) byMonth.set(ym, e)
  }
  return new Set(byMonth.values())
}

/** Is `expiry` the monthly contract, given the full expiry list (from /api/expiries)? */
export function isMonthlyExpiry(expiry, allExpiries) {
  return monthlyExpirySet(allExpiries).has(expiry)
}
