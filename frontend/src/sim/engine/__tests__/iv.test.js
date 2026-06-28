import { describe, it, expect } from 'vitest'
import { bsPrice } from '../bs.js'
import { impliedVol } from '../iv.js'

// Acceptance test 1 — IV round-trip: price at σ=0.15, feed to the solver, recover 0.15 ± 1e-3.
describe('acceptance 1 — IV round-trip', () => {
  const T = 7 / 365.25
  const r = 0.065
  const sigma = 0.15
  const cases = [
    ['CE ATM', { S: 22000, K: 22000, type: 'CE' }],
    ['PE ATM', { S: 22000, K: 22000, type: 'PE' }],
    ['CE OTM', { S: 22000, K: 22500, type: 'CE' }],
    ['PE OTM', { S: 22000, K: 21500, type: 'PE' }],
    ['CE ITM', { S: 22000, K: 21000, type: 'CE' }],
    ['PE ITM', { S: 22000, K: 23000, type: 'PE' }],
  ]
  for (const [name, c] of cases) {
    it(`recovers 0.15 for ${name}`, () => {
      const price = bsPrice({ ...c, T, r, sigma })
      const { sigma: iv } = impliedVol({ ...c, T, r, price })
      expect(Math.abs(iv - 0.15)).toBeLessThan(1e-3)
    })
  }

  it('flags no-time-value prices as degenerate (σ≈0)', () => {
    // A call priced below the forward intrinsic floor has no solvable IV.
    const c = { S: 22000, K: 21000, type: 'CE', T, r }
    const floor = bsPrice({ ...c, sigma: 1e-4 })
    const { degenerate } = impliedVol({ ...c, price: floor }) // exactly the floor
    expect(degenerate).toBe(true)
  })
})
