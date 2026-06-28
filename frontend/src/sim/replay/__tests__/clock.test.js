import { describe, it, expect } from 'vitest'
import { sessionUnix } from '../../engine/time.js'
import { buildTimeline } from '../timeline.js'
import { ReplayClock } from '../clock.js'

// Two trading days; the overnight gap is collapsed in the index (15:29 -> 09:15).
const D1 = '2026-03-23'
const D2 = '2026-03-24'
const day1 = [sessionUnix(D1, 9, 15), sessionUnix(D1, 9, 16), sessionUnix(D1, 15, 28), sessionUnix(D1, 15, 29)]
const day2 = [sessionUnix(D2, 9, 15), sessionUnix(D2, 9, 16), sessionUnix(D2, 11, 0)]
const tl = buildTimeline([{ date: D1, minutes: day1 }, { date: D2, minutes: day2 }])
// indices: 0..3 = day1, 4..6 = day2

describe('step across a session boundary', () => {
  it('last bar of day N (15:29) -> first bar of day N+1 (09:15), no dead minute', () => {
    const c = new ReplayClock(tl, 3) // day1 15:29
    expect(c.atSessionEnd()).toBe(true)
    expect(c.unix()).toBe(sessionUnix(D1, 15, 29))
    c.step(1)
    expect(c.index).toBe(4) // exactly one index forward
    expect(c.atSessionStart()).toBe(true)
    expect(c.unix()).toBe(sessionUnix(D2, 9, 15)) // overnight gap skipped
    expect(c.session().date).toBe(D2)
  })
  it('step back across the boundary returns to day N close', () => {
    const c = new ReplayClock(tl, 4)
    c.step(-1)
    expect(c.unix()).toBe(sessionUnix(D1, 15, 29))
  })
})

describe('scrub lands exactly on a boundary', () => {
  it('seek to the session start index = first bar of day N+1', () => {
    const c = new ReplayClock(tl, 0)
    c.seek(4)
    expect(c.atSessionStart()).toBe(true)
    expect(c.session().date).toBe(D2)
    expect(c.unix()).toBe(sessionUnix(D2, 9, 15))
  })
  it('scrub-to-time onto the 09:15 open lands on the boundary bar', () => {
    const c = new ReplayClock(tl, 0)
    c.seekToUnix(sessionUnix(D2, 9, 15))
    expect(c.index).toBe(4)
    expect(c.atSessionStart()).toBe(true)
  })
  it('scrubbing into the overnight gap clamps to the prior close (monotonic)', () => {
    const c = new ReplayClock(tl, 0)
    c.seekToUnix(sessionUnix(D1, 20, 0)) // a time with no bar (after close)
    expect(c.unix()).toBe(sessionUnix(D1, 15, 29)) // last available bar, not a dead minute
  })
})

describe('jump-to-date and bounds', () => {
  it('jumpToDate(D2) goes to its first bar', () => {
    const c = new ReplayClock(tl, 0)
    c.jumpToDate(D2)
    expect(c.unix()).toBe(sessionUnix(D2, 9, 15))
  })
  it('jumpToDate(D1, 15:28) lands on that minute', () => {
    const c = new ReplayClock(tl, 0)
    c.jumpToDate(D1, 15, 28)
    expect(c.unix()).toBe(sessionUnix(D1, 15, 28))
  })
  it('clamps at both ends', () => {
    const c = new ReplayClock(tl, 0)
    c.step(-5)
    expect(c.index).toBe(0)
    expect(c.atStart()).toBe(true)
    c.seek(999)
    expect(c.index).toBe(6)
    expect(c.atEnd()).toBe(true)
  })
})
