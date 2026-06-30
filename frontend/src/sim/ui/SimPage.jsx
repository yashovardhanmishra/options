// The replay simulator page. Owns nothing but UI state (which strike's ticket is open);
// all replay state + engine outputs come from useSim. Components render engine outputs and
// emit actions — no P&L/Greeks/fold logic here. Opened in its own tab via ?view=sim.
import { useEffect, useMemo, useState } from 'react'
import OptionChain from '../../components/OptionChain'
import { authEnabled, getAccessToken, signOut } from '../../supabase'
import { useSim } from './useSim.js'
import { hhmm } from './fmt.js'
import TransportBar from './TransportBar.jsx'
import TimeBar from './TimeBar.jsx'
import PositionsPanel from './PositionsPanel.jsx'
import RiskPanel from './RiskPanel.jsx'
import EquityCurve from './EquityCurve.jsx'
import PayoffChart from './PayoffChart.jsx'
import StrategyStats from './StrategyStats.jsx'
import GreeksTable from './GreeksTable.jsx'
import SizingPanel from './SizingPanel.jsx'
import TradeTicket from './TradeTicket.jsx'
import StrategyPicker from './StrategyPicker.jsx'
import ThemeSwitcher from '../../components/ThemeSwitcher.jsx'
import { downloadCard } from './shareCard.js'
import { FAMOUS_DAYS, dailyChallengeDate } from '../replay/famousDays.js'

const TABS = ['Payoff', 'MTM', 'Greeks', 'Risk', 'Sizing']

const API_BASE =
  import.meta.env.VITE_API_BASE !== undefined ? import.meta.env.VITE_API_BASE : import.meta.env.PROD ? '' : 'http://localhost:8000'

const fmtDate = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]} ${y}`
}

export default function SimPage({ userEmail }) {
  const [token, setToken] = useState(null)
  useEffect(() => { if (authEnabled) getAccessToken().then(setToken) }, [])
  const ready = !authEnabled || !!token

  const sim = useSim({ base: API_BASE, token, ready })
  const [pick, setPick] = useState(null) // { strike, type } whose ticket is open
  const [showStrats, setShowStrats] = useState(false) // strategy-builder modal
  const [tab, setTab] = useState('Payoff')

  // Open-position overlay for the chain: net side per strike+type (buy>0/sell<0) + the set of
  // strikes held on BOTH CE and PE (straddle/strangle legs → highlighted differently).
  const positions = useMemo(() => {
    const net = {}
    const ce = new Set()
    const pe = new Set()
    for (const s of sim.book?.openLegs ?? []) {
      const { strike, type, side, lots } = s.leg
      const k = `${strike}${type}`
      net[k] = (net[k] ?? 0) + side * lots
      ;(type === 'CE' ? ce : pe).add(strike)
    }
    const both = new Set([...ce].filter((k) => pe.has(k)))
    return { net, both }
  }, [sim.book])

  // Data for the shareable PNG card (current position snapshot at the clock).
  const shareData = useMemo(
    () => ({
      pnl: sim.book?.total ?? 0,
      maxProfit: sim.payoff?.maxProfit,
      maxLoss: sim.payoff?.maxLoss,
      pop: sim.payoff?.pop,
      netCredit: sim.payoff?.netCredit,
      legs: (sim.book?.openLegs ?? []).map((s) => ({ side: s.leg.side, lots: s.leg.lots, strike: s.leg.strike, type: s.leg.type, entry: s.leg.entryPrice })),
      spot: sim.spot,
      expiry: sim.expiry,
      clock: hhmm(sim.t),
    }),
    [sim.book, sim.payoff, sim.spot, sim.expiry, sim.t],
  )

  const onReplayPick = (v) => {
    if (!v) return
    if (v === '__challenge') {
      const d = dailyChallengeDate(sim.allDates, new Date().toISOString().slice(0, 10))
      if (d) sim.jumpToDate(d)
    } else sim.jumpToDate(v)
  }

  // Replay keyboard shortcuts: Space = play/pause, ←/→ = step, Home/End = jump to ends,
  // B = open the strategy builder.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey) return
      if (e.code === 'Space') { e.preventDefault(); sim.setPlaying((p) => !p) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); sim.stepBy(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); sim.stepBy(-1) }
      else if (e.key === 'Home') { e.preventDefault(); sim.seek(0) }
      else if (e.key === 'End') { e.preventDefault(); sim.seek(sim.len - 1) }
      else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setShowStrats(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sim])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink text-slate-200">
      {/* header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-edge bg-panel px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="h-5 w-1.5 rounded-full bg-gradient-to-b from-violet-400 to-sky-400" />
          <h1 className="text-sm font-bold tracking-wide text-slate-100">
            REPLAY SIM <span className="text-slate-500">— paper-trade history</span>
          </h1>
        </div>
        <a href={window.location.pathname} className="text-xs text-sky-400 hover:underline">← Options app</a>

        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-xs uppercase tracking-wide text-slate-500">Expiry</span>
          <select
            value={sim.expiry}
            onChange={(e) => sim.setExpiry(e.target.value)}
            className="rounded border border-edge bg-panel px-2 py-1 text-slate-200 outline-none focus:border-sky-600"
          >
            {sim.expiries.map((e) => <option key={e} value={e}>{fmtDate(e)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-xs uppercase tracking-wide text-slate-500">From</span>
          <select
            value={sim.fromDate}
            onChange={(e) => sim.setFromDate(e.target.value)}
            title="Replay from this trading day through the expiry day"
            className="rounded border border-edge bg-panel px-2 py-1 font-mono text-xs text-slate-200 outline-none focus:border-sky-600"
          >
            {sim.allDates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-xs uppercase tracking-wide text-slate-500">Replay</span>
          <select
            value=""
            onChange={(e) => { onReplayPick(e.target.value); e.target.value = '' }}
            title="Jump to a famous market day, or take today's deterministic challenge"
            className="max-w-[12rem] rounded border border-edge bg-panel px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-600"
          >
            <option value="">Famous day…</option>
            <option value="__challenge">Daily challenge</option>
            {FAMOUS_DAYS.map((f) => <option key={f.date} value={f.date}>{f.label} · {f.date}</option>)}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-2">
          {sim.loaded && !sim.loading && (
            <button
              onClick={() => setShowStrats(true)}
              title="One-click strategy builder (B)"
              className="rounded border border-sky-700/60 bg-sky-600/15 px-2.5 py-1 text-xs font-semibold text-sky-300 hover:bg-sky-600/30"
            >
              ⊞ Strategies
            </button>
          )}
          {sim.loaded && !sim.loading && (
            <button
              onClick={() => downloadCard(shareData, hhmm(sim.t).replace(':', ''))}
              title="Download a shareable PNG of this position"
              className="rounded border border-edge bg-panel2 px-2.5 py-1 text-xs text-slate-300 hover:bg-edge hover:text-white"
            >
              Share
            </button>
          )}
          <ThemeSwitcher />
          {sim.userActions.length > 0 && (
            <button onClick={sim.resetTrades} className="rounded border border-edge bg-panel2 px-2.5 py-1 text-xs text-slate-300 hover:bg-edge">
              Reset trades
            </button>
          )}
          {authEnabled && userEmail && <span className="hidden max-w-[12rem] truncate text-xs text-slate-400 sm:inline" title={userEmail}>{userEmail}</span>}
          {authEnabled && (
            <button onClick={signOut} className="rounded border border-edge bg-panel2 px-2.5 py-1 text-xs text-slate-300 hover:bg-edge hover:text-white">Sign out</button>
          )}
        </div>
      </header>

      <TransportBar sim={sim} />
      {sim.loaded && !sim.loading && <TimeBar sim={sim} />}

      {sim.error && <div className="bg-red-600/15 px-4 py-1 text-xs text-red-300">Load error: {sim.error}</div>}

      {/* body: chain (left) | positions+risk over equity curve (right) */}
      {!sim.loaded || sim.loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
          {sim.loading ? 'Loading replay…' : ready ? 'Select an expiry to begin.' : 'Authenticating…'}
        </div>
      ) : (
        <main className="flex min-h-0 flex-1 flex-row">
          {/* LEFT — option chain at the clock */}
          <section className="flex min-h-0 w-[40%] min-w-[340px] flex-col border-r border-edge">
            <div className="border-b border-edge bg-panel2 px-3 py-1 text-[11px] text-slate-500">
              Click a CE / PE LTP to trade · {sim.chainSnap?.chain?.length ?? 0} strikes
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <OptionChain chain={sim.chainSnap?.chain || []} onSelect={(strike, type) => setPick({ strike, type })} selected={null} positions={positions} />
            </div>
          </section>

          {/* RIGHT — stats + tabbed analysis (payoff/MTM/greeks/risk) over the positions table */}
          <section className="flex min-h-0 flex-1 flex-col">
            <StrategyStats payoff={sim.payoff} book={sim.book} spot={sim.spot} />

            <div className="flex items-center gap-1 border-b border-edge bg-panel2 px-2 py-1">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded px-2.5 py-1 text-xs font-medium ${tab === t ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-edge hover:text-slate-200'}`}
                >
                  {t === 'MTM' ? 'MTM' : t}
                  {t === 'Risk' && sim.breaches.some((b) => b.reason === 'risk_breach') && <span className="ml-1 text-red-300">●</span>}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {tab === 'Payoff' && (
                <PayoffChart payoff={sim.payoff} spot={sim.spot} expiryLabel={fmtDate(sim.expiry)} clockLabel={hhmm(sim.t)} />
              )}
              {tab === 'MTM' && <EquityCurve curve={sim.curve} />}
              {tab === 'Greeks' && <GreeksTable book={sim.book} />}
              {tab === 'Risk' && (
                <RiskPanel book={sim.book} limits={sim.limits} warnings={sim.warnings} breaches={sim.breaches} setLimits={sim.setLimits} />
              )}
              {tab === 'Sizing' && <SizingPanel book={sim.book} payoff={sim.payoff} margin={sim.margin} />}
            </div>

            <div className="h-[36%] min-h-[150px] border-t border-edge">
              <PositionsPanel
                book={sim.book}
                multiplier={sim.multiplier}
                setMultiplier={sim.setMultiplier}
                onExitLeg={sim.squareOffLeg}
                onReduceLeg={sim.reduceLeg}
                onExitAll={sim.squareOffAll}
                onReset={sim.resetTrades}
              />
            </div>
          </section>
        </main>
      )}

      {pick && <TradeTicket pick={pick} chainSnap={sim.chainSnap} lotSize={sim.lotSizeNow} onPlace={sim.placeEntry} onClose={() => setPick(null)} />}
      {showStrats && <StrategyPicker sim={sim} onClose={() => setShowStrats(false)} />}
    </div>
  )
}
