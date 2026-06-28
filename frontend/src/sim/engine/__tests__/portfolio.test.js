import { describe, it, expect } from 'vitest'
import { bsPrice } from '../bs.js'
import { sessionUnix } from '../time.js'
import { legState, aggregate } from '../portfolio.js'

// Acceptance test 2 (portfolio half) — short ATM straddle net Greek signs:
// Δ≈0, Γ<0, Θ>0, Vega<0. Also checks position-level scaling (× lot × lots × side).
describe('acceptance 2 — short ATM straddle (aggregate)', () => {
  const S = 22000
  const K = 22000
  const r = 0.065
  const sigma = 0.15
  const expiry = '2026-03-26'
  const clockUnix = sessionUnix('2026-03-19', 9, 30) // ~7 days before expiry close
  const T = (sessionUnix(expiry, 15, 30) - clockUnix) / (365.25 * 86400)
  const ctx = { r, clockUnix, spot: S, lotSizeFor: () => 65 } // 2026 expiry → 65

  // What the simulator would read at the clock = stored market prices (here, BS @ 0.15).
  const callPx = bsPrice({ S, K, T, r, sigma, type: 'CE' })
  const putPx = bsPrice({ S, K, T, r, sigma, type: 'PE' })
  const legCE = { underlying: 'NIFTY', expiry, strike: K, type: 'CE', side: -1, lots: 1, entryPrice: callPx }
  const legPE = { underlying: 'NIFTY', expiry, strike: K, type: 'PE', side: -1, lots: 1, entryPrice: putPx }

  const states = [legState(legCE, callPx, ctx), legState(legPE, putPx, ctx)]
  const agg = aggregate(states)

  it('net delta ≈ 0', () => {
    // near-zero relative to a single full-delta leg (≈ lot)
    expect(Math.abs(agg.greeks.delta)).toBeLessThan(0.15 * 65)
  })
  it('net gamma < 0 (short)', () => expect(agg.greeks.gamma).toBeLessThan(0))
  it('net theta > 0 (short collects decay)', () => expect(agg.greeks.theta).toBeGreaterThan(0))
  it('net vega < 0 (short vol)', () => expect(agg.greeks.vega).toBeLessThan(0))

  it('recovers IV ≈ 0.15 per leg and MTM = 0 at entry', () => {
    expect(states[0].iv).toBeCloseTo(0.15, 3)
    expect(agg.mtm).toBeCloseTo(0, 9) // priced at entry → no P&L yet
  })

  it('position greeks scale by lot × lots × side', () => {
    // single-call position delta = per-option delta × 65 × 1 × (−1)
    const s = states[0]
    expect(s.greeks.delta).toBeCloseTo(s.perOption.delta * 65 * 1 * -1, 9)
  })
})
