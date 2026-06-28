import { describe, it, expect } from 'vitest'
import { normCdf, greeks, bsPrice, intrinsic } from '../bs.js'

describe('normCdf sanity', () => {
  it('matches known values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6)
    expect(normCdf(1.96)).toBeCloseTo(0.975, 4)
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 4)
    expect(normCdf(10)).toBeCloseTo(1, 6)
  })
})

// Acceptance test 2 (single-leg half) — long-option Greek signs.
describe('acceptance 2 — single-leg Greek signs', () => {
  const base = { S: 22000, K: 22000, T: 7 / 365.25, r: 0.065, sigma: 0.15 }

  it('long call: Δ∈(0,1), Γ>0, Θ<0, Vega>0', () => {
    const g = greeks({ ...base, type: 'CE' })
    expect(g.delta).toBeGreaterThan(0)
    expect(g.delta).toBeLessThan(1)
    expect(g.gamma).toBeGreaterThan(0)
    expect(g.theta).toBeLessThan(0)
    expect(g.vega).toBeGreaterThan(0)
  })

  it('long put: Δ∈(-1,0), Γ>0, Θ<0, Vega>0', () => {
    const g = greeks({ ...base, type: 'PE' })
    expect(g.delta).toBeGreaterThan(-1)
    expect(g.delta).toBeLessThan(0)
    expect(g.gamma).toBeGreaterThan(0)
    expect(g.theta).toBeLessThan(0)
    expect(g.vega).toBeGreaterThan(0)
  })
})

describe('put-call parity (price sanity)', () => {
  it('C − P = S − K·e^(−rT)', () => {
    const p = { S: 22000, K: 22100, T: 30 / 365.25, r: 0.065, sigma: 0.18 }
    const c = bsPrice({ ...p, type: 'CE' })
    const pu = bsPrice({ ...p, type: 'PE' })
    expect(c - pu).toBeCloseTo(p.S - p.K * Math.exp(-p.r * p.T), 6)
  })
})

describe('expiry/degenerate handling', () => {
  it('T<=0 prices at spot intrinsic and zeroes higher-order greeks', () => {
    const g = greeks({ S: 22000, K: 21800, T: -0.001, r: 0.065, sigma: 0.15, type: 'CE' })
    expect(g.price).toBe(intrinsic(22000, 21800, 'CE'))
    expect(g.gamma).toBe(0)
    expect(g.vega).toBe(0)
    expect(g.theta).toBe(0)
    expect(g.delta).toBe(1) // ITM call
  })
})
