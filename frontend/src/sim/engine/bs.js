// Black-Scholes on SPOT (no dividend). PURE functions — no I/O, no model state.
// Conventions (match the feature spec exactly):
//   - T in YEARS (calendar, /365.25 — computed in time.js).
//   - type: 'CE' (call) | 'PE' (put).
//   - Greeks are PER-OPTION (one contract unit, before lot/lots/side scaling):
//       theta is per CALENDAR day, vega is per 1 vol-point (1% IV).
// This is the RISK path. It must never be used to produce P&L (see mtm.js).

const SQRT2PI = Math.sqrt(2 * Math.PI)

const isCall = (type) => String(type).toUpperCase() === 'CE'

/** Standard normal PDF: exp(-x²/2)/√(2π). */
export function normPdf(x) {
  return Math.exp(-0.5 * x * x) / SQRT2PI
}

/** Standard normal CDF — Zelen & Severo (A&S 26.2.17) rational approx, |err| < 7.5e-8. */
export function normCdf(x) {
  if (x < 0) return 1 - normCdf(-x)
  const t = 1 / (1 + 0.2316419 * x)
  const poly =
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return 1 - normPdf(x) * poly
}

/** Undiscounted spot intrinsic value (used to settle at/after expiry). */
export function intrinsic(S, K, type) {
  return isCall(type) ? Math.max(0, S - K) : Math.max(0, K - S)
}

function d1d2(S, K, T, r, sigma) {
  const vsqrt = sigma * Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / vsqrt
  return { d1, d2: d1 - vsqrt, vsqrt }
}

/**
 * BS price of one option.
 *   T <= 0      -> spot intrinsic (settlement value at/after expiry).
 *   sigma <= 0  -> the σ→0 limit = discounted (forward) intrinsic.
 */
export function bsPrice({ S, K, T, r, sigma, type }) {
  if (T <= 0) return intrinsic(S, K, type)
  const disc = K * Math.exp(-r * T)
  if (sigma <= 0) return isCall(type) ? Math.max(0, S - disc) : Math.max(0, disc - S)
  const { d1, d2 } = d1d2(S, K, T, r, sigma)
  return isCall(type)
    ? S * normCdf(d1) - disc * normCdf(d2)
    : disc * normCdf(-d2) - S * normCdf(-d1)
}

/**
 * Per-option Greeks { price, delta, gamma, vega, theta }.
 * Degenerate case (expired or no time value): delta = intrinsic sign, higher-order = 0,
 * so the model never blows up (e.g. ATM gamma as σ→0).
 */
export function greeks({ S, K, T, r, sigma, type }) {
  if (T <= 0 || sigma <= 0) {
    const disc = K * Math.exp(-r * Math.max(T, 0))
    const itm = isCall(type) ? S > disc : disc > S
    const delta = itm ? (isCall(type) ? 1 : -1) : 0
    return { price: bsPrice({ S, K, T, r, sigma, type }), delta, gamma: 0, vega: 0, theta: 0 }
  }
  const { d1, d2, vsqrt } = d1d2(S, K, T, r, sigma)
  const disc = K * Math.exp(-r * T)
  const nd1 = normPdf(d1)
  const sqrtT = Math.sqrt(T)
  const call = isCall(type)
  const delta = call ? normCdf(d1) : normCdf(d1) - 1
  const gamma = nd1 / (S * vsqrt)
  const vega = (S * nd1 * sqrtT) / 100 // per 1% IV
  const theta =
    (call
      ? -((S * nd1 * sigma) / (2 * sqrtT)) - r * disc * normCdf(d2)
      : -((S * nd1 * sigma) / (2 * sqrtT)) + r * disc * normCdf(-d2)) / 365 // per calendar day
  return { price: bsPrice({ S, K, T, r, sigma, type }), delta, gamma, vega, theta }
}
