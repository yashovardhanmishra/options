// Strategy payoff analytics (StockMock-style), built on the same Black-Scholes engine.
// PURE: every input (legs, spot grid, T, vols, r) is injected. A "payoff leg" is
//   { strike, type:'CE'|'PE', side:+1|-1, lots, lotSize, entryPrice, sigma }
// where sigma is the leg's frozen IV (for the time-value curve). The money path is the
// same stored-price arithmetic as the rest of the engine: pnl = (mark - entry)·side·qty.
import { bsPrice, intrinsic, normCdf } from './bs.js'

/** Theoretical option mark at spot S for time-to-expiry T (years). T<=0 => intrinsic (expiry). */
export function legMark(leg, S, T, sigma, r) {
  if (!(T > 0) || !(sigma > 0)) return intrinsic(S, leg.strike, leg.type)
  return bsPrice({ S, K: leg.strike, T, r, sigma, type: leg.type })
}

/** Total position P&L at spot S for a valuation { T, r, mult }. T<=0 => at expiry (intrinsic). */
export function pnlAt(legs, S, { T, r = 0.065, mult = 1 } = {}) {
  let pnl = 0
  for (const lg of legs) {
    const mark = legMark(lg, S, T, lg.sigma ?? 0, r)
    pnl += (mark - lg.entryPrice) * lg.side * lg.lotSize * lg.lots * mult
  }
  return pnl
}

/** Sensible spot grid: covers all strikes and ±`sigmas`·expected-move, ≥±`minPct`, `n` points. */
export function spotGrid(S0, strikes, move, { sigmas = 2.6, minPct = 0.06, n = 161 } = {}) {
  let lo = S0 * (1 - minPct)
  let hi = S0 * (1 + minPct)
  if (move > 0) { lo = Math.min(lo, S0 - sigmas * move); hi = Math.max(hi, S0 + sigmas * move) }
  for (const k of strikes || []) { lo = Math.min(lo, k); hi = Math.max(hi, k) }
  const pad = (hi - lo) * 0.04
  lo -= pad; hi += pad
  const out = new Array(n)
  for (let i = 0; i < n; i++) out[i] = lo + ((hi - lo) * i) / (n - 1)
  return out
}

/** Payoff curve over a spot grid: [{ S, expiry, now }] (now = at-clock valuation, Tnow>0). */
export function payoffCurve(legs, spots, { Tnow, r = 0.065, mult = 1 }) {
  return spots.map((S) => ({
    S,
    expiry: pnlAt(legs, S, { T: 0, r, mult }),
    now: pnlAt(legs, S, { T: Tnow, r, mult }),
  }))
}

/** Breakevens = zero crossings of the EXPIRY curve (linear-interpolated). */
export function breakevens(curve) {
  const bes = []
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1].expiry
    const b = curve[i].expiry
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) {
      const f = a / (a - b) // fraction from i-1 to i where expiry P&L = 0
      bes.push(curve[i - 1].S + f * (curve[i].S - curve[i - 1].S))
    }
  }
  return bes
}

/** Max profit / max loss on the EXPIRY curve + unbounded detection from the edge slopes. */
export function extrema(curve) {
  if (!curve || curve.length < 2) {
    const v = curve?.[0]?.expiry ?? 0
    return { maxProfit: v, maxLoss: v, profitUnbounded: false, lossUnbounded: false }
  }
  let maxProfit = -Infinity
  let maxLoss = Infinity
  for (const p of curve) {
    if (p.expiry > maxProfit) maxProfit = p.expiry
    if (p.expiry < maxLoss) maxLoss = p.expiry
  }
  const n = curve.length
  const eps = 1e-4
  const rightSlope = curve[n - 1].expiry - curve[n - 2].expiry // per +dS at the high edge
  const leftSlope = curve[1].expiry - curve[0].expiry // per +dS at the low edge
  const profitUnbounded = rightSlope > eps || leftSlope < -eps // grows up, or grows toward 0
  const lossUnbounded = rightSlope < -eps || leftSlope > eps
  return { maxProfit, maxLoss, profitUnbounded, lossUnbounded }
}

/** Net cash at entry: selling collects (+), buying pays (-). Positive => net credit. */
export function netCredit(legs, mult = 1) {
  return legs.reduce((s, lg) => s + -lg.side * lg.entryPrice * lg.lotSize * lg.lots * mult, 0)
}

const sqrt = Math.sqrt
/** Lognormal CDF P(S_T <= S) with E[S_T]=S0 (zero-drift martingale), vol sigma over T years. */
export function lognormCdf(S, S0, sigma, T) {
  if (!(S > 0) || !(sigma > 0) || !(T > 0)) return S >= S0 ? 1 : 0
  const s = sigma * sqrt(T)
  // ln(S_T/S0) ~ N(-0.5 s^2, s^2) so the mean is S0; CDF uses the standardized log-moneyness.
  return normCdf((Math.log(S / S0) + 0.5 * s * s) / s)
}

/** Probability the EXPIRY P&L is positive, integrating the lognormal over the profit region. */
export function pop(curve, S0, sigma, T) {
  if (!(sigma > 0) || !(T > 0)) return null
  let p = 0
  for (let i = 1; i < curve.length; i++) {
    const mid = (curve[i - 1].expiry + curve[i].expiry) / 2
    if (mid > 0) p += lognormCdf(curve[i].S, S0, sigma, T) - lognormCdf(curve[i - 1].S, S0, sigma, T)
  }
  // tails beyond the grid: include if the edge cells are profitable
  if (curve[0].expiry > 0) p += lognormCdf(curve[0].S, S0, sigma, T)
  if (curve[curve.length - 1].expiry > 0) p += 1 - lognormCdf(curve[curve.length - 1].S, S0, sigma, T)
  return Math.max(0, Math.min(1, p))
}

/** Expected 1σ move (price) over horizon T. */
export const expectedMove = (S0, sigma, T) => (sigma > 0 && T > 0 ? S0 * sigma * sqrt(T) : 0)

/** ±1σ / ±2σ spot levels around S0 over horizon T. */
export function sigmaLevels(S0, sigma, T) {
  const m = expectedMove(S0, sigma, T)
  return { move: m, m1: S0 - m, p1: S0 + m, m2: S0 - 2 * m, p2: S0 + 2 * m }
}

/** Full strategy summary for the stats bar. */
export function strategySummary(legs, { S0, Tnow, Texp, atmIv, r = 0.065, mult = 1 } = {}) {
  if (!legs.length) return null
  const move = expectedMove(S0, atmIv, Texp)
  const spots = spotGrid(S0, legs.map((l) => l.strike), move)
  const curve = payoffCurve(legs, spots, { Tnow, r, mult })
  const ex = extrema(curve)
  const bes = breakevens(curve)
  return {
    curve,
    spots,
    breakevens: bes,
    maxProfit: ex.profitUnbounded ? Infinity : ex.maxProfit,
    maxLoss: ex.lossUnbounded ? -Infinity : ex.maxLoss,
    netCredit: netCredit(legs, mult),
    pop: pop(curve, S0, atmIv, Texp),
    sigma: sigmaLevels(S0, atmIv, Texp),
    atmIv,
  }
}
