// Manual demo (NOT a test): loads a real multi-day session for one expiry and shows
//   1) a step-forward across a session boundary,
//   2) a scrub that lands exactly on a boundary,
//   3) proof that playback speed doesn't change which bars are evaluated.
//   SIM_BASE=http://localhost:8000 node src/sim/replay/demo.mjs
import { loadDates } from '../data/client.js'
import { loadReplay } from '../data/session.js'
import { ReplayClock } from './clock.js'
import { Transport } from './transport.js'
import { sessionOf } from './timeline.js'

const BASE = process.env.SIM_BASE || 'http://localhost:8000'
// HH:MM derived from the opaque integer key (no Date / no timezone round-trip).
const hhmm = (u) => {
  const s = ((u % 86400) + 86400) % 86400
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
}
const stamp = (tl, i) => `${sessionOf(tl, i).date} ${hhmm(tl.times[i])}`

const EXP = '2026-03-30'
const dates = await loadDates(BASE, EXP)
// two consecutive trading days (avoid the expiry-day half session)
const pick = dates.slice(-3, -1)
console.log(`backend ${BASE}\nexpiry ${EXP}  days ${pick.join(' , ')}`)

const { timeline: tl } = await loadReplay({ base: BASE, expiry: EXP, dates: pick })
console.log(`timeline: ${tl.times.length} bars across ${tl.sessions.length} sessions`)
for (const s of tl.sessions) console.log(`  ${s.date}: idx ${s.startIndex}..${s.endIndex}  ${hhmm(s.startUnix)}–${hhmm(s.endUnix)}`)

// ── 1) step across the boundary ──────────────────────────────────────────────
const boundary = tl.sessions[0].endIndex // last bar of day N
const c = new ReplayClock(tl, boundary)
console.log('\n① STEP ACROSS SESSION BOUNDARY')
console.log(`  at idx ${c.index}  ${stamp(tl, c.index)}   atSessionEnd=${c.atSessionEnd()}`)
c.step(1)
console.log(`  step(1) -> idx ${c.index}  ${stamp(tl, c.index)}   atSessionStart=${c.atSessionStart()}`)
console.log(`  PASS index advanced by exactly 1: ${c.index === boundary + 1}`)
console.log(`  PASS crossed day ${tl.sessions[0].date} -> ${tl.sessions[1].date} with no intermediate bar`)

// ── 2) scrub exactly onto the boundary ───────────────────────────────────────
console.log('\n② SCRUB LANDS EXACTLY ON A BOUNDARY')
const c2 = new ReplayClock(tl, 0)
c2.seek(tl.sessions[1].startIndex) // scrubber dragged to the session-start index
console.log(`  seek(${tl.sessions[1].startIndex}) -> ${stamp(tl, c2.index)}   atSessionStart=${c2.atSessionStart()}`)
const c3 = new ReplayClock(tl, 0)
c3.seekToUnix(tl.sessions[1].startUnix) // scrub-to-time onto the open
console.log(`  seekToUnix(open) -> idx ${c3.index}  ${stamp(tl, c3.index)}   PASS=${c3.index === tl.sessions[1].startIndex}`)

// ── 3) speed does not change which bars are evaluated ────────────────────────
console.log('\n③ SPEED-INVARIANT EVALUATION (1x vs max)')
const runEval = (speed) => {
  const clock = new ReplayClock(tl, 0)
  const seen = []
  const t = new Transport(clock, { onEvaluate: (i) => seen.push(tl.times[i]) }).setSpeed(speed)
  let frames = 0
  while (!clock.atEnd()) { t.frame(); frames++ }
  return { seen, frames }
}
const a = runEval('1x')
const b = runEval('max')
const same = a.seen.length === b.seen.length && a.seen.every((v, i) => v === b.seen[i])
console.log(`  1x : ${a.frames} frames, ${a.seen.length} bars evaluated`)
console.log(`  max: ${b.frames} frame${b.frames === 1 ? '' : 's'}, ${b.seen.length} bars evaluated`)
console.log(`  PASS identical evaluated timestamp set/order: ${same}`)
console.log(`  PASS every non-start bar evaluated: ${a.seen.length === tl.times.length - 1}`)

const ok = c.index === boundary + 1 && c.atSessionStart() && c2.atSessionStart() &&
  c3.index === tl.sessions[1].startIndex && same && a.seen.length === tl.times.length - 1
console.log(`\n${ok ? 'ALL CHECKS PASS' : 'CHECK FAILED'}`)
if (!ok) process.exit(1)
