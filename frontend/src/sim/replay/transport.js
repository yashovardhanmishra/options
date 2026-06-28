// Play/advance logic. THE CARDINAL RULE: speed changes the RENDER cadence only —
// EVERY bar is still evaluated, regardless of speed. Skipping bars on fast-forward
// would make risk checks miss breaches and make the equity curve speed-dependent
// (breaking determinism, acceptance #4). So: evaluate every bar, render once a frame.

export const SPEEDS = { '1x': 1, '5x': 5, '30x': 30, max: Infinity }
export const speedToBarsPerFrame = (speed) => SPEEDS[speed] ?? (Number(speed) || 1)

/**
 * PURE: the render frames when advancing the index from `fromIndex` to `toIndex` at
 * `barsPerFrame`. Each frame lists the indices it EVALUATES (all of them) and the one
 * it RENDERS (the last). The flattened evaluated list is (fromIndex, toIndex] for ANY
 * barsPerFrame — that is the speed-independence guarantee.
 */
export function framesFor(fromIndex, toIndex, barsPerFrame) {
  const frames = []
  const step = barsPerFrame === Infinity ? Infinity : Math.max(1, Math.floor(barsPerFrame))
  let i = fromIndex
  while (i < toIndex) {
    const next = step === Infinity ? toIndex : Math.min(toIndex, i + step)
    const evaluated = []
    for (let j = i + 1; j <= next; j++) evaluated.push(j)
    frames.push({ evaluated, render: next })
    i = next
  }
  return frames
}

/** Every index evaluated when advancing (fromIndex, toIndex] — independent of speed. */
export function evaluatedIndices(fromIndex, toIndex) {
  const out = []
  for (let j = fromIndex + 1; j <= toIndex; j++) out.push(j)
  return out
}

/**
 * Stateful transport bound to a clock. Uses an INJECTED scheduler (requestAnimationFrame
 * / setTimeout in the app, a manual pump in tests) so playback is deterministic. The
 * per-frame logic evaluates every intervening bar and renders only the last.
 */
export class Transport {
  constructor(clock, { onEvaluate = () => {}, onRender = () => {}, scheduler } = {}) {
    this.clock = clock
    this.onEvaluate = onEvaluate
    this.onRender = onRender
    this.scheduler = scheduler || ((fn) => setTimeout(fn, 0))
    this.playing = false
    this.barsPerFrame = 1
  }

  setSpeed(speed) {
    this.barsPerFrame = speedToBarsPerFrame(speed)
    return this
  }

  /** Advance one render frame: evaluate EVERY bar passed, render once. False at the end. */
  frame() {
    const c = this.clock
    if (c.atEnd()) return false
    const step = this.barsPerFrame === Infinity ? Infinity : Math.max(1, Math.floor(this.barsPerFrame))
    const next = step === Infinity ? c.length - 1 : Math.min(c.length - 1, c.index + step)
    for (let j = c.index + 1; j <= next; j++) this.onEvaluate(j) // no bar skipped
    c.seek(next)
    this.onRender(next) // throttled render
    return !c.atEnd()
  }

  play(speed) {
    if (speed != null) this.setSpeed(speed)
    if (this.playing) return
    this.playing = true
    const loop = () => {
      if (!this.playing) return
      const more = this.frame()
      if (more && this.playing) this.scheduler(loop)
      else this.playing = false
    }
    this.scheduler(loop)
  }

  pause() {
    this.playing = false
  }

  stepForward() {
    return this.clock.step(1)
  }
  stepBack() {
    return this.clock.step(-1)
  }
}
