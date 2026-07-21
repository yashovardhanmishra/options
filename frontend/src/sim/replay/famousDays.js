// Curated "famous" NIFTY trading days (big moves / events) for the replay sim's
// "Replay a famous day" picker, plus a deterministic daily-challenge picker. PURE — no I/O.
// Dates are ISO 'YYYY-MM-DD' (IST). The sim resolves each to its weekly expiry + seeks to the
// day's open; days outside the loaded dataset land on the nearest available data.

export const FAMOUS_DAYS = [
  { date: '2024-06-04', label: 'Election Result Crash', note: 'NIFTY -5.9% as the mandate surprised; huge intraday whipsaw.' },
  { date: '2024-06-03', label: 'Exit-Poll Rally', note: 'NIFTY +3.3% on exit-poll euphoria — the day before the crash.' },
  { date: '2024-08-05', label: 'Global Selloff', note: 'Yen carry-trade unwind; NIFTY gapped down ~-2.7%.' },
  { date: '2022-02-24', label: 'Russia–Ukraine War', note: 'Invasion day; NIFTY -4.8% on the open.' },
  { date: '2021-02-01', label: 'Budget Rally', note: 'Union Budget 2021; NIFTY +4.7%, one of the best budget days.' },
  { date: '2021-11-26', label: 'Omicron Scare', note: 'New-variant fear; NIFTY -2.9% in a sharp risk-off.' },
  { date: '2020-03-23', label: 'COVID Crash Low', note: 'Pandemic capitulation; NIFTY -13% intraday to the bottom.' },
  { date: '2020-03-24', label: 'COVID Bounce', note: 'Stimulus hopes; NIFTY +6.6% off the low.' },
  { date: '2020-04-07', label: 'Lockdown Rally', note: 'NIFTY +8.8% on flattening-curve hopes.' },
  { date: '2023-09-15', label: 'Record-High Run', note: 'NIFTY pushing all-time highs in a strong trend day.' },
]

/** Mulberry32 — tiny deterministic PRNG (same family as the backtest Monte-Carlo). */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Hash a string to a 32-bit seed (FNV-1a). */
function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Deterministic "daily challenge" pick: the SAME day for everyone on a given calendar date,
 * drawn from the supplied available dates. `seedStr` = today's date 'YYYY-MM-DD' (caller passes
 * it so this stays pure/testable). Returns null when there are no dates.
 */
export function dailyChallengeDate(availableDates, seedStr) {
  const dates = (availableDates ?? []).filter(Boolean)
  if (!dates.length) return null
  const rand = mulberry32(hashStr(seedStr || 'challenge'))
  return dates[Math.floor(rand() * dates.length)]
}
