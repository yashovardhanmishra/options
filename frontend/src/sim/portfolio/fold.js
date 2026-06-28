// The position fold: reduce the ordered action log (only actions with t <= clock) into
// the book state — open legs + realized P&L. This is the single source of truth; there
// is no free-floating mutable position. Realized uses the EXACT money path (no model).
// Each call builds fresh state, so reading at any clock is coherent and idempotent
// (a close folds exactly once; scrubbing back un-realizes it).
import { legPnl } from '../engine/mtm.js'

const inScope = (leg, scope) =>
  scope.kind === 'portfolio' ? true : scope.kind === 'group' ? leg.groupId === scope.id : leg.id === scope.id

/**
 * @param {Array} actions     append-ordered action log (fire order).
 * @param {number} t          clock unix; only actions with action.t <= t are applied.
 * @param {(leg)=>number} lotSizeFor  contract multiplier for a leg (by underlying+expiry).
 */
export function foldActions(actions, t, lotSizeFor) {
  const state = { legs: new Map(), realized: 0, realizedByLeg: new Map(), realizedByGroup: new Map(), events: [] }

  const realize = (leg, pnl) => {
    state.realized += pnl
    state.realizedByLeg.set(leg.id, (state.realizedByLeg.get(leg.id) || 0) + pnl)
    if (leg.groupId != null) state.realizedByGroup.set(leg.groupId, (state.realizedByGroup.get(leg.groupId) || 0) + pnl)
  }
  const openLeg = (legId, spec, price, kind, ts) => {
    state.legs.set(legId, {
      id: legId, underlying: spec.underlying ?? 'NIFTY', expiry: spec.expiry, strike: spec.strike,
      type: spec.type, side: spec.side, lots: spec.lots, groupId: spec.groupId ?? null,
      entryPrice: price, open: true, openedAt: ts, kind,
    })
  }
  const closeFull = (leg, price) => {
    const pnl = legPnl({ entryPrice: leg.entryPrice, priceNow: price, side: leg.side, lotSize: lotSizeFor(leg), lots: leg.lots })
    realize(leg, pnl)
    leg.lots = 0
    leg.open = false
    return pnl
  }

  for (const a of actions) {
    if (a.t > t) continue
    switch (a.type) {
      case 'entry':
      case 'hedge': {
        openLeg(a.legId, a.leg, a.price, a.type, a.t)
        state.events.push({ t: a.t, type: a.type, legId: a.legId, lots: a.leg.lots, price: a.price })
        break
      }
      case 'adjust': {
        const leg = state.legs.get(a.legId)
        if (!leg || !leg.open) break
        if (a.deltaLots > 0) {
          // average in -> weighted-average entry; lots increase
          const add = a.deltaLots
          leg.entryPrice = (leg.lots * leg.entryPrice + add * a.price) / (leg.lots + add)
          leg.lots += add
          state.events.push({ t: a.t, type: 'add', legId: leg.id, lots: add, price: a.price, entryPrice: leg.entryPrice })
        } else if (a.deltaLots < 0) {
          // partial close -> realize on the closed lots; remaining KEEP original entry
          const closeQty = Math.min(leg.lots, -a.deltaLots)
          const pnl = legPnl({ entryPrice: leg.entryPrice, priceNow: a.price, side: leg.side, lotSize: lotSizeFor(leg), lots: closeQty })
          realize(leg, pnl)
          leg.lots -= closeQty
          if (leg.lots <= 0) leg.open = false
          state.events.push({ t: a.t, type: 'reduce', legId: leg.id, lots: closeQty, price: a.price, realized: pnl })
        }
        break
      }
      case 'roll': {
        // atomic at ONE t: close old leg (realize), open new leg
        const old = state.legs.get(a.legId)
        const closeRealized = old && old.open ? closeFull(old, a.closePrice) : 0
        openLeg(a.open.legId, a.open, a.openPrice, 'roll', a.t)
        state.events.push({ t: a.t, type: 'roll', closedLegId: a.legId, openedLegId: a.open.legId, closeRealized, closePrice: a.closePrice, openPrice: a.openPrice })
        break
      }
      case 'exit': {
        const targets = [...state.legs.values()].filter((l) => l.open && l.lots > 0 && inScope(l, a.scope))
        let total = 0
        const ids = []
        const skipped = []
        for (const leg of targets) {
          const price = a.prices?.[leg.id]
          if (price == null) { skipped.push(leg.id); continue } // no fill captured -> leave open (surfaced)
          total += closeFull(leg, price)
          ids.push(leg.id)
        }
        state.events.push({
          t: a.t, type: 'exit', scope: a.scope, legIds: ids, realized: total,
          ...(skipped.length ? { skipped } : {}),
          ...(a.reason ? { reason: a.reason, meta: a.meta } : {}),
        })
        break
      }
    }
  }
  return state
}

export const openLegs = (folded) => [...folded.legs.values()].filter((l) => l.open && l.lots > 0)
