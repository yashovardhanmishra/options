// Action constructors for the position log. Every action is stamped with the clock
// `t` it fired at and carries the fill price(s) captured from the snapshot at that t,
// so the log is a self-contained, deterministic record (replaying it byte-for-byte
// reproduces the book). PURE data builders — no I/O, no mutation of prior actions.

export const entry = ({ t, legId, underlying = 'NIFTY', expiry, strike, type, side, lots, groupId = null, price, kind = 'entry' }) =>
  ({ type: kind, t, legId, leg: { underlying, expiry, strike, type, side, lots, groupId }, price })

/** A hedge is an entry of an offsetting leg into an existing group (tagged for the log). */
export const hedge = (a) => entry({ ...a, kind: 'hedge' })

// deltaLots > 0 = average in (re-bases entry to the weighted average);
// deltaLots < 0 = partial close (realizes P&L on the closed lots; remaining keep entry).
export const adjust = ({ t, legId, deltaLots, price }) => ({ type: 'adjust', t, legId, deltaLots, price })
export const addLots = ({ t, legId, lots, price }) => adjust({ t, legId, deltaLots: Math.abs(lots), price })
export const reduceLots = ({ t, legId, lots, price }) => adjust({ t, legId, deltaLots: -Math.abs(lots), price })

/** Atomic roll: close `legId` at closePrice + open `open` at openPrice, at ONE t. */
export const roll = ({ t, legId, closePrice, open, openPrice }) =>
  ({ type: 'roll', t, legId, closePrice, open, openPrice })

// Exit at leg / group / portfolio scope. `prices` maps each closed legId -> fill price
// (captured from the snapshot at t for every open leg in scope). An auto-liquidation
// passes reason:'risk_breach' + meta {scope,metric,value,limit} (tagged through to the log).
const withReason = (action, reason, meta) => (reason ? { ...action, reason, meta } : action)
export const exitLeg = ({ t, legId, price, reason, meta }) =>
  withReason({ type: 'exit', t, scope: { kind: 'leg', id: legId }, prices: { [legId]: price } }, reason, meta)
export const exitGroup = ({ t, groupId, prices, reason, meta }) =>
  withReason({ type: 'exit', t, scope: { kind: 'group', id: groupId }, prices }, reason, meta)
export const exitPortfolio = ({ t, prices, reason, meta }) =>
  withReason({ type: 'exit', t, scope: { kind: 'portfolio' }, prices }, reason, meta)

/** Turn template leg specs into entry actions at clock t, pricing each via priceFor. */
export function entriesFromSpecs(specs, { t, priceFor, nextId }) {
  return specs.map((spec) => entry({ t, legId: nextId(), ...spec, price: priceFor(spec) }))
}
