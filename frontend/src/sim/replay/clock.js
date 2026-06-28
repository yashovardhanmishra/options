// The replay clock: a thin stateful wrapper around the ONE index. The index is the
// single source of truth; play/pause, step, scrub and jump-to-date are all just ways
// to move it. Every nav is a pure function of the timeline, so the clock is fully
// deterministic. (React would hold `index` in state and call these helpers.)
import * as TL from './timeline.js'

export class ReplayClock {
  constructor(timeline, index = 0) {
    this.tl = timeline
    this.index = TL.clampIndex(timeline, index)
  }

  get length() {
    return this.tl.times.length
  }

  /** Current bar's opaque unix key. */
  unix() {
    return this.tl.times[this.index]
  }

  seek(i) {
    this.index = TL.clampIndex(this.tl, i)
    return this.index
  }

  step(n = 1) {
    this.index = TL.stepIndex(this.tl, this.index, n)
    return this.index
  }

  /** Scrub-to-time: land on the nearest bar at/before `unix`. */
  seekToUnix(unix) {
    this.index = Math.max(0, TL.indexAtOrBefore(this.tl, unix))
    return this.index
  }

  /** Jump to a date (its first bar) or a specific minute of that date. */
  jumpToDate(date, hh, mm) {
    this.index = hh == null ? TL.indexOfDateStart(this.tl, date) : TL.indexOfDateTime(this.tl, date, hh, mm)
    return this.index
  }

  session() {
    return TL.sessionOf(this.tl, this.index)
  }
  atSessionStart() {
    return TL.isSessionStart(this.tl, this.index)
  }
  atSessionEnd() {
    return TL.isSessionEnd(this.tl, this.index)
  }
  atStart() {
    return this.index <= 0
  }
  atEnd() {
    return this.index >= this.length - 1
  }
}
