import { describe, it, expect } from 'vitest'
import { vertical, straddle, strangle, ironCondor, butterfly } from '../templates.js'
import { entriesFromSpecs } from '../../portfolio/actions.js'

const EXP = '2026-03-30'

describe('strategy templates', () => {
  it('iron condor = long put wing / short put / short call / long call wing', () => {
    const legs = ironCondor({ groupId: 'G', expiry: EXP, putLong: 21000, putShort: 21500, callShort: 22500, callLong: 23000, lots: 2 })
    expect(legs.map((l) => [l.type, l.side, l.strike])).toEqual([
      ['PE', 1, 21000], ['PE', -1, 21500], ['CE', -1, 22500], ['CE', 1, 23000],
    ])
    expect(legs.every((l) => l.lots === 2 && l.groupId === 'G' && l.expiry === EXP)).toBe(true)
  })
  it('straddle = CE + PE same strike, short by default', () => {
    expect(straddle({ groupId: 'G', expiry: EXP, strike: 22000 }).map((l) => [l.type, l.side, l.strike]))
      .toEqual([['CE', -1, 22000], ['PE', -1, 22000]])
  })
  it('strangle = OTM CE + OTM PE', () => {
    expect(strangle({ groupId: 'G', expiry: EXP, callStrike: 22500, putStrike: 21500 }).map((l) => [l.type, l.strike]))
      .toEqual([['CE', 22500], ['PE', 21500]])
  })
  it('vertical = long + short, same type', () => {
    expect(vertical({ groupId: 'G', expiry: EXP, type: 'CE', longStrike: 22000, shortStrike: 22500 }).map((l) => [l.side, l.strike]))
      .toEqual([[1, 22000], [-1, 22500]])
  })
  it('butterfly = 1 / -2 / 1', () => {
    expect(butterfly({ groupId: 'G', expiry: EXP, type: 'CE', low: 21500, mid: 22000, high: 22500 }).map((l) => [l.side, l.strike, l.lots]))
      .toEqual([[1, 21500, 1], [-1, 22000, 2], [1, 22500, 1]])
  })
})

describe('entriesFromSpecs', () => {
  it('turns template specs into priced entry actions with assigned ids', () => {
    const specs = straddle({ groupId: 'G', expiry: EXP, strike: 22000 })
    let n = 0
    const acts = entriesFromSpecs(specs, { t: 1000, priceFor: (s) => (s.type === 'CE' ? 120 : 110), nextId: () => `id${++n}` })
    expect(acts).toHaveLength(2)
    expect(acts[0]).toMatchObject({ type: 'entry', t: 1000, legId: 'id1', price: 120 })
    expect(acts[0].leg).toMatchObject({ type: 'CE', side: -1, strike: 22000, groupId: 'G' })
    expect(acts[1]).toMatchObject({ legId: 'id2', price: 110 })
  })
})
