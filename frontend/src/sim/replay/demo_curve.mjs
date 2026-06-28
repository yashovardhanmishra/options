// Manual demo (NOT a test): runs the WHOLE assembled sim on the real expiry day — an ITM
// and an OTM call held to expiry — and shows the equity curve, the expiry settlement at
// intrinsic, and curve determinism at 1x vs max.
//   SIM_BASE=http://localhost:8000 node src/sim/replay/demo_curve.mjs
import { loadSpot, loadExpiries } from '../data/client.js'
import { loadReplay } from '../data/session.js'
import { snapshotAt, makeContext } from '../data/snapshot.js'
import { intrinsic } from '../engine/bs.js'
import { entry } from '../portfolio/actions.js'
import { runSession } from './runner.js'

const BASE = process.env.SIM_BASE || 'http://localhost:8000'
const EXP = '2026-03-30'
const hhmm = (u) => { const s = ((u % 86400) + 86400) % 86400; return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}` }

const [spotBars, expiries] = await Promise.all([loadSpot(BASE), loadExpiries(BASE)])
const { session, timeline } = await loadReplay({ base: BASE, expiry: EXP, dates: [EXP], spotBars, expiries })
const snapAt = (t) => snapshotAt(session, t)
const ctxAt = (t) => makeContext(session, snapAt(t))

const t0 = timeline.times[0]
const S0 = snapAt(t0).S
const itmK = Math.round((S0 - 500) / 50) * 50 // deep ITM call
const otmK = Math.round((S0 + 500) / 50) * 50 // far OTM call
const px = (K) => snapAt(t0).chain.find((r) => r.strike === K)?.ce?.ltp
const log0 = [
  entry({ t: t0, legId: 'ITM', expiry: EXP, strike: itmK, type: 'CE', side: 1, lots: 1, price: px(itmK) }),
  entry({ t: t0, legId: 'OTM', expiry: EXP, strike: otmK, type: 'CE', side: 1, lots: 1, price: px(otmK) }),
]
console.log(`backend ${BASE}\nexpiry day ${EXP}  bars ${timeline.times.length}  open ${hhmm(t0)}–${hhmm(timeline.times.at(-1))}`)
console.log(`entry spot ${S0}  long ${itmK}CE @${px(itmK)} (ITM)  long ${otmK}CE @${px(otmK)} (OTM)`)

const r = runSession({ timeline, snapshotAt: snapAt, ctxAt, expiry: EXP, initialLog: log0, speed: 'max' })
const last = r.curve.at(-1)
const expBar = timeline.times.at(-1)
const Sexp = snapAt(expBar).S
const settle = r.log.find((a) => a.reason === 'expiry')

console.log('\n── equity curve (sampled) ──')
for (const i of [0, Math.floor(r.curve.length / 2), r.curve.length - 1]) {
  const p = r.curve[i]
  console.log(`  ${hhmm(p.t)}  realized ${p.realized.toFixed(0).padStart(8)}  unrealized ${p.unrealized.toFixed(0).padStart(8)}  equity ${p.equity.toFixed(0).padStart(8)}`)
}
console.log('\n── expiry settlement ──')
console.log(`  spot @ ${hhmm(expBar)} = ${Sexp}`)
console.log(`  reason:'${settle?.reason}'  @ ${hhmm(settle?.t)}  prices ${JSON.stringify(settle?.prices)}`)
console.log(`  intrinsic check: ${itmK}CE -> ${intrinsic(Sexp, itmK, 'CE')} (ITM)   ${otmK}CE -> ${intrinsic(Sexp, otmK, 'CE')} (OTM=0)`)
console.log(`  final: open legs ${r.curve.at(-1).unrealized === 0 ? 0 : '?'}  realized ${last.realized.toFixed(0)}`)

// determinism: 1x vs max produce the identical curve
const r1 = runSession({ timeline, snapshotAt: snapAt, ctxAt, expiry: EXP, initialLog: log0, speed: '1x' })
const same = r1.curve.length === r.curve.length && r1.curve.every((p, i) => p.equity === r.curve[i].equity)
console.log(`\n── determinism ──\n  1x vs max curve identical: ${same}  (${r.curve.length} points)`)

const ok = !!settle && settle.reason === 'expiry' && settle.prices.OTM === 0 && settle.prices.ITM === intrinsic(Sexp, itmK, 'CE') && last.unrealized === 0 && same
console.log(`\n${ok ? 'PASS — assembled sim: curve + intrinsic settlement + determinism' : 'check details above'}`)
