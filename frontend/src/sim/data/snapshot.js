// Builds the single source of truth for the replay: a per-minute snapshot that is a
// pure function of the clock t. Everything (chain prices, S for Greeks, held-leg
// prices) comes from bars with time <= t only — anti-lookahead is enforced in
// series.barAt. The engine never reads bars directly; it consumes this snapshot.
import { makeSeries, barAt } from './series.js'
import { monthlyExpirySet, lotSize } from '../config/lotsize.js'

/**
 * Preload a replay session into clock-indexable series.
 * @param {object} a
 * @param {string} a.expiry         the chain's expiry ('YYYY-MM-DD')
 * @param {string} [a.underlying='NIFTY']
 * @param {Array}  a.spotBars       index 1-min bars ([u,o,h,l,c,v] or {…})
 * @param {Array}  a.instruments    [{ strike, type:'CE'|'PE', bars:[[u,o,h,l,c,v,oi],…] }]
 * @param {string[]} [a.expiries]   full expiry list (for the monthly/weekly lot split)
 * @param {number} [a.r=0.065]      risk-free rate
 */
export function buildSession({ expiry, underlying = 'NIFTY', spotBars, instruments, expiries, r = 0.065 }) {
  const spot = makeSeries(spotBars)
  const inst = new Map()
  const strikeSet = new Set()
  for (const it of instruments || []) {
    inst.set(`${it.strike}${it.type}`, makeSeries(it.bars))
    strikeSet.add(it.strike)
  }
  const strikes = [...strikeSet].sort((a, b) => a - b)
  const monthly = monthlyExpirySet(expiries && expiries.length ? expiries : [expiry])
  return { expiry, underlying, r, spot, inst, strikes, monthly }
}

/**
 * Snapshot at clock t. Uses ONLY bars with time <= t.
 * Returns { clockUnix, S, spot, chain:[{strike, ce, pe}], priceFor(leg), barFor(leg) }
 * where ce/pe = { ltp, oi, volume, u } | null.
 */
export function snapshotAt(session, t, { forwardFill = true, chain = true } = {}) {
  const sBar = barAt(session.spot, t, { forwardFill })
  const S = sBar ? sBar.c : null

  const side = (strike, type) => {
    const s = session.inst.get(`${strike}${type}`)
    if (!s) return null
    const b = barAt(s, t, { forwardFill })
    return b ? { ltp: b.c, oi: b.oi, volume: b.v, u: b.u } : null
  }

  // The 256-strike chain is only for DISPLAY. The engine (book / curve / risk) needs only
  // S + priceFor(leg), so callers driving the replay pass { chain: false } to skip building
  // it — that keeps a full-timeline re-run cheap (no per-bar 256-row allocation).
  const chainArr = chain
    ? session.strikes.map((strike) => ({ strike, ce: side(strike, 'CE'), pe: side(strike, 'PE') }))
    : null

  const barFor = (leg) => {
    const s = session.inst.get(`${leg.strike}${leg.type}`)
    return s ? barAt(s, t, { forwardFill }) : null
  }

  return {
    clockUnix: t,
    S,
    spot: S,
    chain: chainArr,
    barFor,
    priceFor: (leg) => {
      const b = barFor(leg)
      return b ? b.c : null
    },
  }
}

/** Engine context for a snapshot: { r, clockUnix, spot, lotSizeFor }. */
export function makeContext(session, snap) {
  return {
    r: session.r,
    clockUnix: snap.clockUnix,
    spot: snap.S,
    lotSizeFor: (leg) =>
      lotSize(leg.underlying || session.underlying, leg.expiry, session.monthly.has(leg.expiry)),
  }
}
