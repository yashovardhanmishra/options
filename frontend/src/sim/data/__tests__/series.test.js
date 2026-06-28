import { describe, it, expect } from 'vitest'
import { makeSeries, barAt, priceAt, assertNoLookahead, lastIndexAtOrBefore } from '../series.js'

// bars at minutes 10, 20, 40 (a hole at 30). [u,o,h,l,c,v,oi]
const s = makeSeries([
  [10, 0, 0, 0, 100, 1, 0],
  [40, 0, 0, 0, 130, 1, 0],
  [20, 0, 0, 0, 110, 1, 0], // out of order on purpose -> makeSeries sorts
])

describe('anti-lookahead (a future bar never leaks)', () => {
  it('barAt never returns a bar with u > t across a full sweep', () => {
    for (let t = 0; t <= 60; t++) {
      const b = barAt(s, t)
      if (b) expect(b.u).toBeLessThanOrEqual(t)
    }
  })
  it('at t=25 it returns u=20, never the future u=40', () => {
    expect(barAt(s, 25).u).toBe(20)
  })
  it('assertNoLookahead throws when a bar is from the future', () => {
    expect(() => assertNoLookahead(40, 25)).toThrow(/anti-lookahead/)
  })
  it('lastIndexAtOrBefore is exclusive of future bars', () => {
    expect(lastIndexAtOrBefore(s.times, 39)).toBe(1) // u=20, not u=40
    expect(lastIndexAtOrBefore(s.times, 5)).toBe(-1) // nothing yet
  })
})

describe('forward-fill', () => {
  it('carries the last price through a hole (t=30 -> u=20 price)', () => {
    expect(barAt(s, 30).u).toBe(20)
    expect(priceAt(s, 30)).toBe(110)
  })
  it('returns null before the first bar', () => {
    expect(barAt(s, 5)).toBeNull()
    expect(priceAt(s, 5)).toBeNull()
  })
  it('untradeable mode: null on a hole, the bar on an exact hit', () => {
    expect(barAt(s, 30, { forwardFill: false })).toBeNull() // hole at 30
    expect(barAt(s, 20, { forwardFill: false }).u).toBe(20) // exact bar
  })
})

describe('makeSeries hygiene', () => {
  it('sorts ascending and de-dupes minutes (keep last)', () => {
    const d = makeSeries([
      [10, 0, 0, 0, 1, 0, 0],
      [10, 0, 0, 0, 9, 0, 0], // dup minute -> last wins
    ])
    expect(d.times).toEqual([10])
    expect(d.bars[0].c).toBe(9)
  })
})
