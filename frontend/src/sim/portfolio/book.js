// The full book at clock t: ties the action-log fold (realized + open legs) to the
// snapshot at t (unrealized P&L + Greeks for the open legs) and aggregates leg ->
// group -> portfolio. Money path stays exact; Greeks are model-derived (per step 1).
import { foldActions, openLegs } from './fold.js'
import { legState, sumGreeks } from '../engine/portfolio.js'

/**
 * @param {object} a
 * @param {Array}  a.actions   the position action log.
 * @param {number} a.t         clock unix.
 * @param {object} a.snapshot  snapshotAt(t) — provides priceFor(leg) and S.
 * @param {object} a.ctx       engine context { r, clockUnix, spot, lotSizeFor }.
 */
export function portfolioAt({ actions, t, snapshot, ctx }) {
  const folded = foldActions(actions, t, ctx.lotSizeFor)
  // A leg with no price at t (untradeable this minute — e.g. a 1-min hole when forward-
  // fill is off) can't be MTM'd, risk-checked, or squared off. Exclude it from Greeks/
  // unrealized and surface it separately, so it never poisons the totals (NaN) or hides a
  // breach on the priceable legs, and so the auto-liquidation fixpoint always converges.
  const untradeable = []
  const states = []
  for (const leg of openLegs(folded)) {
    const price = snapshot.priceFor(leg)
    if (price == null || Number.isNaN(price)) untradeable.push(leg)
    else states.push(legState(leg, price, ctx))
  }
  const unrealized = states.reduce((s, x) => s + x.mtm, 0)
  const greeks = sumGreeks(states)

  // Only real groups appear in the per-group breakdown; ungrouped legs (groupId=null)
  // still feed the portfolio totals above, but don't form a synthetic "null" group.
  const groupIds = new Set([...states.map((s) => s.leg.groupId).filter((id) => id != null), ...folded.realizedByGroup.keys()])
  const groups = [...groupIds].map((groupId) => {
    const gs = states.filter((s) => s.leg.groupId === groupId)
    const u = gs.reduce((sum, x) => sum + x.mtm, 0)
    const r = folded.realizedByGroup.get(groupId) || 0
    return { groupId, realized: r, unrealized: u, total: r + u, greeks: sumGreeks(gs), legs: gs }
  })

  return {
    clockUnix: t,
    realized: folded.realized,
    unrealized,
    total: folded.realized + unrealized,
    greeks,
    groups,
    openLegs: states,
    untradeable, // open legs with no price at t (excluded from Greeks/MTM; can't be squared off)
    events: folded.events,
    folded,
  }
}
