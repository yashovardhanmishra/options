import { describe, it, expect } from 'vitest'
import { entry, roll, addLots, reduceLots, exitLeg, exitGroup, exitPortfolio } from '../actions.js'
import { foldActions, openLegs } from '../fold.js'
import { portfolioAt } from '../book.js'
import { roundPaisa } from '../../engine/mtm.js'
import { sessionUnix } from '../../engine/time.js'
import { bsPrice } from '../../engine/bs.js'

const LOT = () => 75
const EXP = '2026-03-30'
const ce = (overrides) => ({ expiry: EXP, strike: 22000, type: 'CE', side: 1, lots: 1, ...overrides })

// ── Test 1 ───────────────────────────────────────────────────────────────────
describe('1. Roll is atomic at one unix (no Greeks blip)', () => {
  const log = [
    entry({ t: 100, legId: 'L1', ...ce({ lots: 3 }), price: 100 }),
    roll({ t: 200, legId: 'L1', closePrice: 150, open: { legId: 'L2', expiry: EXP, strike: 22500, type: 'CE', side: 1, lots: 3 }, openPrice: 80 }),
  ]
  it('just before the roll only L1 is open; at the roll it is L2 — never a flat (0-leg) window', () => {
    expect(openLegs(foldActions(log, 199, LOT)).map((l) => l.id)).toEqual(['L1'])
    const after = foldActions(log, 200, LOT)
    expect(openLegs(after).map((l) => l.id)).toEqual(['L2']) // no instant where 0 legs open
    expect(after.legs.get('L1').open).toBe(false)
  })
  it('closed-leg realize + new-leg open are stamped at the SAME unix', () => {
    const after = foldActions(log, 200, LOT)
    const ev = after.events.find((e) => e.type === 'roll')
    expect(ev.t).toBe(200)
    expect(after.legs.get('L2').openedAt).toBe(200) // same t as the close
    expect(ev.closeRealized).toBeCloseTo((150 - 100) * 1 * 75 * 3, 6) // 11250
    expect(after.legs.get('L2').entryPrice).toBe(80)
  })
})

// ── Test 2 ───────────────────────────────────────────────────────────────────
describe('2. Reduce 3->1 realizes only the closed lots; remaining keeps original entry', () => {
  const f = foldActions(
    [entry({ t: 100, legId: 'L1', ...ce({ lots: 3 }), price: 100 }), reduceLots({ t: 200, legId: 'L1', lots: 2, price: 130 })],
    200, LOT,
  )
  it('realized = 2 lots at current price', () => expect(f.realized).toBeCloseTo((130 - 100) * 1 * 75 * 2, 6)) // 4500
  it('remaining 1 lot still at the ORIGINAL entry (not re-based)', () => {
    expect(f.legs.get('L1').lots).toBe(1)
    expect(f.legs.get('L1').entryPrice).toBe(100)
    expect(f.legs.get('L1').open).toBe(true)
  })
})

// ── Test 3 ───────────────────────────────────────────────────────────────────
describe('3. Average then partial close — cost basis exact to the paisa (both directions)', () => {
  it('average UP then close 1 lot', () => {
    const f = foldActions([
      entry({ t: 100, legId: 'L1', ...ce({ lots: 1 }), price: 100 }),
      addLots({ t: 200, legId: 'L1', lots: 1, price: 131 }), // (100+131)/2 = 115.50
      reduceLots({ t: 300, legId: 'L1', lots: 1, price: 150 }),
    ], 300, LOT)
    expect(roundPaisa(f.legs.get('L1').entryPrice)).toBe(115.5)
    expect(f.legs.get('L1').lots).toBe(1)
    expect(roundPaisa(f.realized)).toBe(2587.5) // (150-115.50) * 75
  })
  it('average DOWN lowers the weighted entry', () => {
    const f = foldActions([
      entry({ t: 100, legId: 'L1', ...ce({ lots: 2 }), price: 120 }),
      addLots({ t: 200, legId: 'L1', lots: 2, price: 100 }), // (240+200)/4 = 110
    ], 200, LOT)
    expect(roundPaisa(f.legs.get('L1').entryPrice)).toBe(110)
    expect(f.legs.get('L1').lots).toBe(4)
  })
})

// ── Test 4 (THE KEY ONE) ──────────────────────────────────────────────────────
describe('4. Scrub coherence: realized appears at the close t, exactly once', () => {
  const log = [
    entry({ t: 100, legId: 'L1', ...ce({ lots: 1 }), price: 100 }),
    exitLeg({ t: 200, legId: 'L1', price: 150 }),
  ]
  const expected = (150 - 100) * 1 * 75 * 1 // 3750
  it('scrub to t=150 -> realized ABSENT, leg still open', () => {
    const f = foldActions(log, 150, LOT)
    expect(f.realized).toBe(0)
    expect(openLegs(f).map((l) => l.id)).toEqual(['L1'])
  })
  it('appears exactly at the close boundary (199 absent, 200 present)', () => {
    expect(foldActions(log, 199, LOT).realized).toBe(0)
    expect(foldActions(log, 200, LOT).realized).toBeCloseTo(expected, 6)
  })
  it('scrub to t=250 -> realized PRESENT once, leg closed', () => {
    const f = foldActions(log, 250, LOT)
    expect(f.realized).toBeCloseTo(expected, 6)
    expect(openLegs(f)).toHaveLength(0)
  })
  it('idempotent + reversible: reading twice never doubles; scrubbing back un-realizes', () => {
    expect(foldActions(log, 250, LOT).realized).toBe(foldActions(log, 250, LOT).realized) // no double-count
    expect(foldActions(log, 150, LOT).realized).toBe(0) // back to before the close
  })
})

// ── Test 5 ───────────────────────────────────────────────────────────────────
describe('5. Group exit and portfolio exit each close all member legs in ONE action', () => {
  const E = (legId, groupId, strike, type, price) => entry({ t: 100, legId, expiry: EXP, strike, type, side: -1, lots: 1, groupId, price })
  const base = [E('G1CE', 'G1', 22000, 'CE', 120), E('G1PE', 'G1', 22000, 'PE', 110), E('G2CE', 'G2', 22500, 'CE', 60)]

  it('group exit closes both G1 legs in one event; G2 untouched', () => {
    const f = foldActions([...base, exitGroup({ t: 200, groupId: 'G1', prices: { G1CE: 90, G1PE: 130 } })], 200, LOT)
    expect(f.legs.get('G1CE').open).toBe(false)
    expect(f.legs.get('G1PE').open).toBe(false)
    expect(f.legs.get('G2CE').open).toBe(true)
    const exits = f.events.filter((e) => e.type === 'exit')
    expect(exits).toHaveLength(1)
    expect(exits[0].legIds.slice().sort()).toEqual(['G1CE', 'G1PE'])
    expect(roundPaisa(f.realizedByGroup.get('G1'))).toBe(roundPaisa((90 - 120) * -1 * 75 + (130 - 110) * -1 * 75)) // 2250 - 1500 = 750
  })
  it('portfolio exit closes everything still open', () => {
    const f = foldActions(
      [...base, exitGroup({ t: 200, groupId: 'G1', prices: { G1CE: 90, G1PE: 130 } }), exitPortfolio({ t: 300, prices: { G2CE: 40 } })],
      300, LOT,
    )
    expect(openLegs(f)).toHaveLength(0)
    expect(f.events.filter((e) => e.type === 'exit')).toHaveLength(2)
  })
})

// ── book integration: realized + unrealized + greeks tie together ─────────────
describe('portfolioAt: book = realized (fold) + unrealized & greeks (snapshot)', () => {
  it('open leg shows unrealized+greeks & 0 realized; past its close shows realized & no greeks', () => {
    const tOpen = sessionUnix('2026-03-23', 9, 30)
    const S = 22000
    const Topen = (sessionUnix(EXP, 15, 30) - tOpen) / (365.25 * 86400)
    const px = bsPrice({ S, K: 22000, T: Topen, r: 0.065, sigma: 0.2, type: 'CE' })
    const log = [
      entry({ t: tOpen, legId: 'L1', expiry: EXP, strike: 22000, type: 'CE', side: 1, lots: 1, price: px }),
      exitLeg({ t: sessionUnix('2026-03-23', 14, 0), legId: 'L1', price: px + 20 }),
    ]
    const baseCtx = { r: 0.065, spot: S, lotSizeFor: () => 75 }
    const snap = { priceFor: () => px }

    const t1 = sessionUnix('2026-03-23', 12, 0)
    const before = portfolioAt({ actions: log, t: t1, snapshot: snap, ctx: { ...baseCtx, clockUnix: t1 } })
    expect(before.realized).toBe(0)
    expect(before.openLegs).toHaveLength(1)
    expect(before.greeks.delta).toBeGreaterThan(0) // long call

    const t2 = sessionUnix('2026-03-23', 15, 0)
    const after = portfolioAt({ actions: log, t: t2, snapshot: snap, ctx: { ...baseCtx, clockUnix: t2 } })
    expect(roundPaisa(after.realized)).toBe(roundPaisa(20 * 75)) // 1500
    expect(after.openLegs).toHaveLength(0)
    expect(after.greeks.delta).toBe(0)
  })

  it('ungrouped legs feed portfolio totals but do NOT form a synthetic null group', () => {
    const tOpen = sessionUnix('2026-03-23', 9, 30)
    const t = sessionUnix('2026-03-23', 12, 0)
    const S = 22000
    const T = (sessionUnix(EXP, 15, 30) - tOpen) / (365.25 * 86400)
    const px = bsPrice({ S, K: 22000, T, r: 0.065, sigma: 0.2, type: 'CE' })
    const log = [entry({ t: tOpen, legId: 'L1', expiry: EXP, strike: 22000, type: 'CE', side: 1, lots: 1, groupId: null, price: px })]
    const snap = { priceFor: () => px + 5 } // small unrealized move
    const book = portfolioAt({ actions: log, t, snapshot: snap, ctx: { r: 0.065, spot: S, clockUnix: t, lotSizeFor: () => 75 } })
    expect(book.groups.map((g) => g.groupId)).not.toContain(null) // no bogus null group
    expect(book.openLegs).toHaveLength(1)
    expect(roundPaisa(book.unrealized)).toBe(roundPaisa(5 * 75)) // still in portfolio total
  })
})
