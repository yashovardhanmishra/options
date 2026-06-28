import { describe, it, expect } from 'vitest'
import { yearsToExpiry, sessionUnix, expiryUnix } from '../time.js'

describe('yearsToExpiry', () => {
  it('uses the 15:30 IST expiry instant and 365.25-day years', () => {
    const clock = sessionUnix('2026-03-19', 15, 30) // exactly 7 days before expiry close
    expect(yearsToExpiry(clock, '2026-03-26')).toBeCloseTo(7 / 365.25, 12)
  })
  it('is positive before, ~0 at, negative after expiry', () => {
    const expiry = '2026-03-26'
    expect(yearsToExpiry(sessionUnix(expiry, 9, 30), expiry)).toBeGreaterThan(0)
    expect(yearsToExpiry(sessionUnix(expiry, 15, 30), expiry)).toBe(0)
    expect(yearsToExpiry(sessionUnix(expiry, 15, 31), expiry)).toBeLessThan(0)
  })
  it('expiryUnix is an integer second-key (no fractional seconds)', () => {
    expect(Number.isInteger(expiryUnix('2026-03-26'))).toBe(true)
  })
})
