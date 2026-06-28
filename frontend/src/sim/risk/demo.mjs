// Manual demo (NOT a test): exercises the REAL bookAt (makeBookAt -> portfolioAt with
// real snapshots/Greeks). Enters a long ATM call, sets a portfolio |Δ| limit below the
// position's real delta, and shows the breach firing once + squaring off + idempotency.
//   SIM_BASE=http://localhost:8000 node src/sim/risk/demo.mjs
import { loadDates, loadSpot, loadExpiries } from '../data/client.js'
import { loadReplay } from '../data/session.js'
import { snapshotAt, makeContext } from '../data/snapshot.js'
import { sessionUnix } from '../engine/time.js'
import { entry } from '../portfolio/actions.js'
import { evaluateRisk, makeBookAt } from './engine.js'

const BASE = process.env.SIM_BASE || 'http://localhost:8000'
const EXP = '2026-03-30'
const dates = await loadDates(BASE, EXP)
const date = dates[Math.max(0, dates.length - 6)]
const [spotBars, expiries] = await Promise.all([loadSpot(BASE), loadExpiries(BASE)])
const { session } = await loadReplay({ base: BASE, expiry: EXP, dates: [date], spotBars, expiries })

const t = sessionUnix(date, 12, 0)
const snap = snapshotAt(session, t)
const priced = snap.chain.filter((r) => r.ce && r.pe)
const atm = priced.reduce((a, r) => (Math.abs(r.strike - snap.S) < Math.abs(a.strike - snap.S) ? r : a), priced[0])

const log = [entry({ t, legId: 'L1', expiry: EXP, strike: atm.strike, type: 'CE', side: 1, lots: 1, price: atm.ce.ltp })]
const bookAt = makeBookAt({ snapshotAt: (tt) => snapshotAt(session, tt), ctxAt: (tt) => makeContext(session, snapshotAt(session, tt)) })

const book = bookAt(log, t)
const posΔ = book.greeks.delta
console.log(`backend ${BASE}\nexpiry ${EXP}  date ${date}  noon`)
console.log(`spot ${snap.S}  ATM ${atm.strike} CE ${atm.ce.ltp}`)
console.log(`real position Δ ${posΔ.toFixed(2)}  Γ ${book.greeks.gamma.toFixed(4)}  Vega ${book.greeks.vega.toFixed(1)}  Θ/day ${book.greeks.theta.toFixed(1)}`)

const limit = Math.max(1, Math.floor(Math.abs(posΔ) * 0.5))
const { actions, breaches } = evaluateRisk({ actions: log, t, limits: { portfolio: { delta: limit } }, bookAt })
console.log(`\nportfolio |Δ| limit = ${limit} (below ${posΔ.toFixed(2)}) -> breach`)
console.log(`  breach: ${JSON.stringify(breaches[0])}`)
console.log(`  appended: type=${actions[0]?.type} scope=${actions[0]?.scope?.kind} reason=${actions[0]?.reason}`)

const after = bookAt([...log, ...actions], t)
console.log(`  after square-off: open legs ${after.openLegs.length}, Δ ${after.greeks.delta}`)
const reEval = evaluateRisk({ actions: [...log, ...actions], t, limits: { portfolio: { delta: limit } }, bookAt })
console.log(`  re-evaluate same bar (exit already in log) -> new actions ${reEval.actions.length}  (idempotent)`)

const ok = actions.length === 1 && actions[0].reason === 'risk_breach' && after.openLegs.length === 0 && reEval.actions.length === 0
console.log(`\n${ok ? 'PASS — real breach fired once, squared off, idempotent' : 'FAIL'}`)
if (!ok) process.exit(1)
