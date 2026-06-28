import { describe, it, expect } from 'vitest'
import { legPnl, roundPaisa } from '../mtm.js'

// Acceptance test 3 — MTM exactness: squaring off yields exactly
// (exit − entry) × side × lot × lots, to the paisa (no model drift).
describe('acceptance 3 — MTM exactness', () => {
  it('long: 2 lots × 75, +5.25 move', () => {
    const pnl = legPnl({ entryPrice: 100.5, priceNow: 105.75, side: 1, lotSize: 75, lots: 2 })
    expect(roundPaisa(pnl)).toBe(787.5) // 5.25 × 75 × 2
  })

  it('short: side=−1 flips the sign (price down = profit)', () => {
    const pnl = legPnl({ entryPrice: 120.25, priceNow: 100.0, side: -1, lotSize: 75, lots: 1 })
    expect(roundPaisa(pnl)).toBe(1518.75) // (100 − 120.25) × −1 × 75 = 20.25 × 75
  })

  it('short loses when price rises', () => {
    const pnl = legPnl({ entryPrice: 80, priceNow: 95.4, side: -1, lotSize: 25, lots: 4 })
    expect(roundPaisa(pnl)).toBe(-1540) // (95.4 − 80) × −1 × 25 × 4 = −15.4 × 100
  })

  it('paise-exact vs hand arithmetic (float-safe)', () => {
    const entry = 88.35
    const exit = 92.1
    const side = 1
    const lot = 25
    const lots = 3
    const expectedPaise = Math.round((exit - entry) * 100) * side * lot * lots
    const gotPaise = Math.round(legPnl({ entryPrice: entry, priceNow: exit, side, lotSize: lot, lots }) * 100)
    expect(gotPaise).toBe(expectedPaise)
  })
})
