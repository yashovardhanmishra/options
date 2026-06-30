import { describe, it, expect } from 'vitest'
import { detectEvents } from '../events.js'

const sessions = [
  { date: '2026-03-26', startIndex: 0, endIndex: 2 },
  { date: '2026-03-27', startIndex: 3, endIndex: 5 },
]
// i3 is a session start → its delta (200−130) is an overnight gap and must be skipped.
const spots = [100, 110, 130, 200, 205, 195]
const curve = [0, -50, 300, 200, 500, 50].map((equity, index) => ({ index, t: index, realized: 0, unrealized: equity, equity }))
const byKey = (evs) => Object.fromEntries(evs.map((e) => [e.key, e]))

describe('detectEvents', () => {
  it('finds the biggest intraday spot move, skipping overnight gaps', () => {
    const k = byKey(detectEvents({ spots, curve, sessions, expiry: '2026-03-27' }))
    expect(k.spot_move.index).toBe(2) // +20, not the +70 overnight gap at i3
    expect(k.spot_up).toBeUndefined() // coincides with biggest move → dropped
    expect(k.spot_down.index).toBe(5) // −10
  })
  it('finds max-drawdown trough and MTM peak/low from the curve', () => {
    const k = byKey(detectEvents({ spots, curve, sessions, expiry: '2026-03-27' }))
    expect(k.dd_trough.index).toBe(5)
    expect(k.mtm_peak.index).toBe(4)
    expect(k.mtm_low.index).toBe(1)
  })
  it('marks the expiry-day open in a multi-day window', () => {
    const k = byKey(detectEvents({ spots, curve, sessions, expiry: '2026-03-27' }))
    expect(k.expiry_start.index).toBe(3)
  })
  it('hides curve events when there are no trades', () => {
    const flat = curve.map((p) => ({ ...p, unrealized: 0, equity: 0 }))
    const evs = detectEvents({ spots, curve: flat, sessions, expiry: '2026-03-27' })
    expect(evs.some((e) => ['dd_trough', 'mtm_peak', 'mtm_low'].includes(e.key))).toBe(false)
    expect(evs.some((e) => e.key === 'spot_move')).toBe(true)
  })
  it('suppresses the expiry chip on a single-day window', () => {
    const evs = detectEvents({ spots: [100, 110, 130], curve: null, sessions: [sessions[0]], expiry: '2026-03-26' })
    expect(evs.some((e) => e.key === 'expiry_start')).toBe(false)
  })
})
