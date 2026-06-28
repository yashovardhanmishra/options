// Position model + leg→group→portfolio aggregation. The MONEY path (mtm.js) and
// the RISK path (iv.js + bs.js) are computed side-by-side here but never cross:
// P&L is the stored-price arithmetic, Greeks are model-derived. PURE — all inputs
// (the leg's price_now at the clock, spot, r, lot size) are INJECTED, never fetched.
//
// Leg:   { id?, underlying, expiry, strike, type:'CE'|'PE', side:+1|-1, lots, entry_price/entryPrice, group_id? }
// ctx:   { r, clockUnix, spot, lotSizeFor(leg)->number }
import { legPnl } from './mtm.js'
import { greeks } from './bs.js'
import { impliedVol } from './iv.js'
import { yearsToExpiry } from './time.js'

const entryOf = (leg) => (leg.entryPrice ?? leg.entry_price)

/**
 * Full state of one leg at the clock, given its market price_now (from the snapshot).
 * Returns money (mtm) and risk (iv + position-scaled greeks) without mixing them.
 */
export function legState(leg, priceNow, ctx) {
  const { r, clockUnix, spot } = ctx
  const lotSize = ctx.lotSizeFor(leg)
  const { side, lots, strike: K, type, expiry } = leg
  const T = yearsToExpiry(clockUnix, expiry)

  // MONEY (exact, no model)
  const mtm = legPnl({ entryPrice: entryOf(leg), priceNow, side, lotSize, lots })

  // RISK (model): back out IV from the stored price, then Greeks, then scale to size.
  const { sigma: iv, degenerate } = impliedVol({ S: spot, K, T, r, price: priceNow, type })
  const per = greeks({ S: spot, K, T, r, sigma: iv, type })
  const scale = lotSize * lots * side // position_greek = per_option × lot × lots × side
  const positionGreeks = {
    delta: per.delta * scale,
    gamma: per.gamma * scale,
    vega: per.vega * scale,
    theta: per.theta * scale,
  }

  return { leg, priceNow, lotSize, T, mtm, iv, degenerate, perOption: per, greeks: positionGreeks }
}

const ZERO = () => ({ delta: 0, gamma: 0, vega: 0, theta: 0 })

export function sumGreeks(states) {
  return states.reduce((a, s) => {
    a.delta += s.greeks.delta
    a.gamma += s.greeks.gamma
    a.vega += s.greeks.vega
    a.theta += s.greeks.theta
    return a
  }, ZERO())
}

export const sumMtm = (states) => states.reduce((a, s) => a + s.mtm, 0)

/** Aggregate a list of leg-states into a group/portfolio summary. */
export function aggregate(states) {
  return { mtm: sumMtm(states), greeks: sumGreeks(states), legs: states }
}
