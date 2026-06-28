// Per-leg + portfolio Greeks (position-scaled), straight from portfolioAt(t).
import { signed, num } from './fmt.js'

export default function GreeksTable({ book }) {
  if (!book) return null
  const legs = book.openLegs
  const g = book.greeks
  if (!legs.length) return <div className="flex h-full items-center justify-center text-xs text-slate-600">No open positions.</div>

  const Num = ({ v, d = 0 }) => <td className="px-2 py-1 font-mono tabular-nums text-slate-300">{signed(v, d)}</td>

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-right text-[11px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-slate-500">
            <th className="sticky top-0 bg-panel px-2 py-1 text-left">Leg</th>
            <th className="sticky top-0 bg-panel px-2 py-1">Delta</th>
            <th className="sticky top-0 bg-panel px-2 py-1">Gamma</th>
            <th className="sticky top-0 bg-panel px-2 py-1">Vega</th>
            <th className="sticky top-0 bg-panel px-2 py-1">Theta/d</th>
            <th className="sticky top-0 bg-panel px-2 py-1">IV</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((s) => (
            <tr key={s.leg.id} className="border-b border-edge/40">
              <td className="px-2 py-1 text-left">
                <span className={`mr-1 font-bold ${s.leg.side > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{s.leg.side > 0 ? 'B' : 'S'}</span>
                <span className="text-slate-200">{s.leg.strike}</span>
                <span className={s.leg.type === 'CE' ? 'text-sky-400' : 'text-orange-400'}>{s.leg.type}</span>
              </td>
              <Num v={s.greeks.delta} />
              <Num v={s.greeks.gamma} d={2} />
              <Num v={s.greeks.vega} />
              <Num v={s.greeks.theta} />
              <td className="px-2 py-1 font-mono tabular-nums text-slate-400">{s.degenerate ? '—' : `${(s.iv * 100).toFixed(1)}%`}</td>
            </tr>
          ))}
          <tr className="border-t border-edge bg-panel2 font-semibold text-slate-200">
            <td className="px-2 py-1 text-left">Total</td>
            <td className="px-2 py-1 font-mono tabular-nums">{signed(g.delta)}</td>
            <td className="px-2 py-1 font-mono tabular-nums">{signed(g.gamma, 2)}</td>
            <td className="px-2 py-1 font-mono tabular-nums">{signed(g.vega)}</td>
            <td className="px-2 py-1 font-mono tabular-nums">{signed(g.theta)}</td>
            <td className="px-2 py-1"></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
