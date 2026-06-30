import { describe, it, expect } from 'vitest'
import { STRATEGIES, CATEGORIES, STRATEGY_BY_ID, inferStep, atmStrikeOf, nearestStrikeWith, resolveStrategy } from '../catalog.js'

// Synthetic NIFTY chain: strikes 21000..23000 step 50; toy prices contrived so |CE−PE| is
// smallest at 22000 (parity → ATM), and every strike is priceable.
const ATM = 22000
const chain = []
for (let k = 21000; k <= 23000; k += 50) {
  const ce = Math.max(5, (22000 - k) * 0.5 + 100 - Math.abs(k - ATM) * 0.02)
  const pe = Math.max(5, (k - 22000) * 0.5 + 100 - Math.abs(k - ATM) * 0.02)
  chain.push({ strike: k, ce: { ltp: +ce.toFixed(2) }, pe: { ltp: +pe.toFixed(2) } })
}
const priceFor = ({ strike, type }) => {
  const r = chain.find((x) => x.strike === strike)
  return r ? (type === 'CE' ? r.ce.ltp : r.pe.ltp) : null
}
const resolve = (id, lots = 1, w = 2) => resolveStrategy(id, { chain, S: ATM, lots, w, priceFor, lotSize: 75 })

describe('strategy catalog', () => {
  it('ships 20+ strategies with unique ids in known categories', () => {
    expect(STRATEGIES.length).toBeGreaterThanOrEqual(20)
    const ids = new Set(STRATEGIES.map((s) => s.id))
    expect(ids.size).toBe(STRATEGIES.length)
    for (const s of STRATEGIES) {
      expect(CATEGORIES).toContain(s.cat)
      expect(s.name.length).toBeGreaterThan(0)
      expect(s.desc.length).toBeGreaterThan(10)
      expect(typeof s.build).toBe('function')
    }
  })

  it('resolves every strategy against a wide chain with no missing legs', () => {
    for (const s of STRATEGIES) {
      const r = resolve(s.id)
      expect(r, s.id).not.toBeNull()
      expect(r.missing, s.id).toHaveLength(0)
      expect(r.specs.length).toBeGreaterThanOrEqual(1)
      expect(Number.isFinite(r.net)).toBe(true)
      for (const sp of r.specs) expect(priceFor(sp), `${s.id} ${sp.strike}${sp.type}`).not.toBeNull()
    }
  })

  it('reports missing legs (and refuses to anchor) when the chain is too narrow', () => {
    const tiny = chain.filter((r) => r.strike >= 21950 && r.strike <= 22050)
    const r = resolveStrategy('iron_condor', { chain: tiny, S: ATM, lots: 1, w: 2, priceFor, lotSize: 75 })
    expect(r.missing.length).toBeGreaterThan(0)
  })
})

describe('resolution helpers', () => {
  it('inferStep finds the modal strike gap', () => expect(inferStep(chain)).toBe(50))
  it('atmStrikeOf picks the parity strike', () => expect(atmStrikeOf(chain)).toBe(ATM))
  it('atmStrikeOf falls back to nearest-spot when no parity', () => {
    const oneSided = chain.map((r) => ({ strike: r.strike, ce: r.ce, pe: null }))
    expect(atmStrikeOf(oneSided, 22037)).toBe(22050)
  })
  it('nearestStrikeWith snaps to the grid and skips un-priced strikes', () => {
    expect(nearestStrikeWith(chain, 22037, 'CE')).toBe(22050)
  })
})

describe('premium sign + leg conventions', () => {
  it('short premium = credit (net>0), long premium = debit (net<0)', () => {
    expect(resolve('short_straddle').net).toBeGreaterThan(0)
    expect(resolve('short_strangle').net).toBeGreaterThan(0)
    expect(resolve('iron_condor').net).toBeGreaterThan(0)
    expect(resolve('long_straddle').net).toBeLessThan(0)
    expect(resolve('bull_call_spread').net).toBeLessThan(0)
  })
  it('butterfly is 1 / 2 / 1 lots', () => {
    expect(resolve('call_butterfly').specs.map((s) => s.lots)).toEqual([1, 2, 1])
  })
  it('width scales OTM distance', () => {
    const tight = resolve('short_strangle', 1, 1).specs.find((s) => s.type === 'CE').strike
    const wide = resolve('short_strangle', 1, 3).specs.find((s) => s.type === 'CE').strike
    expect(wide).toBeGreaterThan(tight)
  })
  it('lots flow through to every leg', () => {
    const r = resolve('iron_condor', 3)
    expect(r.specs.every((s) => s.lots === 3)).toBe(true)
  })
})
