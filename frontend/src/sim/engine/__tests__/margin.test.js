import { describe, it, expect } from 'vitest'
import { legMargin, bookMargin, previewMargin, suggestLots, spanPctFor, SPAN_PCT, EXPOSURE_PCT, SPAN_MIN_PCT, SPAN_MAX_PCT } from '../margin.js'

const env = { spot: 23000, lotSize: 75, mult: 1 }
const notional = 23000 * 75

describe('legMargin', () => {
  it('long option = premium paid, no SPAN/exposure', () => {
    const m = legMargin({ side: 1, lots: 1 }, { ...env, price: 100 })
    expect(m).toMatchObject({ type: 'long', margin: 7500, span: 0, exposure: 0 })
  })
  it('short option = SPAN + 2% exposure on spot notional', () => {
    const m = legMargin({ side: -1, lots: 1 }, { ...env, price: 100 })
    expect(m.exposure).toBeCloseTo(EXPOSURE_PCT * notional, 0)
    expect(m.span).toBeCloseTo(Math.max(SPAN_PCT * notional, 7500), 0)
    expect(m.margin).toBeCloseTo(m.span + m.exposure, 0)
  })
  it('SPAN is floored at the option premium for deep-ITM shorts', () => {
    const m = legMargin({ side: -1, lots: 1 }, { ...env, price: 4000 })
    expect(m.span).toBe(4000 * 75)
  })
})

describe('moneyness-aware SPAN (the strike drives margin, not the premium collected)', () => {
  const spot = 23609.3
  const notional = spot * 65
  const shortPE = (strike, price) =>
    bookMargin(
      { openLegs: [{ leg: { side: -1, lots: 1, type: 'PE', strike }, lotSize: 65, priceNow: price }] },
      { maxLoss: -Infinity },
      { spot, lotSize: 65 },
    )

  it('spanPctFor: ATM = SPAN_PCT, OTM floored at min, ITM capped at max, no-strike = ATM', () => {
    expect(spanPctFor('PE', 23609.3, spot)).toBeCloseTo(SPAN_PCT, 4) // ATM
    expect(spanPctFor('PE', 21200, spot)).toBe(SPAN_MIN_PCT) // ~10% OTM → 3% floor
    expect(spanPctFor('PE', 30000, spot)).toBe(SPAN_MAX_PCT) // deep ITM → 9% cap
    expect(spanPctFor('PE', 23850, spot)).toBeGreaterThan(SPAN_PCT) // 1% ITM → above ATM
    expect(spanPctFor('CE', 23850, spot)).toBeLessThan(SPAN_PCT) // OTM call → below ATM
    expect(spanPctFor('PE', undefined, spot)).toBe(SPAN_PCT) // no strike → ATM (back-compat)
  })

  // The user's three screenshots — all printed ₹99,749 under the old flat model.
  it('deep-OTM 21200PE @0.45 → floored ~₹76,730, cheaper than the ATM ₹99,749', () => {
    const m = shortPE(21200, 0.45)
    expect(m.span).toBeCloseTo(SPAN_MIN_PCT * notional, 0) // ~46,038 (min charge, not the ₹29 premium)
    expect(m.total).toBeCloseTo((SPAN_MIN_PCT + EXPOSURE_PCT) * notional, 0) // ~76,730
    expect(m.total).toBeLessThan(99_749)
  })

  it('near-ATM 23600PE ≈ the ₹99,749 anchor (essentially unchanged)', () => {
    // 23600 is ~9 pts below spot → marginally OTM → ₹99,447, within ~₹300 of the pure-ATM ₹99,749.
    expect(shortPE(23600, 80.9).total).toBeCloseTo((SPAN_PCT + EXPOSURE_PCT) * notional, -3)
  })

  it('ITM 23850PE → dearer than the ATM ₹99,749', () => {
    expect(shortPE(23850, 226.1).total).toBeGreaterThan(99_749)
  })
})

describe('bookMargin', () => {
  it('naked straddle → hasNaked, no cap', () => {
    const book = { openLegs: [
      { leg: { side: -1, lots: 1 }, lotSize: 75, priceNow: 100 },
      { leg: { side: -1, lots: 1 }, lotSize: 75, priceNow: 90 },
    ] }
    const m = bookMargin(book, { maxLoss: -Infinity }, env)
    expect(m.hasNaked).toBe(true)
    expect(m.defined).toBe(false)
    expect(m.total).toBe(m.gross)
  })
  it('defined-risk spread is capped at |maxLoss|', () => {
    const book = { openLegs: [
      { leg: { side: -1, lots: 1 }, lotSize: 75, priceNow: 100 },
      { leg: { side: 1, lots: 1 }, lotSize: 75, priceNow: 40 },
    ] }
    const m = bookMargin(book, { maxLoss: -50000 }, env)
    expect(m.defined).toBe(true)
    expect(m.total).toBe(50000)
    expect(m.gross).toBeGreaterThan(50000)
    expect(m.benefit).toBe(m.gross - 50000)
  })
  it('empty book → null', () => {
    expect(bookMargin({ openLegs: [] }, null, env)).toBeNull()
  })

  it('nets offsetting short call/put SPAN (straddle < 2× a single leg) and lands realistic', () => {
    const single = bookMargin({ openLegs: [{ leg: { side: -1, lots: 1, type: 'CE' }, lotSize: 75, priceNow: 150 }] }, { maxLoss: -Infinity }, env)
    const straddle = bookMargin({ openLegs: [
      { leg: { side: -1, lots: 1, type: 'CE' }, lotSize: 75, priceNow: 150 },
      { leg: { side: -1, lots: 1, type: 'PE' }, lotSize: 75, priceNow: 150 },
    ] }, { maxLoss: -Infinity }, env)
    expect(straddle.span).toBeCloseTo(1.5 * single.span, 0) // call + 0.5·put
    expect(straddle.total).toBeLessThan(2 * single.total)
    expect(single.total).toBeGreaterThan(100_000) // ~₹1.1L to sell one NIFTY lot
    expect(single.total).toBeLessThan(130_000)
  })
})

describe('previewMargin', () => {
  it('applies the hedge cap from a preview payoff', () => {
    const m = previewMargin(
      [{ side: -1, lots: 1, price: 100 }, { side: 1, lots: 1, price: 40 }],
      { ...env, payoff: { maxLoss: -50000 } },
    )
    expect(m.defined).toBe(true)
    expect(m.total).toBe(50000)
  })
})

describe('suggestLots', () => {
  it('caps by risk budget when risk binds', () => {
    const s = suggestLots({ capital: 1_000_000, riskPct: 2, perLotRisk: 5000, marginPerLot: 100_000 })
    expect(s.lots).toBe(4)
    expect(s.capped).toBe('risk')
  })
  it('caps by capital when margin binds', () => {
    const s = suggestLots({ capital: 300_000, riskPct: 50, perLotRisk: 5000, marginPerLot: 100_000 })
    expect(s.lots).toBe(3)
    expect(s.capped).toBe('margin')
  })
  it('no risk unit (naked, no stop) → 0 lots', () => {
    expect(suggestLots({ capital: 1e6, riskPct: 2, perLotRisk: 0, marginPerLot: 1e5 }).lots).toBe(0)
  })
})
