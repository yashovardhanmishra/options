// The replay simulator page. Owns nothing but UI state (which strike's ticket is open);
// all replay state + engine outputs come from useSim. Components render engine outputs and
// emit actions — no P&L/Greeks/fold logic here. Opened in its own tab via ?view=sim.
import { useEffect, useState } from 'react'
import OptionChain from '../../components/OptionChain'
import { authEnabled, getAccessToken, signOut } from '../../supabase'
import { useSim } from './useSim.js'
import TransportBar from './TransportBar.jsx'
import PositionsPanel from './PositionsPanel.jsx'
import RiskPanel from './RiskPanel.jsx'
import EquityCurve from './EquityCurve.jsx'
import TradeTicket from './TradeTicket.jsx'

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

        <div className="ml-auto flex items-center gap-2">
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
              <OptionChain chain={sim.chainSnap?.chain || []} onSelect={(strike, type) => setPick({ strike, type })} selected={null} />
            </div>
          </section>

          {/* RIGHT */}
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-row border-b border-edge">
              <div className="min-h-0 flex-1 border-r border-edge">
                <PositionsPanel
                  book={sim.book}
                  onExitLeg={sim.squareOffLeg}
                  onExitGroup={sim.squareOffGroup}
                  onExitAll={sim.squareOffAll}
                />
              </div>
              <div className="min-h-0 w-[300px] shrink-0">
                <RiskPanel book={sim.book} limits={sim.limits} warnings={sim.warnings} breaches={sim.breaches} setLimits={sim.setLimits} />
              </div>
            </div>
            <div className="h-[40%] min-h-[180px]">
              <EquityCurve curve={sim.curve} />
            </div>
          </section>
        </main>
      )}

      {pick && <TradeTicket pick={pick} chainSnap={sim.chainSnap} onPlace={sim.placeEntry} onClose={() => setPick(null)} />}
    </div>
  )
}
