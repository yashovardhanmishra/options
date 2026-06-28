// Risk: set |Δ|/|Γ|/|Vega|/|Θ-day| limits (portfolio scope), see the live value vs limit
// with the >=80% near-limit warning state, and the breach log. Setting a limit re-runs the
// engine (auto-liquidation lives in runSession); this panel only sets limits + displays.
import { hhmm } from './fmt.js'

const METRICS = [
  { key: 'delta', label: 'Δ Delta', d: 0 },
  { key: 'gamma', label: 'Γ Gamma', d: 2 },
  { key: 'vega', label: 'Vega', d: 0 },
  { key: 'theta', label: 'Θ / day', d: 0 },
]

export default function RiskPanel({ book, limits, warnings, breaches, setLimits }) {
  const g = book?.greeks || { delta: 0, gamma: 0, vega: 0, theta: 0 }
  const warnedMetrics = new Set(warnings.map((w) => w.metric))
  const riskBreaches = breaches.filter((b) => b.reason === 'risk_breach')

  const setLimit = (metric, raw) => {
    const v = raw === '' ? null : Math.abs(Number(raw))
    setLimits((l) => ({ ...l, portfolio: { ...l.portfolio, [metric]: Number.isFinite(v) ? v : null } }))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-edge bg-panel2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Risk limits <span className="font-normal normal-case text-slate-600">— auto square-off on breach</span>
      </div>

      <div className="space-y-1.5 px-3 py-2">
        {METRICS.map(({ key, label, d }) => {
          const lim = limits.portfolio?.[key]
          const val = g[key] || 0
          const abs = Math.abs(val)
          const pct = lim ? abs / lim : 0
          const warned = warnedMetrics.has(key)
          const breached = lim != null && abs > lim
          return (
            <div key={key} className="flex items-center gap-2 text-[11px]">
              <span className="w-16 shrink-0 text-slate-400">{label}</span>
              <span className={`w-14 shrink-0 text-right font-mono tabular-nums ${breached ? 'text-red-400' : warned ? 'text-amber-400' : 'text-slate-200'}`}>
                {d ? val.toFixed(d) : Math.round(val)}
              </span>
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-edge">
                {lim != null && (
                  <div
                    className={`absolute left-0 top-0 h-full rounded-full ${breached ? 'bg-red-500' : warned ? 'bg-amber-400' : 'bg-sky-500'}`}
                    style={{ width: `${Math.min(100, pct * 100)}%` }}
                  />
                )}
              </div>
              <span className="text-slate-600">≤</span>
              <input
                type="number"
                min={0}
                placeholder="off"
                value={lim ?? ''}
                onChange={(e) => setLimit(key, e.target.value)}
                className="w-16 rounded border border-edge bg-panel2 px-1.5 py-0.5 text-right font-mono text-[11px] text-slate-100 outline-none focus:border-sky-600"
              />
            </div>
          )
        })}
      </div>

      {warnings.length > 0 && riskBreaches.length === 0 && (
        <div className="mx-3 mb-2 rounded border border-amber-700/50 bg-amber-600/10 px-2 py-1 text-[10px] text-amber-300">
          ⚠ Near limit ({warnings.map((w) => `${w.metric} ${(w.pct * 100).toFixed(0)}%`).join(', ')})
        </div>
      )}

      <div className="border-t border-edge px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-500">
        Breach log {riskBreaches.length > 0 && <span className="text-red-400">({riskBreaches.length})</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-2">
        {riskBreaches.length === 0 ? (
          <div className="py-2 text-[11px] text-slate-600">No auto-liquidations yet.</div>
        ) : (
          <ul className="space-y-1">
            {riskBreaches.map((b, i) => (
              <li key={i} className="rounded border border-red-800/40 bg-red-600/10 px-2 py-1 font-mono text-[10px] text-red-200">
                <span className="text-red-400">{hhmm(b.t)}</span> auto square-off — {b.meta?.scope} {b.meta?.metric}
                {' '}|{b.meta?.value != null ? Math.round(Math.abs(b.meta.value)) : '?'}| &gt; {b.meta?.limit}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
