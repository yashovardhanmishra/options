import { describe, it, expect } from 'vitest'
import { entry } from '../../portfolio/actions.js'
import { foldActions, openLegs } from '../../portfolio/fold.js'
import { buildTimeline } from '../../replay/timeline.js'
import { ReplayClock } from '../../replay/clock.js'
import { Transport } from '../../replay/transport.js'
import { evaluateRisk } from '../engine.js'
import { portfolioAt } from '../../portfolio/book.js'
import { sessionUnix } from '../../engine/time.js'
import { bsPrice } from '../../engine/bs.js'

const EXP = '2026-03-30'
const LOT = () => 75

// Mock book: real fold (so exits flatten the book) + controlled per-option Greeks.
// position_greek = per_option * lot * lots * side  (per the spec). perOption(leg,t) lets a
// test drive Greeks by leg or by the clock.
function mockBookAt(perOption, priceMap = {}) {
  const sum = (arr) =>
    arr.reduce((a, s) => ({ delta: a.delta + s.greeks.delta, gamma: a.gamma + s.greeks.gamma, vega: a.vega + s.greeks.vega, theta: a.theta + s.greeks.theta }), { delta: 0, gamma: 0, vega: 0, theta: 0 })
  return (log, t) => {
    const open = openLegs(foldActions(log, t, LOT))
    const states = open.map((leg) => {
      const g = perOption(leg, t)
      const scale = 75 * leg.lots * leg.side
      return { leg, priceNow: priceMap[leg.id] ?? 100, greeks: { delta: (g.delta ?? 0) * scale, gamma: (g.gamma ?? 0) * scale, vega: (g.vega ?? 0) * scale, theta: (g.theta ?? 0) * scale } }
    })
    const gids = [...new Set(open.map((l) => l.groupId).filter((id) => id != null))]
    const groups = gids.map((groupId) => { const ls = states.filter((s) => s.leg.groupId === groupId); return { groupId, greeks: sum(ls), legs: ls } })
    return { greeks: sum(states), groups, openLegs: states }
  }
}

const longCall = (legId, lots, groupId = null) => entry({ t: 100, legId, expiry: EXP, strike: 22000, type: 'CE', side: 1, lots, groupId, price: 100 })

// ── Test 1 ───────────────────────────────────────────────────────────────────
describe('1. breach fires -> exitPortfolio risk_breach, all flat after', () => {
  it('net |Δ| past the portfolio limit liquidates everything', () => {
    const log = [longCall('L1', 2)] // pos Δ = 0.5*75*2 = 75
    const bookAt = mockBookAt(() => ({ delta: 0.5 }), { L1: 120 })
    const { actions, breaches } = evaluateRisk({ actions: log, t: 200, limits: { portfolio: { delta: 50 } }, bookAt })
    expect(actions).toHaveLength(1)
    expect(actions[0].scope.kind).toBe('portfolio')
    expect(actions[0].t).toBe(200)
    expect(actions[0].reason).toBe('risk_breach')
    expect(actions[0].meta).toMatchObject({ scope: 'portfolio', metric: 'delta', limit: 50 })
    expect(breaches[0]).toMatchObject({ scope: 'portfolio', metric: 'delta', value: 75, limit: 50 })
    expect(openLegs(foldActions([...log, ...actions], 200, LOT))).toHaveLength(0) // flat
  })
})

// ── Test 4 ───────────────────────────────────────────────────────────────────
describe('4. group scope: only the breaching group closes', () => {
  it('G1 over its limit, G2 within -> exitGroup(G1) only', () => {
    const log = [longCall('A', 2, 'G1'), longCall('B', 1, 'G2')] // ΔG1=75, ΔG2=37.5
    const bookAt = mockBookAt(() => ({ delta: 0.5 }), { A: 110, B: 70 })
    const { actions } = evaluateRisk({ actions: log, t: 200, limits: { groups: { G1: { delta: 50 }, G2: { delta: 50 } } }, bookAt })
    expect(actions).toHaveLength(1)
    expect(actions[0].scope).toMatchObject({ kind: 'group', id: 'G1' })
    const f = foldActions([...log, ...actions], 200, LOT)
    expect(f.legs.get('A').open).toBe(false) // G1 closed
    expect(f.legs.get('B').open).toBe(true) //  G2 untouched
  })
})

// ── Test 5 ───────────────────────────────────────────────────────────────────
describe('5. near-limit warning (80-99%) is decision-only', () => {
  it('sets a warning flag, appends NO action', () => {
    const log = [longCall('L1', 1)] // pos Δ = 37.5; limit 40 -> 93.75%
    const bookAt = mockBookAt(() => ({ delta: 0.5 }), { L1: 110 })
    const { actions, warnings } = evaluateRisk({ actions: log, t: 200, limits: { portfolio: { delta: 40 } }, bookAt })
    expect(actions).toHaveLength(0)
    expect(warnings.some((w) => w.scope === 'portfolio' && w.metric === 'delta')).toBe(true)
  })
})

// ── Test 6 ───────────────────────────────────────────────────────────────────
describe('6. multi-metric independence: a Theta breach fires with Delta within limit', () => {
  it('Δ ok but |Θ| over -> still liquidates (Θ breach)', () => {
    // short put: per-option delta small, theta large; after ×side the position theta is +.
    const log = [entry({ t: 100, legId: 'L1', expiry: EXP, strike: 22000, type: 'PE', side: -1, lots: 2, price: 100 })]
    const bookAt = mockBookAt(() => ({ delta: 0.1, theta: -5 }), { L1: 90 })
    // posΔ = 0.1*75*2*-1 = -15 (|15|<100); posΘ = -5*75*2*-1 = +750 (|750|>500)
    const { actions, breaches } = evaluateRisk({ actions: log, t: 200, limits: { portfolio: { delta: 100, theta: 500 } }, bookAt })
    expect(actions).toHaveLength(1)
    expect(breaches[0].metric).toBe('theta')
  })
})

// ── Playback harness for tests 2 & 3 ──────────────────────────────────────────
// 10-bar timeline; per-option Δ steps from 0.3 to 0.8 at bar 5, so position Δ (lots=2)
// goes 45 -> 120 and crosses the portfolio limit of 75 exactly at bar 5.
const times = Array.from({ length: 10 }, (_, i) => 1000 + i * 60)
const timeline = buildTimeline([{ date: 'd1', minutes: times }])
const breachAt = times[5]
const perOption = (_leg, t) => ({ delta: t >= breachAt ? 0.8 : 0.3 })
const limits = { portfolio: { delta: 75 } }
const initialLog = () => [entry({ t: times[0], legId: 'L1', expiry: EXP, strike: 22000, type: 'CE', side: 1, lots: 2, price: 100 })]

function runPlayback(speed) {
  const clock = new ReplayClock(timeline, 0)
  const log = initialLog()
  const bookAt = mockBookAt(perOption)
  const evalBar = (index) => {
    const u = timeline.times[index]
    for (const a of evaluateRisk({ actions: log, t: u, limits, bookAt }).actions) log.push(a)
  }
  evalBar(0) // the initial bar is evaluated too
  const t = new Transport(clock, { onEvaluate: evalBar }).setSpeed(speed)
  while (!clock.atEnd()) t.frame()
  return log
}
const breachExits = (log) => log.filter((a) => a.reason === 'risk_breach')

// ── Test 2 (KEY) ──────────────────────────────────────────────────────────────
describe('2. same-bar determinism: breach lands on the identical unix at 1x and max', () => {
  it('the risk_breach exit fires at bar 5 regardless of speed', () => {
    const log1x = runPlayback('1x')
    const logMax = runPlayback('max')
    const e1 = breachExits(log1x)
    const eMax = breachExits(logMax)
    expect(e1).toHaveLength(1)
    expect(eMax).toHaveLength(1)
    expect(e1[0].t).toBe(breachAt)
    expect(eMax[0].t).toBe(breachAt)
    expect(e1[0].t).toBe(eMax[0].t) // identical firing bar at any speed
  })
})

// ── Test 3 (KEY) ──────────────────────────────────────────────────────────────
describe('3. idempotency: re-fold / scrub back-and-forth never duplicates the liquidation', () => {
  it('exactly ONE risk_breach exit, and re-evaluating any bar appends nothing', () => {
    const log = runPlayback('max')
    expect(breachExits(log)).toHaveLength(1) // fired once during playback

    const bookAt = mockBookAt(perOption)
    // re-evaluate the breach bar itself -> the exit is already folded in -> no new action
    expect(evaluateRisk({ actions: log, t: breachAt, limits, bookAt }).actions).toHaveLength(0)
    // scrub across every bar again -> still nothing appended
    const extra = times.reduce((n, u) => n + evaluateRisk({ actions: log, t: u, limits, bookAt }).actions.length, 0)
    expect(extra).toBe(0)
    expect(breachExits(log)).toHaveLength(1) // never duplicated
  })
})

// ── Untradeable (null-price) legs: the missed-breach / non-convergence guard ──────
describe('untradeable (null-price) legs do not poison risk or spin the fixpoint', () => {
  const tt = sessionUnix('2026-03-23', 12, 0)
  const S = 22000
  const T = (sessionUnix(EXP, 15, 30) - tt) / (365.25 * 86400)
  const px = bsPrice({ S, K: 22000, T, r: 0.065, sigma: 0.2, type: 'CE' })
  // L1 priceable (real Greeks); L2 has NO price at t (strike 99999) -> untradeable
  const log = [
    entry({ t: sessionUnix('2026-03-23', 9, 30), legId: 'L1', expiry: EXP, strike: 22000, type: 'CE', side: 1, lots: 1, price: px }),
    entry({ t: sessionUnix('2026-03-23', 9, 30), legId: 'L2', expiry: EXP, strike: 99999, type: 'CE', side: 1, lots: 50, price: 1 }),
  ]
  const bookAt = (l, u) => portfolioAt({ actions: l, t: u, snapshot: { priceFor: (leg) => (leg.strike === 99999 ? null : px) }, ctx: { r: 0.065, spot: S, clockUnix: u, lotSizeFor: () => 75 } })

  it('untradeable leg excluded from Greeks (no NaN) and surfaced', () => {
    const book = bookAt(log, tt)
    expect(book.untradeable.map((b) => b.id)).toEqual(['L2'])
    expect(book.openLegs.map((s) => s.leg.id)).toEqual(['L1'])
    expect(Number.isFinite(book.greeks.delta)).toBe(true) // not poisoned by L2
  })
  it('high limit -> no breach, converges (no spurious action / spin)', () => {
    const res = evaluateRisk({ actions: log, t: tt, limits: { portfolio: { delta: 100000 } }, bookAt })
    expect(res.actions).toHaveLength(0)
    expect(res.warnings.some((w) => w.metric === 'convergence')).toBe(false)
    expect(res.untradeable.map((b) => b.id)).toEqual(['L2'])
  })
  it('breach on the priceable leg fires ONCE and converges; untradeable leg stays open + surfaced', () => {
    const dl = Math.floor(Math.abs(bookAt(log, tt).greeks.delta) * 0.5)
    const res = evaluateRisk({ actions: log, t: tt, limits: { portfolio: { delta: dl } }, bookAt })
    expect(res.actions).toHaveLength(1) // not spinning to maxRounds
    expect(res.warnings.some((w) => w.metric === 'convergence')).toBe(false)
    const f = foldActions([...log, ...res.actions], tt, () => 75)
    expect(f.legs.get('L1').open).toBe(false) // priceable leg squared off
    expect(f.legs.get('L2').open).toBe(true) //  untradeable leg can't be priced -> stays open
    expect(f.events.find((e) => e.type === 'exit').skipped).toEqual(['L2']) // surfaced, not silent
  })
})
