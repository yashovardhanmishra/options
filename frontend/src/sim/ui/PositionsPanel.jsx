// Positions: open legs with per-leg MTM + Greeks, portfolio totals, and square-off
// controls. Reads straight from portfolioAt(t) — computes nothing. Each square-off button
// emits an exit action at the current clock (filled at the stored LTP).
import { money, num, signed, pnlCls } from './fmt.js'

const Greek = ({ v, d = 0 }) => <span className="font-mono tabular-nums text-slate-300">{signed(v, d)}</span>

export default function PositionsPanel({ book, onExitLeg, onExitGroup, onExitAll }) {
  if (!book) return null
  const legs = book.openLegs
  const g = book.greeks

  return (
    <div className="flex h-full flex-col">
      {/* totals */}
      <div className="grid grid-cols-3 gap-px border-b border-edge bg-edge text-center">
        <Stat label="Realized" value={money(book.realized)} cls={pnlCls(book.realized)} />
        <Stat label="Unrealized" value={money(book.unrealized)} cls={pnlCls(book.unrealized)} />
        <Stat label="Total P&L" value={money(book.total)} cls={pnlCls(book.total)} big />
      </div>
      <div className="flex items-center justify-between border-b border-edge bg-panel2 px-3 py-1.5 text-[11px]">
        <div className="flex gap-3 font-mono tabular-nums text-slate-400">
          <span>Δ <span className="text-slate-200">{signed(g.delta)}</span></span>
          <span>Γ <span className="text-slate-200">{signed(g.gamma, 2)}</span></span>
          <span>Vega <span className="text-slate-200">{signed(g.vega)}</span></span>
          <span>Θ/d <span className="text-slate-200">{signed(g.theta)}</span></span>
        </div>
        {legs.length > 0 && (
          <button
            onClick={onExitAll}
            className="rounded border border-red-700/60 bg-red-600/15 px-2 py-0.5 text-[11px] font-medium text-red-300 hover:bg-red-600/30"
          >
            Square off all
          </button>
        )}
      </div>

      {/* open legs */}
      <div className="min-h-0 flex-1 overflow-auto">
        {legs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-600">
            No open positions — click a CE/PE LTP in the chain to trade.
          </div>
        ) : (
          <table className="w-full text-right font-mono text-[11px] tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                <th className="sticky top-0 bg-panel px-2 py-1 text-left">Leg</th>
                <th className="sticky top-0 bg-panel px-2 py-1">Lots</th>
                <th className="sticky top-0 bg-panel px-2 py-1">Entry</th>
                <th className="sticky top-0 bg-panel px-2 py-1">LTP</th>
                <th className="sticky top-0 bg-panel px-2 py-1">MTM</th>
                <th className="sticky top-0 bg-panel px-2 py-1">Δ</th>
                <th className="sticky top-0 bg-panel px-2 py-1">Θ/d</th>
                <th className="sticky top-0 bg-panel px-2 py-1">IV</th>
                <th className="sticky top-0 bg-panel px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {legs.map((s) => {
                const L = s.leg
                const buy = L.side > 0
                return (
                  <tr key={L.id} className="border-b border-edge/40 hover:bg-panel2/60">
                    <td className="px-2 py-1 text-left">
                      <span className={`mr-1 inline-block w-3 font-bold ${buy ? 'text-emerald-400' : 'text-red-400'}`}>{buy ? 'B' : 'S'}</span>
                      <span className="text-slate-200">{L.strike}</span>
                      <span className={L.type === 'CE' ? 'text-sky-400' : 'text-orange-400'}>{L.type}</span>
                    </td>
                    <td className="px-2 py-1 text-slate-300">{L.lots}</td>
                    <td className="px-2 py-1 text-slate-400">{s.leg.entryPrice?.toFixed(2)}</td>
                    <td className="px-2 py-1 text-slate-200">{s.priceNow?.toFixed(2)}</td>
                    <td className={`px-2 py-1 font-semibold ${pnlCls(s.mtm)}`}>{money(s.mtm)}</td>
                    <td className="px-2 py-1"><Greek v={s.greeks.delta} /></td>
                    <td className="px-2 py-1"><Greek v={s.greeks.theta} /></td>
                    <td className="px-2 py-1 text-slate-400">{s.degenerate ? '—' : (s.iv * 100).toFixed(1)}</td>
                    <td className="px-2 py-1">
                      <button
                        onClick={() => onExitLeg(L.id)}
                        title="Square off this leg"
                        className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-red-600/30 hover:text-red-200"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, cls, big }) {
  return (
    <div className="bg-panel px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono tabular-nums ${big ? 'text-sm font-bold' : 'text-xs'} ${cls}`}>{value}</div>
    </div>
  )
}
