// Greeks-based auto-liquidation. Runs on every evaluated bar: folds the current log at
// clock t, checks each scope's Greeks against its limits, and on breach APPENDS a normal
// exit action (tagged risk_breach) at t — squaring off the breaching scope at the stored
// snapshot prices (exact money path). State stays state = fold(actions <= t).
//
// SELF-IDEMPOTENT: the check folds the current log, which already includes any breach exit
// at this bar, so a flat scope (Greeks 0) can't re-breach -> re-evaluating the same bar
// appends nothing. A fixpoint loop liquidates cascading scopes, all stamped at t.
import { checkLimits } from '../engine/risk.js'
import { exitPortfolio, exitGroup } from '../portfolio/actions.js'
import { portfolioAt } from '../portfolio/book.js'

const pricesOf = (legStates) => Object.fromEntries(legStates.map((s) => [s.leg.id, s.priceNow]))

/** Build the bookAt(log, t) used by the risk engine from the real snapshot + context. */
export const makeBookAt = ({ snapshotAt, ctxAt }) => (log, t) =>
  portfolioAt({ actions: log, t, snapshot: snapshotAt(t), ctx: ctxAt(t) })

/**
 * @param {object} a
 * @param {Array}  a.actions   the position action log.
 * @param {number} a.t         clock unix (this bar).
 * @param {object} a.limits    { portfolio:{delta?,gamma?,vega?,theta?}, groups:{[id]:{...}} } — each limit a max |value| or null=off.
 * @param {(log,t)=>book} a.bookAt  -> { greeks, groups:[{groupId,greeks,legs:[legState]}], openLegs:[legState] }
 * @returns {{ actions:Array, breaches:Array, warnings:Array }} actions = breach exits to APPEND.
 */
export function evaluateRisk({ actions, t, limits = {}, bookAt, warnPct = 0.8, maxRounds = 64 }) {
  const pfLimits = limits.portfolio || {}
  const grpLimits = limits.groups || {}
  const newActions = []
  const breaches = []
  let working = actions
  let converged = false

  for (let round = 0; round < maxRounds; round++) {
    const book = bookAt(working, t)

    // Portfolio scope first (the biggest hammer — squares off everything).
    const pf = checkLimits(book.greeks, pfLimits, warnPct)
    if (pf.breached) {
      const b = pf.breaches[0]
      const act = exitPortfolio({ t, prices: pricesOf(book.openLegs), reason: 'risk_breach', meta: { scope: 'portfolio', metric: b.metric, value: b.value, limit: b.limit } })
      newActions.push(act)
      breaches.push({ scope: 'portfolio', metric: b.metric, value: b.value, limit: b.limit, t })
      working = [...working, act]
      continue
    }

    // Then each group scope; re-fold after each fire so a flat group can't re-trip.
    let fired = false
    for (const g of book.groups) {
      const gc = checkLimits(g.greeks, grpLimits[g.groupId] || {}, warnPct)
      if (gc.breached) {
        const b = gc.breaches[0]
        const act = exitGroup({ t, groupId: g.groupId, prices: pricesOf(g.legs), reason: 'risk_breach', meta: { scope: 'group', groupId: g.groupId, metric: b.metric, value: b.value, limit: b.limit } })
        newActions.push(act)
        breaches.push({ scope: 'group', groupId: g.groupId, metric: b.metric, value: b.value, limit: b.limit, t })
        working = [...working, act]
        fired = true
        break
      }
    }
    if (!fired) { converged = true; break }
  }

  // Near-limit warnings on the final (stable) book — decision-only, no action.
  const finalBook = bookAt(working, t)
  const warnings = []
  if (!converged) warnings.push({ scope: 'engine', metric: 'convergence', note: 'risk fixpoint hit maxRounds without stabilizing' })
  for (const w of checkLimits(finalBook.greeks, pfLimits, warnPct).warnings) warnings.push({ scope: 'portfolio', ...w })
  for (const g of finalBook.groups) {
    for (const w of checkLimits(g.greeks, grpLimits[g.groupId] || {}, warnPct).warnings) warnings.push({ scope: 'group', groupId: g.groupId, ...w })
  }

  // Open legs that couldn't be priced this minute (can't be risk-checked or squared off).
  return { actions: newActions, breaches, warnings, untradeable: finalBook.untradeable || [] }
}
