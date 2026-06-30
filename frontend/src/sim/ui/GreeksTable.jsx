// Per-leg + portfolio Greeks (position-scaled), straight from portfolioAt(t).
import { signed, num } from './fmt.js'
import Info from './Info.jsx'

// Greek column header with an explainer ⓘ (right-aligned to match the numeric columns).
const Hd = ({ children, k }) => (
  <span className="inline-flex items-center justify-end gap-1">
    {children}
    <Info k={k} side="bottom" />
  </span>
)

export default function GreeksTable({ book }) {
  if (!book) return null
  const legs = book.openLegs
  const g = book.greeks
  if (!legs.length) return <div className="flex h-full items-center justify-center text-xs text-slate-600">No open positions.</div>

  // The portfolio greeks above are position-scaled (₹: per-option × lotSize × lots × side).
  // The "points" view is lot-normalized — divide each leg's ₹ greek by its own lot size and
  // sum — i.e. premium points (theta in pts/day, etc.), the form traders usually quote.
  const pts = legs.reduce(
    (a, s) => {
      const L = s.lotSize || 1
      a.delta += s.greeks.delta / L
      a.gamma += s.greeks.gamma / L
      a.vega += s.greeks.vega / L
      a.theta += s.greeks.theta / L
      return a
    },
    { delta: 0, gamma: 0, vega: 0, theta: 0 },
  )

  const Num = ({ v, d = 0 }) => <td className="px-2 py-1 font-mono tabular-nums text-slate-300">{signed(v, d)}</td>

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-right text-[11px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-slate-500">
            <th className="sticky top-0 bg-panel px-2 py-1 text-left">Leg</th>
            <th className="sticky top-0 bg-panel px-2 py-1"><Hd k="delta">Delta</Hd></th>
            <th className="sticky top-0 bg-panel px-2 py-1"><Hd k="gamma">Gamma</Hd></th>
            <th className="sticky top-0 bg-panel px-2 py-1"><Hd k="vega">Vega</Hd></th>
            <th className="sticky top-0 bg-panel px-2 py-1"><Hd k="theta">Theta/d</Hd></th>
            <th className="sticky top-0 bg-panel px-2 py-1"><Hd k="iv">IV</Hd></th>
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
            <td className="px-2 py-1 text-left">
              <span className="inline-flex items-center gap-1">Total <span className="font-normal text-slate-500">₹</span><Info k="totalRupee" side="top" /></span>
            </td>
            <td className="px-2 py-1 font-mono tabular-nums">{signed(g.delta)}</td>
            <td className="px-2 py-1 font-mono tabular-nums">{signed(g.gamma, 2)}</td>
            <td className="px-2 py-1 font-mono tabular-nums">{signed(g.vega)}</td>
            <td className="px-2 py-1 font-mono tabular-nums">{signed(g.theta)}</td>
            <td className="px-2 py-1"></td>
          </tr>
          <tr className="bg-panel2 text-slate-400">
            <td className="px-2 pb-1 text-left text-[10px] uppercase tracking-wide">
              <span className="inline-flex items-center gap-1">Total <span className="text-slate-500">pts</span><Info k="pts" side="top" /></span>
            </td>
            <td className="px-2 pb-1 font-mono tabular-nums">{signed(pts.delta, 2)}</td>
            <td className="px-2 pb-1 font-mono tabular-nums">{signed(pts.gamma, 4)}</td>
            <td className="px-2 pb-1 font-mono tabular-nums">{signed(pts.vega, 2)}</td>
            <td className="px-2 pb-1 font-mono tabular-nums">{signed(pts.theta, 2)}</td>
            <td className="px-2 pb-1"></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
