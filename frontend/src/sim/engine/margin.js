// Indian NSE F&O margin estimator (SPAN + Exposure approximation) + position sizing.
// PURE — mirrors engine/risk.js, no I/O, no React, unit-testable.
//
// Real SPAN is a scenario grid the exchange revises ~6×/day; we approximate it as a % of
// NOTIONAL (underlying value = spot × lot size) that VARIES WITH MONEYNESS. Calibration: selling
// one ATM NIFTY lot currently needs ≈ ₹1.1–1.2 lakh against ≈ ₹18–19 lakh notional (NIFTY
// ~25,000 × 75) → total SPAN+exposure ≈ 6.5%; exposure is 2%, so ATM SPAN ≈ 4.5%.
//   • ITM shorts cost MORE  — delta → 1, so a bigger adverse-move scenario loss; SPAN rate rises
//     with ITM depth (SPAN_ITM_SLOPE), capped at SPAN_MAX_PCT (past which the premium floor wins).
//   • OTM shorts cost LESS — smaller scenario loss, but never below NSE's short-option MINIMUM
//     charge (SPAN_MIN_PCT). This is why selling a ₹0.45 deep-OTM option STILL blocks ~₹75k: the
//     exchange margins the tail/gap risk of the underlying, not the tiny premium you collect.
// SPAN also NETS offsetting short sides: a big up-move hurts short calls while helping short puts
// (and vice-versa), so a short straddle/strangle's binding scenario is the larger side plus a
// fraction of the other (gamma/pin risk) — NOT the naive 2× sum (netted at the SPAN level so each
// leg keeps its own moneyness rate). Long options need only the premium paid. A fully-hedged,
// defined-risk group is capped at its payoff max-loss. These numbers are ESTIMATES.
//
// Sources: NSE Clearing margins (incl. the short-option minimum charge); Zerodha/5paisa "SPAN &
// exposure margin" notes (exposure = 2% of contract value; hedged spreads charged ≈ their max loss).

export const SPAN_PCT = 0.045 // ATM SPAN ≈ 4.5% of notional for a short index option
export const EXPOSURE_PCT = 0.02 // NSE exposure margin = 2% of contract notional
export const SPAN_MIN_PCT = 0.03 // short-option MINIMUM charge — a deep-OTM short never below 3%
export const SPAN_MAX_PCT = 0.09 // deep-ITM cap on the SPAN rate (premium floor dominates beyond)
export const SPAN_ITM_SLOPE = 0.5 // SPAN-rate change per unit of signed ITM fraction (ITM up / OTM down)
export const SPAN_OFFSET = 0.5 // share of the offsetting short side that still adds SPAN

const qtyOf = (leg, lotSize, mult) => Math.abs(leg.lots || 0) * (lotSize || 0) * (mult || 1)

/** Moneyness-aware SPAN rate for a short option: ATM = SPAN_PCT, rising with ITM depth (capped at
 *  SPAN_MAX_PCT) and falling for OTM but floored at the short-option minimum (SPAN_MIN_PCT).
 *  `itm` = signed ITM fraction of spot (PE ITM when strike > spot; CE ITM when spot > strike).
 *  No strike (or no spot) → ATM rate, so legs/tests without a strike are unchanged. */
export function spanPctFor(optType, strike, spot) {
  if (!(strike > 0) || !(spot > 0)) return SPAN_PCT
  const itm = (optType === 'PE' ? strike - spot : spot - strike) / spot
  return Math.min(SPAN_MAX_PCT, Math.max(SPAN_MIN_PCT, SPAN_PCT + SPAN_ITM_SLOPE * itm))
}

/**
 * Per-leg breakdown.
 *   LONG  (side>0): margin = premium paid (no SPAN/exposure).
 *   SHORT (side<0): exposure = 2% of spot notional; standalone SPAN = spanPctFor(moneyness) ×
 *                   notional, floored at the option's own premium (deep-ITM shorts). The PORTFOLIO
 *                   SPAN nets the two directional sides in aggregate() from these per-leg spans.
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
  const span = Math.max(spanPctFor(leg.type, leg.strike, spot) * notional, premium) // floor at own premium
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
    shortCallSpan = 0,
    shortPutSpan = 0,
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
      // m.span is already the per-leg, moneyness-aware, premium-floored SPAN (see legMargin).
      if (m.optType === 'PE') shortPutSpan += m.span
      else shortCallSpan += m.span
    }
  }
  // The worse directional side drives SPAN in full; the offsetting side adds a fraction (gamma/pin).
  // Netted at the SPAN level so each leg keeps its own moneyness rate. Single naked short → one
  // side. Floor at total short premium.
  const hi = Math.max(shortCallSpan, shortPutSpan)
  const lo = Math.min(shortCallSpan, shortPutSpan)
  const span = hasShort ? Math.max(hi + SPAN_OFFSET * lo, shortPrem) : 0
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
