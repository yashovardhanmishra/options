import { describe, it, expect } from 'vitest'
import { sessionUnix } from '../../engine/time.js'
import {
  buildTimeline, indexAtOrBefore, indexAtOrAfter, sessionOf, isSessionStart, isSessionEnd, indexOfDateStart,
} from '../timeline.js'

const D1 = '2026-03-23'
const D2 = '2026-03-24'
const day1 = [sessionUnix(D1, 9, 15), sessionUnix(D1, 9, 16), sessionUnix(D1, 15, 29)]
const day2 = [sessionUnix(D2, 9, 15), sessionUnix(D2, 9, 16)]
const tl = buildTimeline([{ date: D1, minutes: day1 }, { date: D2, minutes: day2 }])

describe('buildTimeline', () => {
  it('concatenates day minutes in order and marks session ranges', () => {
    expect(tl.times).toEqual([...day1, ...day2])
    expect(tl.sessions).toHaveLength(2)
    expect(tl.sessions[0]).toMatchObject({ date: D1, startIndex: 0, endIndex: 2 })
    expect(tl.sessions[1]).toMatchObject({ date: D2, startIndex: 3, endIndex: 4 })
  })
  it('only includes minutes that have bars (no generated wall-clock range)', () => {
    // there is no 12:00 of D1 in the data -> it is absent from the timeline
    expect(tl.times.includes(sessionUnix(D1, 12, 0))).toBe(false)
  })
  it('skips empty days', () => {
    const t2 = buildTimeline([{ date: D1, minutes: [] }, { date: D2, minutes: day2 }])
    expect(t2.sessions).toHaveLength(1)
    expect(t2.sessions[0].date).toBe(D2)
  })
  it('an all-empty timeline fails fast in sessionOf (no silent undefined)', () => {
    const empty = buildTimeline([{ date: D1, minutes: [] }])
    expect(empty.times).toHaveLength(0)
    expect(() => sessionOf(empty, 0)).toThrow(/no sessions/)
  })
})

describe('boundary + lookup helpers', () => {
  it('session boundaries are adjacent indices (end of N, start of N+1)', () => {
    expect(isSessionEnd(tl, 2)).toBe(true) // last of D1
    expect(isSessionStart(tl, 3)).toBe(true) // first of D2
    expect(sessionOf(tl, 2).date).toBe(D1)
    expect(sessionOf(tl, 3).date).toBe(D2)
  })
  it('indexAtOrBefore is exclusive of future bars', () => {
    expect(indexAtOrBefore(tl, sessionUnix(D1, 15, 29))).toBe(2)
    expect(indexAtOrBefore(tl, sessionUnix(D1, 20, 0))).toBe(2) // gap -> prior close
    expect(indexAtOrBefore(tl, sessionUnix(D1, 9, 0))).toBe(-1) // before first bar
  })
  it('indexAtOrAfter finds the next bar', () => {
    expect(indexAtOrAfter(tl, sessionUnix(D1, 20, 0))).toBe(3) // overnight -> D2 open
  })
  it('indexOfDateStart goes to the day’s first bar', () => {
    expect(indexOfDateStart(tl, D2)).toBe(3)
  })
})
