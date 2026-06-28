import { describe, it, expect } from 'vitest'
import { lotSize, monthlyExpirySet, isMonthlyExpiry } from '../../config/lotsize.js'

// Lot size is keyed by (isMonthly, expiry) per the confirmed NIFTY schedule.
describe('NIFTY lot size by (isMonthly, expiry)', () => {
  it('50 up to 2024-04-25 (both weekly & monthly)', () => {
    expect(lotSize('NIFTY', '2023-05-04', false)).toBe(50)
    expect(lotSize('NIFTY', '2024-04-25', true)).toBe(50)
  })
  it('25 from 2024-04-26', () => {
    expect(lotSize('NIFTY', '2024-04-26', false)).toBe(25)
    expect(lotSize('NIFTY', '2024-09-26', true)).toBe(25)
  })

  // The two transition windows the spec calls out explicitly:
  it('25→75 window splits weekly vs monthly', () => {
    expect(lotSize('NIFTY', '2025-01-02', false)).toBe(75) // 02-Jan-2025 weekly = 75
    expect(lotSize('NIFTY', '2025-01-30', true)).toBe(25) //  30-Jan-2025 monthly = 25
    expect(lotSize('NIFTY', '2025-02-27', true)).toBe(75) //  Feb-2025 monthly flips to 75
  })
  it('75→65 window splits weekly vs monthly', () => {
    expect(lotSize('NIFTY', '2026-01-06', false)).toBe(65) // 06-Jan-2026 weekly = 65
    expect(lotSize('NIFTY', '2025-12-30', true)).toBe(75) //  30-Dec-2025 monthly stays 75
    expect(lotSize('NIFTY', '2026-01-27', true)).toBe(65) //  Jan-2026 monthly flips to 65
  })

  it('is case-insensitive on underlying', () => {
    expect(lotSize('nifty', '2026-06-02', false)).toBe(65)
  })
  it('throws for an unknown underlying', () => {
    expect(() => lotSize('BANKNIFTY', '2026-01-01', false)).toThrow()
  })
})

describe('isMonthly derivation from the expiry list', () => {
  const jan2025 = ['2025-01-02', '2025-01-09', '2025-01-16', '2025-01-23', '2025-01-30']
  const all = [...jan2025, '2025-02-06', '2025-02-27']
  it('the latest expiry in a month is the monthly', () => {
    const monthly = monthlyExpirySet(all)
    expect(monthly.has('2025-01-30')).toBe(true) // latest in Jan
    expect(monthly.has('2025-01-02')).toBe(false)
    expect(monthly.has('2025-02-27')).toBe(true) // latest in Feb
  })
  it('combined: the 30-Jan-2025 monthly resolves to 25, the 02-Jan weekly to 75', () => {
    expect(lotSize('NIFTY', '2025-01-30', isMonthlyExpiry('2025-01-30', all))).toBe(25)
    expect(lotSize('NIFTY', '2025-01-02', isMonthlyExpiry('2025-01-02', all))).toBe(75)
  })
})
