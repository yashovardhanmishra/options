import { describe, it, expect } from 'vitest'
import { buildSession, snapshotAt, makeContext } from '../snapshot.js'

const session = buildSession({
  expiry: '2026-03-30',
  expiries: ['2026-03-26', '2026-03-30'], // 30th is the monthly
  spotBars: [
    [100, 0, 0, 0, 22000, 0],
    [160, 0, 0, 0, 22050, 0],
    [220, 0, 0, 0, 22100, 0],
  ],
  instruments: [
    // CE has a HOLE at 160 (bars only at 100 and 220) -> exercises forward-fill / leak guard
    { strike: 22000, type: 'CE', bars: [[100, 0, 0, 0, 120, 0, 1000], [220, 0, 0, 0, 90, 0, 1100]] },
    { strike: 22000, type: 'PE', bars: [[100, 0, 0, 0, 110, 0, 900], [160, 0, 0, 0, 130, 0, 950], [220, 0, 0, 0, 150, 0, 1000]] },
  ],
})

describe('snapshotAt — future bar never leaks', () => {
  it('every surfaced bar across all clocks has u <= t', () => {
    for (const t of [90, 100, 130, 160, 200, 220, 99999]) {
      const snap = snapshotAt(session, t)
      for (const row of snap.chain) {
        if (row.ce) expect(row.ce.u).toBeLessThanOrEqual(t)
        if (row.pe) expect(row.pe.u).toBeLessThanOrEqual(t)
      }
    }
  })
  it('at t=159 the t=160/t=220 PE bars are invisible (only u<=159 surfaces)', () => {
    const pe = snapshotAt(session, 159).chain.find((r) => r.strike === 22000).pe
    expect(pe.u).toBe(100) // not 160, not 220
  })
})

describe('snapshotAt — forward-fill vs untradeable', () => {
  it('forward-fills the CE hole at t=160 (carries u=100 price, not the future u=220)', () => {
    const ce = snapshotAt(session, 160).chain.find((r) => r.strike === 22000).ce
    expect(ce.u).toBe(100)
    expect(ce.ltp).toBe(120)
  })
  it('untradeable mode marks the CE hole null but keeps the PE that has a 160 bar', () => {
    const row = snapshotAt(session, 160, { forwardFill: false }).chain.find((r) => r.strike === 22000)
    expect(row.ce).toBeNull()
    expect(row.pe.u).toBe(160)
  })
  it('S is null before any spot data', () => {
    expect(snapshotAt(session, 50).S).toBeNull()
  })
})

describe('makeContext wires lot size by (isMonthly, expiry)', () => {
  it('the 2026-03-30 monthly -> 65', () => {
    const snap = snapshotAt(session, 220)
    const ctx = makeContext(session, snap)
    expect(ctx.lotSizeFor({ underlying: 'NIFTY', expiry: '2026-03-30' })).toBe(65)
    expect(ctx.spot).toBe(22100)
    expect(ctx.r).toBe(0.065)
  })
})
