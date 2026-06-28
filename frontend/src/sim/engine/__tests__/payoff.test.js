import { describe, it, expect } from 'vitest'
import {
  pnlAt, payoffCurve, breakevens, extrema, netCredit, pop, lognormCdf,
  expectedMove, sigmaLevels, spotGrid, strategySummary,
} from '../payoff.js'

const LOT = 65
const leg = (strike, type, side, entryPrice, sigma = 0.12, lots = 1) => ({ strike, type, side, lots, lotSize: LOT, entryPrice, sigma })

// The exact StockMock example: short 24150 straddle, CE@110.8 + PE@127, lot 65.
const shortStraddle = [leg(24150, 'CE', -1, 110.8), leg(24150, 'PE', -1, 127)]
const grid = spotGrid(24150, [24150], expectedMove(24150, 0.12, 0.05), { n: 401 })

describe('payoff — short straddle (matches StockMock numbers)', () => {
  it('net credit = (110.8 + 127) × 65 = 15457', () => {
    expect(netCredit(shortStraddle)).toBeCloseTo((110.8 + 127) * 65, 6)
  })
  it('max profit at the strike = net credit; loss unbounded, profit bounded', () => {
    expect(pnlAt(shortStraddle, 24150, { T: 0 })).toBeCloseTo(15457, 6) // both expire worthless
    const ex = extrema(payoffCurve(shortStraddle, grid, { Tnow: 0.05 }))
    expect(ex.lossUnbounded).toBe(true)
    expect(ex.profitUnbounded).toBe(false)
    expect(ex.maxProfit).toBeCloseTo(15457, -1) // grid max ≈ at the strike
  })
  it('breakevens = 24150 ± 237.8 ≈ 23912 / 24388', () => {
    const bes = breakevens(payoffCurve(shortStraddle, grid, { Tnow: 0.05 })).sort((a, b) => a - b)
    expect(bes).toHaveLength(2)
    expect(bes[0]).toBeCloseTo(24150 - 237.8, 0)
    expect(bes[1]).toBeCloseTo(24150 + 237.8, 0)
  })
  it('POP = lognormal mass between the breakevens, in (0,1)', () => {
    const T = 0.05
    const curve = payoffCurve(shortStraddle, grid, { Tnow: T })
    const p = pop(curve, 24150, 0.12, T)
    const expected = lognormCdf(24150 + 237.8, 24150, 0.12, T) - lognormCdf(24150 - 237.8, 24150, 0.12, T)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(1)
    expect(p).toBeCloseTo(expected, 2)
  })
  it('summary ties it together', () => {
    const s = strategySummary(shortStraddle, { S0: 24150, Tnow: 0.05, Texp: 0.05, atmIv: 0.12 })
    expect(s.netCredit).toBeCloseTo(15457, 6)
    expect(s.maxLoss).toBe(-Infinity) // unbounded
    expect(Number.isFinite(s.maxProfit)).toBe(true)
    expect(s.breakevens).toHaveLength(2)
  })
})

describe('payoff — directional strategies', () => {
  it('long call: loss limited to premium, profit unbounded, BE = K + premium', () => {
    const legs = [leg(24000, 'CE', 1, 150)]
    const g = spotGrid(24000, [24000], expectedMove(24000, 0.12, 0.05), { n: 401 })
    const ex = extrema(payoffCurve(legs, g, { Tnow: 0.05 }))
    expect(ex.profitUnbounded).toBe(true)
    expect(ex.lossUnbounded).toBe(false)
    expect(ex.maxLoss).toBeCloseTo(-150 * 65, 0) // premium paid
    expect(pnlAt(legs, 22000, { T: 0 })).toBeCloseTo(-150 * 65, 6) // deep OTM at expiry
    const bes = breakevens(payoffCurve(legs, g, { Tnow: 0.05 }))
    expect(bes[0]).toBeCloseTo(24150, 0) // 24000 + 150
  })
  it('bull call spread: both max profit and max loss bounded', () => {
    const legs = [leg(24000, 'CE', 1, 150), leg(24200, 'CE', -1, 70)]
    const g = spotGrid(24100, [24000, 24200], expectedMove(24100, 0.12, 0.05), { n: 401 })
    const ex = extrema(payoffCurve(legs, g, { Tnow: 0.05 }))
    expect(ex.profitUnbounded).toBe(false)
    expect(ex.lossUnbounded).toBe(false)
    // max loss = net debit = (150-70)*65 ; max profit = (200 - 80)*65
    expect(ex.maxLoss).toBeCloseTo(-(150 - 70) * 65, 0)
    expect(ex.maxProfit).toBeCloseTo((200 - 80) * 65, 0)
  })
})

describe('payoff — building blocks', () => {
  it('lognormCdf is monotone in S and bounded [0,1]; median ≈ S0', () => {
    expect(lognormCdf(20000, 24000, 0.12, 0.05)).toBeLessThan(lognormCdf(28000, 24000, 0.12, 0.05))
    expect(lognormCdf(24000, 24000, 0.12, 0.05)).toBeGreaterThan(0)
    expect(lognormCdf(24000, 24000, 0.12, 0.05)).toBeLessThan(1)
    expect(lognormCdf(24000, 24000, 0.12, 0.05)).toBeCloseTo(0.5, 1) // ~median
  })
  it('sigmaLevels are symmetric in price around S0', () => {
    const { m1, p1, m2, p2, move } = sigmaLevels(24000, 0.12, 0.05)
    expect(p1 - 24000).toBeCloseTo(24000 - m1, 6)
    expect(p2 - 24000).toBeCloseTo(2 * move, 6)
  })
  it('pnlAt at T>0 carries time value vs expiry (long option worth more before expiry)', () => {
    const legs = [leg(24000, 'CE', 1, 150)]
    const atm = 24000
    expect(pnlAt(legs, atm, { T: 0.05 })).toBeGreaterThan(pnlAt(legs, atm, { T: 0 })) // ATM: time value > 0
  })
  it('extrema is crash-safe on a degenerate (single-point / empty) curve', () => {
    expect(() => extrema([])).not.toThrow()
    const one = extrema([{ S: 24000, expiry: 500, now: 400 }])
    expect(one.maxProfit).toBe(500)
    expect(one.maxLoss).toBe(500)
    expect(one.profitUnbounded).toBe(false)
    expect(one.lossUnbounded).toBe(false)
  })
})
