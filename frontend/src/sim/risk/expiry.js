// Expiry settlement. At the expiry bar (the last bar of `expiry`'s date in the timeline —
// the 15:30 NSE settlement), every open leg of that expiry settles at INTRINSIC computed
// from the spot at that bar (max(S-K,0) for CE, max(K-S,0) for PE), OVERRIDING the last
// traded premium. Settlement is a normal stamped exit action (reason:'expiry') in the same
// log, so realized P&L and the equity curve stay coherent and scrub-reversible.
// Idempotent: after settlement the legs are flat, so re-evaluating the bar appends nothing.
import { foldActions, openLegs } from '../portfolio/fold.js'
import { exitPortfolio } from '../portfolio/actions.js'
import { intrinsic } from '../engine/bs.js'

export function evaluateExpiry({ actions, t, expiry, expiryBarUnix, spot, lotSizeFor }) {
  if (expiryBarUnix == null || t !== expiryBarUnix) return { actions: [] }
  if (spot == null || Number.isNaN(spot)) return { actions: [] }
  const expiring = openLegs(foldActions(actions, t, lotSizeFor)).filter((l) => l.expiry === expiry)
  if (!expiring.length) return { actions: [] }
  const prices = {}
  for (const leg of expiring) prices[leg.id] = intrinsic(spot, leg.strike, leg.type)
  // single-expiry: all open legs are this expiry, so exitPortfolio closes them all at
  // intrinsic. (Multi-expiry would need a per-expiry scope — deferred.)
  return { actions: [exitPortfolio({ t, prices, reason: 'expiry', meta: { kind: 'settlement', spot } })] }
}
