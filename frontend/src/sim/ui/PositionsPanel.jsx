// StockMock-style positions table: B/S, Lots, Qty, entry Date, Strike, Expiry, Entry, LTP,
// P&L (₹ + %), and a per-leg square-off. Plus a Multiplier (analysis scalar) and totals.
// Reads straight from portfolioAt(t); square-off emits an exit action at the clock.
import { useState } from 'react'
import { money, signed, pnlCls, dateTimeShort, expiryShort } from './fmt.js'

export default function PositionsPanel({ book, multiplier = 1, setMultiplier, onReduceLeg, onExitAll, onReset }) {
  const [exitLots, setExitLots] = useState({}) // per-leg "lots to exit" (default = full)
  if (!book) return null
  const legs = book.openLegs
  const lotSize = legs[0]?.lotSize ?? '—'
  const setXL = (id, v) => setExitLots((m) => ({ ...m, [id]: v }))

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {legs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-600">
            No open positions — click a CE / PE LTP in the chain to trade.
          </div>
        ) : (
          <table className="w-full text-right font-mono text-[11px] tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                <th className="sticky top-0 bg-panel px-2 py-1 text-left">B/S</th>
                <th className="sticky top-0 bg-panel px-2 py-1">Lots</th>
                <th className="sticky top-0 bg-panel px-2 py-1">Qty</th>
                <th className="sticky top-0 bg-panel px-2 py-1 text-left">Date</th>
                <th className="sticky top-0 bg-panel px-2 py-1">Strike</th>
                <th className="sticky top-0 bg-panel px-2 py-1 text-left">Expiry</th>
                <th className="sticky top-0 bg-panel px-2 py-1">Entry</th>
                <th className="sticky top-0 bg-panel px-2 py-1">LTP</th>
                <th className="sticky top-0 bg-panel px-2 py-1">P&L</th>
                <th className="sticky top-0 bg-panel px-2 py-1">Lots Exit</th>
              </tr>
            </thead>
            <tbody>
              {legs.map((s) => {
                const L = s.leg
                const buy = L.side > 0
                const premium = Math.abs(L.entryPrice * s.lotSize * L.lots) || 1
                const pct = (s.mtm / premium) * 100
                const xl = Math.min(L.lots, exitLots[L.id] ?? L.lots)
                return (
                  <tr key={L.id} className="border-b border-edge/40 hover:bg-panel2/60">
                    <td className="px-2 py-1 text-left">
                      <span className={`rounded px-1 text-[10px] font-bold ${buy ? 'bg-emerald-600/25 text-emerald-300' : 'bg-red-600/25 text-red-300'}`}>{buy ? 'B' : 'S'}</span>
                    </td>
                    <td className="px-2 py-1 text-slate-300">{L.lots * multiplier}</td>
                    <td className="px-2 py-1 text-slate-400">{L.lots * s.lotSize * multiplier}</td>
                    <td className="px-2 py-1 text-left text-slate-400">{dateTimeShort(L.openedAt)}</td>
                    <td className="px-2 py-1">
                      <span className="text-slate-200">{L.strike}</span>
                      <span className={L.type === 'CE' ? 'text-sky-400' : 'text-orange-400'}>{L.type}</span>
                    </td>
                    <td className="px-2 py-1 text-left text-slate-400">{expiryShort(L.expiry)}</td>
                    <td className="px-2 py-1 text-slate-400">{L.entryPrice?.toFixed(2)}</td>
                    <td className="px-2 py-1 text-slate-200">{s.priceNow?.toFixed(2)}</td>
                    <td className={`px-2 py-1 font-semibold ${pnlCls(s.mtm)}`}>
                      {money(s.mtm * multiplier)} <span className="text-[9px] opacity-70">({signed(pct, 0)}%)</span>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center justify-end gap-0.5">
                        {/* Partial-exit lot selector: pick how many lots to square off. The −/+
                            are disabled at the bounds (a 1-lot leg shows both greyed; use ✕). */}
                        <button
                          onClick={() => setXL(L.id, Math.max(1, xl - 1))}
                          disabled={xl <= 1}
                          title="Fewer lots to exit"
                          className="flex h-4 w-4 items-center justify-center rounded border border-edge bg-panel2 text-[11px] leading-none text-slate-400 hover:bg-edge hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-panel2 disabled:hover:text-slate-400"
                        >
                          −
                        </button>
                        <span className="w-5 text-center text-[10px] text-slate-300">{xl}</span>
                        <button
                          onClick={() => setXL(L.id, Math.min(L.lots, xl + 1))}
                          disabled={xl >= L.lots}
                          title="More lots to exit"
                          className="flex h-4 w-4 items-center justify-center rounded border border-edge bg-panel2 text-[11px] leading-none text-slate-400 hover:bg-edge hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-panel2 disabled:hover:text-slate-400"
                        >
                          +
                        </button>
                        <button
                          onClick={() => onReduceLeg(L.id, xl)}
                          title={xl >= L.lots ? 'Square off this leg' : `Exit ${xl} of ${L.lots} lots`}
                          className="ml-1 rounded px-1.5 text-[11px] text-slate-400 hover:bg-red-600/30 hover:text-red-200"
                        >
                          {xl >= L.lots ? '✕' : '⤓'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* footer: multiplier + lot size + totals + actions */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge bg-panel2 px-3 py-1.5 text-[11px]">
        <div className="flex items-center gap-1">
          <span className="text-slate-500">Multiplier</span>
          <button onClick={() => setMultiplier((m) => Math.max(1, m - 1))} className="h-5 w-5 rounded border border-edge bg-panel text-slate-300 hover:bg-edge">−</button>
          <span className="w-6 text-center font-mono text-slate-200">{multiplier}</span>
          <button onClick={() => setMultiplier((m) => m + 1)} className="h-5 w-5 rounded border border-edge bg-panel text-slate-300 hover:bg-edge">+</button>
        </div>
        <span className="text-slate-500">Lot size <span className="font-mono text-slate-300">{lotSize}</span></span>
        <span className="font-mono text-slate-400">Realized <span className={pnlCls(book.realized)}>{money(book.realized * multiplier)}</span></span>
        <span className="font-mono text-slate-400">Unrealized <span className={pnlCls(book.unrealized)}>{money(book.unrealized * multiplier)}</span></span>
        <div className="ml-auto flex items-center gap-2">
          {legs.length > 0 && (
            <button onClick={onExitAll} className="rounded border border-red-700/60 bg-red-600/15 px-2 py-0.5 font-medium text-red-300 hover:bg-red-600/30">Exit all</button>
          )}
          <button onClick={onReset} className="rounded border border-edge bg-panel px-2 py-0.5 text-slate-400 hover:bg-edge">Clear</button>
        </div>
      </div>
    </div>
  )
}
