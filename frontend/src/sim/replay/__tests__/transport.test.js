import { describe, it, expect } from 'vitest'
import { buildTimeline } from '../timeline.js'
import { ReplayClock } from '../clock.js'
import { Transport, framesFor, evaluatedIndices, speedToBarsPerFrame } from '../transport.js'

// A dense synthetic timeline of 50 bars across two sessions.
const day1 = Array.from({ length: 30 }, (_, i) => 1000 + i * 60)
const day2 = Array.from({ length: 20 }, (_, i) => 2000000 + i * 60) // overnight gap
const tl = buildTimeline([{ date: 'd1', minutes: day1 }, { date: 'd2', minutes: day2 }])
const N = tl.times.length // 50

describe('framesFor — pure speed-independence of the evaluated set', () => {
  it('flattened evaluated indices are identical for every speed', () => {
    const flat = (bpf) => framesFor(0, N - 1, bpf).flatMap((f) => f.evaluated)
    const expected = evaluatedIndices(0, N - 1) // [1..49]
    for (const bpf of [1, 5, 30, Infinity]) {
      expect(flat(bpf)).toEqual(expected)
    }
  })
  it('faster speed = fewer frames but never fewer evaluations', () => {
    expect(framesFor(0, N - 1, 1).length).toBe(N - 1) // one frame per bar
    expect(framesFor(0, N - 1, Infinity).length).toBe(1) // single frame
    // but both evaluate the same count
    const count = (bpf) => framesFor(0, N - 1, bpf).reduce((a, f) => a + f.evaluated.length, 0)
    expect(count(1)).toBe(count(Infinity))
  })
})

describe('Transport — playback speed does not change which bars are evaluated', () => {
  const runEvaluated = (speed) => {
    const clock = new ReplayClock(tl, 0)
    const seen = []
    const t = new Transport(clock, { onEvaluate: (i) => seen.push(tl.times[i]) })
    t.setSpeed(speed)
    while (!clock.atEnd()) t.frame()
    return seen
  }
  it('1x and max evaluate the exact same timestamps, in the same order', () => {
    const at1x = runEvaluated('1x')
    const atMax = runEvaluated('max')
    expect(at1x).toEqual(atMax)
    expect(at1x).toEqual(tl.times.slice(1)) // every bar after the start
  })
  it('5x and 30x also evaluate the full set', () => {
    expect(new Set(runEvaluated('5x'))).toEqual(new Set(tl.times.slice(1)))
    expect(new Set(runEvaluated('30x'))).toEqual(new Set(tl.times.slice(1)))
  })
  it('renders are throttled: max renders once, 1x renders every bar', () => {
    const renders = (speed) => {
      const clock = new ReplayClock(tl, 0)
      let r = 0
      const t = new Transport(clock, { onRender: () => r++ }).setSpeed(speed)
      while (!clock.atEnd()) t.frame()
      return r
    }
    expect(renders('1x')).toBe(N - 1)
    expect(renders('max')).toBe(1)
  })
})

describe('speed mapping', () => {
  it('maps the labels and falls back gracefully', () => {
    expect(speedToBarsPerFrame('1x')).toBe(1)
    expect(speedToBarsPerFrame('30x')).toBe(30)
    expect(speedToBarsPerFrame('max')).toBe(Infinity)
    expect(speedToBarsPerFrame(7)).toBe(7)
  })
})
