// Indian NSE F&O margin estimator (SPAN + Exposure approximation) + position sizing.
// PURE — mirrors engine/risk.js, no I/O, no React, unit-testable.
//
// Real SPAN is a scenario grid the exchange revises ~6×/day; we approximate it as a % of
// NOTIONAL (underlying value = spot × lot size). Calibration: selling one NIFTY lot currently
// needs ≈ ₹1.1–1.2 lakh against ≈ ₹18–19 lakh notional (NIFTY ~25,000 × 75) → total
// SPAN+exposure ≈ 6.5%; exposure is 2%, so SPAN ≈ 4.5%. SPAN also NETS offsetting short
// sides: a big up-move hurts short calls while helping short puts (and vice-versa), so the
// binding scenario for a short straddle/strangle is the larger side plus a fraction of the
// other (gamma/pin risk) — NOT the naive 2× sum. Long options need only the premium paid.
// A fully-hedged, defined-risk group is capped at its payoff max-loss (the broker's hedge
// benefit). These numbers are ESTIMATES; the UI labels them as such.
//
// Sources: NSE Clearing margins; Zerodha/5paisa "SPAN & exposure margin" notes (exposure =
// 2% of contract value for index option selling; hedged spreads charged ≈ their max loss).

export const SPAN_PCT = 0.045 // SPAN ≈ 4.5% of notional for a short index option
export const EXPOSURE_PCT = 0.02 // NSE exposure margin = 2% of contract notional
export const SPAN_OFFSET = 0.5 // share of the offsetting short side that still adds SPAN

const qtyOf = (leg, lotSize, mult) => Math.abs(leg.lots || 0) * (lotSize || 0) * (mult || 1)

/**
 * Per-leg breakdown.
 *   LONG  (side>0): margin = premium paid (no SPAN/exposure).
 *   SHORT (side<0): exposure = 2% of spot notional; standalone SPAN = SPAN_PCT × notional,
 *                   floored at the option's own premium (deep-ITM shorts). The PORTFOLIO SPAN
 *                   is recomputed with directional netting in aggregate() — the per-leg `span`
 *                   here is the single-leg figure (used standalone / for the breakdown).
 * @returns { type:'long'|'short', optType, premium, notional, span, exposure, margin }
 */
export function legMargin(leg, { spot = 0, lotSize = 0, mult = 1, price } = {}) {
  const qty = qtyOf(leg, lotSize, mult)
  const entry = price != null ? price : leg.entryPrice ?? 0
  const premium = entry * qty
  if (leg.side > 0) {
    return { type: 'long', optType: leg.type, premium, notional: 0, span: 0, exposure: 0, margin: premium }
  }
  const notional = spot * qty
  const span = Math.max(SPAN_PCT * notional, premium) // floor at the option's own premium
  const exposure = EXPOSURE_PCT * notional
  return { type: 'short', optType: leg.type, premium, notional, span, exposure, margin: span + exposure }
}

// Portfolio aggregate: directional-net SPAN over short legs (up-scenario vs down-scenario),
// exposure summed per-leg, long legs add premium. Then apply the hedge cap: a position with
// BOTH long and short legs whose payoff loss is bounded is charged ≈ its max loss.
function aggregate(legMargins, payoff) {
  let premium = 0,
    exposure = 0,
    shortPrem = 0,
    shortCallNotional = 0,
    shortPutNotional = 0,
    hasLong = false,
    hasShort = false
  for (const m of legMargins) {
    if (m.type === 'long') {
      premium += m.premium
      hasLong = true
    } else {
      exposure += m.exposure
      shortPrem += m.premium
      hasShort = true
      if (m.optType === 'PE') shortPutNotional += m.notional
      else shortCallNotional += m.notional
    }
  }
  // The worse directional side drives SPAN in full; the offsetting side adds a fraction.
  // Single naked short → exactly one side. Floor at total short premium.
  const hi = Math.max(shortCallNotional, shortPutNotional)
  const lo = Math.min(shortCallNotional, shortPutNotional)
  const span = hasShort ? Math.max(SPAN_PCT * (hi + SPAN_OFFSET * lo), shortPrem) : 0
  const gross = span + exposure + premium

  const defined = payoff != null && payoff.maxLoss !== -Infinity && hasLong && hasShort
  let total = gross
  let benefit = 0
  if (defined) {
    const maxLossAbs = Math.abs(payoff.maxLoss)
    total = Math.min(gross, maxLossAbs)
    benefit = gross - total
  }
  return { total, gross, span, exposure, premium, benefit, defined, hasNaked: hasShort && !defined }
}

function fold(items, getLeg, getPrice, { spot, lotSize, mult }, payoff) {
  const lm = items.map((it) => legMargin(getLeg(it), { spot, lotSize: lotSize(it), mult, price: getPrice(it) }))
  return aggregate(lm, payoff)
}

/**
 * Whole-book margin estimate at the clock. Reads book.openLegs ({leg, lotSize, priceNow}).
 * The hedge cap uses the whole-book payoff (book payoff == strategy payoff for a single
 * grouped strategy; for an ad-hoc mixed book it's a sensible aggregate bound).
 * @returns null if the book is empty, else { total, gross, span, exposure, premium, benefit, defined, hasNaked }
 */
export function bookMargin(book, payoff, { spot, lotSize, mult = 1 } = {}) {
  if (!book?.openLegs?.length) return null
  return fold(
    book.openLegs,
    (s) => s.leg,
    (s) => s.priceNow,
    { spot, lotSize: (s) => s.lotSize ?? lotSize, mult },
    payoff,
  )
}

/**
 * Margin estimate for a RESOLVED strategy preview (before placing). specs come from
 * resolveStrategy: [{ type, side, lots, strike, price }]. Pass the preview payoff (computed
 * from the same specs) to get the hedge cap; omit it for a conservative naked estimate.
 */
export function previewMargin(specs, { spot, lotSize, mult = 1, payoff = null } = {}) {
  if (!specs?.length) return null
  return fold(
    specs,
    (sp) => ({ side: sp.side, lots: sp.lots, type: sp.type }),
    (sp) => sp.price,
    { spot, lotSize: () => lotSize, mult },
    payoff,
  )
}

/**
 * Suggested size for the current position from account capital + risk-per-trade %.
 *   perLotRisk   = the position's max loss (₹) — defined max-loss, or a user stop for naked.
 *   marginPerLot = the position's margin (₹).
 * Returns how many copies of the position fit under BOTH the risk budget and the capital.
 */
export function suggestLots({ capital, riskPct, perLotRisk, marginPerLot }) {
  const cap = Math.max(0, Number(capital) || 0)
  const rp = Math.max(0, Number(riskPct) || 0)
  const riskBudget = (cap * rp) / 100
  const lotsByRisk = perLotRisk > 0 ? Math.floor(riskBudget / perLotRisk) : 0
  const lotsByMargin = marginPerLot > 0 ? Math.floor(cap / marginPerLot) : Infinity
  const lots = Math.max(0, Math.min(lotsByRisk, lotsByMargin))
  const capped = lotsByMargin < lotsByRisk ? 'margin' : 'risk'
  const marginUsed = Number.isFinite(lotsByMargin) ? lots * marginPerLot : 0
  const utilPct = cap > 0 ? (marginUsed / cap) * 100 : 0
  return { riskBudget, lotsByRisk, lotsByMargin, lots, marginUsed, utilPct, capped }
}

/** Margin utilisation fraction (margin / capital), or null when capital is unset. */
export const marginUtil = (margin, capital) => (capital > 0 ? margin / capital : null)
