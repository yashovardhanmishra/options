// End-to-end acceptance tests 4-7, run THROUGH the assembled sim (runner + curve), not
// just individual modules.
import { describe, it, expect } from 'vitest'
import { buildSession, snapshotAt, makeContext } from '../data/snapshot.js'
import { buildTimeline } from '../replay/timeline.js'
import { assertNoLookahead } from '../data/series.js'
import { sessionUnix } from '../engine/time.js'
import { bsPrice, intrinsic } from '../engine/bs.js'
import { entry } from '../portfolio/actions.js'
import { foldActions, openLegs } from '../portfolio/fold.js'
import { portfolioAt } from '../portfolio/book.js'
import { roundPaisa } from '../engine/mtm.js'
import { evaluateExpiry } from '../risk/expiry.js'
import { equityCurve } from '../replay/equity.js'
import { runSession } from '../replay/runner.js'

const EXP = '2026-03-30'
const ramp = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))

// Synthetic session: spot per bar + BS-consistent CE/PE premiums for each strike, so the
// snapshot/Greeks are sane. Single date.
function makeSyntheticSession({ date, spots, strikes, sigma = 0.2, r = 0.065, expiry = EXP }) {
  const t0 = sessionUnix(date, 9, 15)
  const times = spots.map((_, i) => t0 + i * 60)
  const expU = sessionUnix(expiry, 15, 30)
  const spotBars = spots.map((s, i) => [times[i], s, s, s, s, 0])
  const instruments = []
  for (const K of strikes)
    for (const type of ['CE', 'PE']) {
      const bars = spots.map((s, i) => {
        const T = Math.max((expU - times[i]) / (365.25 * 86400), 1e-6)
        const px = bsPrice({ S: s, K, T, r, sigma, type })
        return [times[i], px, px, px, px, 0, 1000]
      })
      instruments.push({ strike: K, type, bars })
    }
  return { session: buildSession({ expiry, expiries: [expiry], spotBars, instruments }), timeline: buildTimeline([{ date, minutes: times }]), times }
}

// ── Acceptance 4 — determinism ────────────────────────────────────────────────
describe('4. determinism: byte-identical equity curve at 1x and max', () => {
  it('same actions on the same expiry/date -> identical curve (incl. the expiry auto-action)', () => {
    const { session, timeline } = makeSyntheticSession({ date: EXP, spots: ramp(22000, 22120, 12), strikes: [22000] })
    const snapAt = (t) => snapshotAt(session, t)
    const ctxAt = (t) => makeContext(session, snapAt(t))
    const entryPx = snapAt(timeline.times[0]).priceFor({ strike: 22000, type: 'CE' })
    const log0 = [entry({ t: timeline.times[0], legId: 'L1', expiry: EXP, strike: 22000, type: 'CE', side: 1, lots: 1, price: entryPx })]

    const r1 = runSession({ timeline, snapshotAt: snapAt, ctxAt, expiry: EXP, initialLog: log0, speed: '1x' })
    const rMax = runSession({ timeline, snapshotAt: snapAt, ctxAt, expiry: EXP, initialLog: log0, speed: 'max' })

    expect(rMax.curve.map((p) => p.equity)).toEqual(r1.curve.map((p) => p.equity)) // byte-identical
    expect(rMax.curve.map((p) => p.realized)).toEqual(r1.curve.map((p) => p.realized))
    expect(rMax.log.length).toBe(r1.log.length)
    expect(r1.log.some((a) => a.reason === 'expiry')).toBe(true) // pipeline exercised
    expect(r1.curve[r1.curve.length - 1].unrealized).toBeCloseTo(0, 6) // settled at the end
  })
})

// ── Acceptance 5 — anti-lookahead at curve level ──────────────────────────────
describe('5. anti-lookahead: a future bar never reaches a curve point', () => {
  it('a future premium SPIKE is invisible until its own bar; the hard assertion guards it', () => {
    const date = '2026-03-23'
    const u = (hh, mm) => sessionUnix(date, hh, mm)
    const times = [u(9, 15), u(9, 16), u(9, 17), u(9, 18), u(9, 19)]
    // CE flat at 100 until 9:17, NO 9:18 bar, then a future SPIKE of 999 at 9:19
    const ceBars = [
      [times[0], 100, 100, 100, 100, 0, 1000],
      [times[1], 100, 100, 100, 100, 0, 1000],
      [times[2], 100, 100, 100, 100, 0, 1000],
      [times[4], 999, 999, 999, 999, 0, 1000],
    ]
    const spotBars = times.map((t) => [t, 22000, 22000, 22000, 22000, 0]) // spot every minute -> 9:18 exists
    const session = buildSession({ expiry: EXP, expiries: [EXP], spotBars, instruments: [{ strike: 22000, type: 'CE', bars: ceBars }] })
    const timeline = buildTimeline([{ date, minutes: times }])
    const snapAt = (t) => snapshotAt(session, t)
    const ctxAt = (t) => makeContext(session, snapAt(t))
    const log = [entry({ t: times[0], legId: 'L1', expiry: EXP, strike: 22000, type: 'CE', side: 1, lots: 1, price: 100 })]

    const curve = equityCurve({ actions: log, timeline, snapshotAt: snapAt, ctxAt })
    // at 9:18 (index 3) the CE forward-fills from 9:17 — NOT the future 9:19 spike
    expect(snapAt(times[3]).chain.find((r) => r.strike === 22000).ce.u).toBe(times[2])
    const fromSpike = (999 - 100) * 65 // unrealized IF the future bar leaked
    for (let i = 0; i < 4; i++) expect(Math.abs(curve[i].unrealized - fromSpike)).toBeGreaterThan(1) // no leak before 9:19
    expect(curve[4].unrealized).toBeCloseTo(fromSpike, 0) // the spike only shows at its own bar
    // the hard assertion fires if any code ever passes a future bar
    expect(() => assertNoLookahead(times[4], times[3])).toThrow(/anti-lookahead/)
  })
})

// ── Acceptance 6 — risk breach reflected in the curve ─────────────────────────
describe('6. risk breach: auto square-off within one bar; curve reflects it; idempotent', () => {
  it('a low limit liquidates once and the curve goes flat at the breach bar', () => {
    const { session, timeline } = makeSyntheticSession({ date: '2026-03-23', spots: [21900, 22100, 22100, 22100, 22100], strikes: [22000] })
    const snapAt = (t) => snapshotAt(session, t)
    const ctxAt = (t) => makeContext(session, snapAt(t))
    const entryPx = snapAt(timeline.times[0]).priceFor({ strike: 22000, type: 'CE' })
    const log0 = [entry({ t: timeline.times[0], legId: 'L1', expiry: EXP, strike: 22000, type: 'CE', side: 1, lots: 3, price: entryPx })]

    const delAt = (i) => Math.abs(portfolioAt({ actions: log0, t: timeline.times[i], snapshot: snapAt(timeline.times[i]), ctx: ctxAt(timeline.times[i]) }).greeks.delta)
    const d0 = delAt(0)
    const d1 = delAt(1)
    expect(d1).toBeGreaterThan(d0) // long-call delta rose as spot rose
    const limit = (d0 + d1) / 2 // strictly between -> ok at bar 0, breach at bar 1

    const res = runSession({ timeline, snapshotAt: snapAt, ctxAt, expiry: EXP, initialLog: log0, limits: { portfolio: { delta: limit } }, speed: 'max' })
    const breaches = res.log.filter((a) => a.reason === 'risk_breach')
    expect(breaches).toHaveLength(1) // exactly one liquidation
    expect(breaches[0].t).toBe(timeline.times[1]) // fired within one bar of the move
    const bi = res.curve.findIndex((p) => p.t === timeline.times[1])
    expect(res.curve[bi].unrealized).toBeCloseTo(0, 6) // flat at the breach bar
    expect(res.curve[res.curve.length - 1].unrealized).toBeCloseTo(0, 6) // stays flat
    // idempotent under scrub: re-sampling the final log gives the identical curve
    expect(equityCurve({ actions: res.log, timeline, snapshotAt: snapAt, ctxAt }).map((p) => p.equity)).toEqual(res.curve.map((p) => p.equity))
  })
})

// ── Acceptance 7 — expiry settlement at intrinsic ─────────────────────────────
describe('7. expiry settlement: ITM -> intrinsic, OTM -> 0', () => {
  const LOT = () => 75
  it('settles each open leg at intrinsic from spot at 15:30, as a reason:expiry action', () => {
    const tExp = sessionUnix(EXP, 15, 29) // the expiry bar (last bar of the day)
    const S = 22100
    const log = [
      entry({ t: 1000, legId: 'CE_ITM', expiry: EXP, strike: 22000, type: 'CE', side: 1, lots: 1, price: 80 }), // S>K -> 100
      entry({ t: 1000, legId: 'CE_OTM', expiry: EXP, strike: 22300, type: 'CE', side: 1, lots: 1, price: 50 }), // S<K -> 0
      entry({ t: 1000, legId: 'PE_ITM', expiry: EXP, strike: 22500, type: 'PE', side: 1, lots: 1, price: 120 }), // K>S -> 400
    ]
    const { actions } = evaluateExpiry({ actions: log, t: tExp, expiry: EXP, expiryBarUnix: tExp, spot: S, lotSizeFor: LOT })
    expect(actions).toHaveLength(1)
    expect(actions[0].reason).toBe('expiry')
    expect(actions[0].prices).toEqual({ CE_ITM: 100, CE_OTM: 0, PE_ITM: 400 }) // intrinsic, NOT last premium

    const f = foldActions([...log, ...actions], tExp, LOT)
    expect(openLegs(f)).toHaveLength(0) // all auto-closed at the expiry bar
    expect(roundPaisa(f.realizedByLeg.get('CE_ITM'))).toBe(roundPaisa((100 - 80) * 75)) // +1500
    expect(roundPaisa(f.realizedByLeg.get('CE_OTM'))).toBe(roundPaisa((0 - 50) * 75)) //  -3750 (full premium lost)
    expect(roundPaisa(f.realizedByLeg.get('PE_ITM'))).toBe(roundPaisa((400 - 120) * 75)) // +21000
    // intrinsic helper agrees
    expect(intrinsic(S, 22000, 'CE')).toBe(100)
    expect(intrinsic(S, 22300, 'CE')).toBe(0)
    expect(intrinsic(S, 22500, 'PE')).toBe(400)
  })

  it('through the assembled sim: settlement appears in the curve at the expiry bar', () => {
    // spot ends ITM for the 22000 CE (last spot 22120 > 22000)
    const { session, timeline } = makeSyntheticSession({ date: EXP, spots: ramp(22000, 22120, 8), strikes: [22000] })
    const snapAt = (t) => snapshotAt(session, t)
    const ctxAt = (t) => makeContext(session, snapAt(t))
    const entryPx = snapAt(timeline.times[0]).priceFor({ strike: 22000, type: 'CE' })
    const log0 = [entry({ t: timeline.times[0], legId: 'L1', expiry: EXP, strike: 22000, type: 'CE', side: 1, lots: 1, price: entryPx })]
    const res = runSession({ timeline, snapshotAt: snapAt, ctxAt, expiry: EXP, initialLog: log0, speed: 'max' })

    const settle = res.log.find((a) => a.reason === 'expiry')
    expect(settle).toBeTruthy()
    expect(settle.t).toBe(timeline.times[timeline.times.length - 1]) // at the expiry bar
    const last = res.curve[res.curve.length - 1]
    expect(last.unrealized).toBeCloseTo(0, 6) // settled -> no open legs
    // realized at the end = (intrinsic - entry) * lot, intrinsic from final spot 22120
    expect(roundPaisa(last.realized)).toBe(roundPaisa((intrinsic(22120, 22000, 'CE') - entryPx) * 65))
  })
})
