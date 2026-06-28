// Manual demo (NOT a unit test): pulls REAL bars from a running backend, builds one
// snapshotAt(t), and derives Greeks for the ATM strike so T / IV can be eyeballed.
//   SIM_BASE=http://localhost:8000 node src/sim/data/demo.mjs
import { loadExpiries, loadDates, loadDay, loadSpot } from './client.js'
import { buildSession, snapshotAt, makeContext } from './snapshot.js'
import { sessionUnix, yearsToExpiry } from '../engine/time.js'
import { legState } from '../engine/portfolio.js'

const BASE = process.env.SIM_BASE || 'http://localhost:8000'
const fmtT = (u) => { const x = new Date(u * 1000); return `${x.getUTCHours()}`.padStart(2, '0') + ':' + `${x.getUTCMinutes()}`.padStart(2, '0') }

const expiries = await loadExpiries(BASE)
// prefer a fully-populated 2026 expiry; else the newest
const expiry = expiries.includes('2026-03-30') ? '2026-03-30' : expiries[0]
const dates = await loadDates(BASE, expiry)

// pick the trading date whose noon is closest to ~7 calendar DTE
let date = dates[dates.length - 1]
let bestDiff = Infinity
for (const d of dates) {
  const dte = yearsToExpiry(sessionUnix(d, 12, 0), expiry) * 365.25
  if (dte > 0.5 && Math.abs(dte - 7) < bestDiff) { bestDiff = Math.abs(dte - 7); date = d }
}

console.log(`backend ${BASE}\nexpiry ${expiry}  date ${date}`)
const [day, spotBars] = await Promise.all([loadDay(BASE, expiry, date), loadSpot(BASE)])
console.log(`loaded ${day.instruments.length} instruments, ${spotBars.length} spot bars`)

const session = buildSession({ expiry, expiries, spotBars, instruments: day.instruments })
const t = sessionUnix(date, 12, 0) // noon IST
const snap = snapshotAt(session, t)

// ATM = strike closest to spot that has both CE and PE priced at t
const priced = snap.chain.filter((r) => r.ce && r.pe)
const atm = priced.reduce((a, r) => (Math.abs(r.strike - snap.S) < Math.abs(a.strike - snap.S) ? r : a), priced[0])

const leg = { underlying: 'NIFTY', expiry, strike: atm.strike, type: 'CE', side: 1, lots: 1, entryPrice: atm.ce.ltp }
const ctx = makeContext(session, snap)
const ls = legState(leg, snap.priceFor(leg), ctx)

const T = yearsToExpiry(t, expiry)
const dte = T * 365.25
console.log('\n── snapshotAt(t) ──')
console.log(`clock        ${date} ${fmtT(t)} IST   (unix ${t})`)
console.log(`spot S       ${snap.S}`)
console.log(`ATM strike   ${atm.strike}   CE ltp ${atm.ce.ltp}  (bar @ ${fmtT(atm.ce.u)})  PE ltp ${atm.pe.ltp}`)
console.log(`lot size     ${ls.lotSize}  (monthly=${session.monthly.has(expiry)})`)
console.log('\n── derived risk (ATM CE, 1 lot long) ──')
console.log(`T            ${T.toFixed(6)} yr   (~${dte.toFixed(2)} DTE)`)
console.log(`IV           ${(ls.iv * 100).toFixed(2)}%   degenerate=${ls.degenerate}`)
console.log(`Δ ${ls.greeks.delta.toFixed(2)}   Γ ${ls.greeks.gamma.toFixed(4)}   Vega ${ls.greeks.vega.toFixed(2)}   Θ/day ${ls.greeks.theta.toFixed(2)}`)
console.log(`per-option:  Δ ${ls.perOption.delta.toFixed(4)}  Γ ${ls.perOption.gamma.toFixed(6)}  Vega ${ls.perOption.vega.toFixed(4)}  Θ ${ls.perOption.theta.toFixed(4)}`)

// sanity gates
const ok = []
ok.push(['T ≈ DTE/365.25', Math.abs(T - dte / 365.25) < 1e-9])
ok.push(['DTE in a sane 1–20 range', dte > 1 && dte < 20])
ok.push(['IV in a sane 3%–80% range', ls.iv > 0.03 && ls.iv < 0.8])
ok.push(['ATM CE delta in (0.3,0.7)', ls.perOption.delta > 0.3 && ls.perOption.delta < 0.7])
console.log('\n── sanity ──')
for (const [name, pass] of ok) console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`)
if (ok.some(([, p]) => !p)) process.exit(1)
