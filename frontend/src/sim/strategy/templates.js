// Strategy templates: one-click builders that return the LEG SPECS of a common
// structure for a chosen expiry/strikes/lots into a (new) group. The caller assigns a
// legId and captures the fill price from the snapshot (see actions.entriesFromSpecs).
// PURE — no ids, no prices, no I/O. side: +1 long, -1 short.
const leg = (groupId, expiry, type, side, strike, lots) =>
  ({ underlying: 'NIFTY', groupId, expiry, type, side, strike, lots })

/** Vertical spread: long + short, same type, two strikes. */
export const vertical = ({ groupId, expiry, type, longStrike, shortStrike, lots = 1 }) => [
  leg(groupId, expiry, type, 1, longStrike, lots),
  leg(groupId, expiry, type, -1, shortStrike, lots),
]

/** Straddle: CE + PE at one strike (short by default). */
export const straddle = ({ groupId, expiry, strike, lots = 1, side = -1 }) => [
  leg(groupId, expiry, 'CE', side, strike, lots),
  leg(groupId, expiry, 'PE', side, strike, lots),
]

/** Strangle: CE + PE at two strikes (short by default). */
export const strangle = ({ groupId, expiry, callStrike, putStrike, lots = 1, side = -1 }) => [
  leg(groupId, expiry, 'CE', side, callStrike, lots),
  leg(groupId, expiry, 'PE', side, putStrike, lots),
]

/** Iron condor: short inner strangle + long outer wings (4 legs). */
export const ironCondor = ({ groupId, expiry, putLong, putShort, callShort, callLong, lots = 1 }) => [
  leg(groupId, expiry, 'PE', 1, putLong, lots),
  leg(groupId, expiry, 'PE', -1, putShort, lots),
  leg(groupId, expiry, 'CE', -1, callShort, lots),
  leg(groupId, expiry, 'CE', 1, callLong, lots),
]

/** Butterfly: 1 long low, 2 short mid, 1 long high — same type. */
export const butterfly = ({ groupId, expiry, type, low, mid, high, lots = 1 }) => [
  leg(groupId, expiry, type, 1, low, lots),
  leg(groupId, expiry, type, -1, mid, 2 * lots),
  leg(groupId, expiry, type, 1, high, lots),
]

export const TEMPLATES = { vertical, straddle, strangle, ironCondor, butterfly }
