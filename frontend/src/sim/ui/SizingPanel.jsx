// Sizing tab: estimated NSE F&O margin for the open book (SPAN + exposure approximation),
// margin utilisation vs account capital, and a position-sizing calc (capital + risk% → how
// many copies of the position you can hold). All math is pure (engine/margin.js); the
// capital / risk% / stop inputs are local UI prefs — they don't touch the deterministic fold.
import { useState } from 'react'
import { money } from './fmt.js'
import { suggestLots } from '../engine/margin.js'
import Info from './Info.jsx'

const inputCls =
  'w-28 rounded border border-edge bg-panel2 px-1.5 py-0.5 text-right font-mono text-[11px] text-slate-100 outline-none focus:border-sky-600'

const Row = ({ label, k, children, strong }) => (
  <div className="flex items-center gap-2 text-[11px]">
    <span className={`flex shrink-0 items-center gap-1 ${strong ? 'font-semibold text-slate-200' : 'text-slate-400'}`}>
      {label}
      {k && <Info k={k} side="right" />}
    </span>
    <span className={`ml-auto font-mono tabular-nums ${strong ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>{children}</span>
  </div>
)

const Header = ({ children, right }) => (
  <div className="flex items-center justify-between border-b border-t border-edge bg-panel2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
    <span className="flex items-center gap-1">{children}</span>
    {right && <span className="font-normal normal-case text-slate-600">{right}</span>}
  </div>
)

export default function SizingPanel({ book, payoff, margin }) {
  const [capital, setCapital] = useState(500000)
  const [riskPct, setRiskPct] = useState(2)
  const [stop, setStop] = useState('') // ₹ stop for naked positions (no defined max-loss)

  const hasBook = !!book?.openLegs?.length
  if (!hasBook) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-slate-600">
        Place a position or build a strategy to estimate margin and size it.
      </div>
    )
  }

  const naked = !payoff || payoff.maxLoss === -Infinity
  const definedMaxLoss = !naked ? Math.abs(payoff.maxLoss) : null
  const riskUnit = naked ? (stop === '' ? null : Math.abs(Number(stop))) : definedMaxLoss
  const marginNow = margin?.total ?? 0

  const sizing = suggestLots({ capital, riskPct, perLotRisk: riskUnit ?? 0, marginPerLot: marginNow })
  const util = capital > 0 ? (marginNow / capital) * 100 : 0
  const utilCls = util > 90 ? 'bg-red-500' : util > 70 ? 'bg-amber-400' : 'bg-sky-500'

  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* ── margin estimate ── */}
      <Header right="SPAN approx · est.">
        Est. margin <Info k="marginTotal" side="bottom" />
      </Header>
      <div className="space-y-1.5 px-3 py-2">
        <Row label="SPAN" k="spanMargin">{money(margin?.span ?? 0)}</Row>
        <Row label="Exposure (2%)" k="exposureMargin">{money(margin?.exposure ?? 0)}</Row>
        <Row label="Long premium">{money(margin?.premium ?? 0)}</Row>
        {margin?.benefit > 0 && (
          <Row label="Hedge benefit">
            <span className="text-emerald-400">−{money(margin.benefit)}</span>
          </Row>
        )}
        <div className="my-1 h-px bg-edge" />
        <Row label="Total margin" k="marginTotal" strong>
          {money(marginNow)}
        </Row>
        {margin?.hasNaked && (
          <div className="mt-1 rounded border border-amber-700/50 bg-amber-600/10 px-2 py-1 text-[10px] text-amber-300">
            Naked short legs — full margin, unlimited loss. Defined-risk spreads get a hedge margin benefit.
          </div>
        )}
        {margin?.defined && (
          <div className="mt-1 rounded border border-emerald-800/40 bg-emerald-600/10 px-2 py-1 text-[10px] text-emerald-300">
            Defined-risk — margin capped near max loss ({money(definedMaxLoss)}).
          </div>
        )}
      </div>

      {/* ── position sizing ── */}
      <Header>Position sizing</Header>
      <div className="space-y-1.5 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="flex shrink-0 items-center gap-1 text-slate-400">
            Capital <Info k="riskBudget" side="right" />
          </span>
          <span className="ml-auto flex items-center gap-1">
            <span className="text-slate-600">₹</span>
            <input type="number" min={0} value={capital} onChange={(e) => setCapital(Math.max(0, Number(e.target.value) | 0))} className={inputCls} />
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="shrink-0 text-slate-400">Risk per trade</span>
          <span className="ml-auto flex items-center gap-1">
            <input type="number" min={0} step="0.5" value={riskPct} onChange={(e) => setRiskPct(Math.max(0, Number(e.target.value)))} className={inputCls} />
            <span className="text-slate-600">%</span>
          </span>
        </div>
        {naked && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="shrink-0 text-amber-400/80">Stop / position</span>
            <span className="ml-auto flex items-center gap-1">
              <span className="text-slate-600">₹</span>
              <input type="number" min={0} placeholder="set risk" value={stop} onChange={(e) => setStop(e.target.value)} className={inputCls} />
            </span>
          </div>
        )}
      </div>

      {/* ── results ── */}
      <div className="mt-auto space-y-2 border-t border-edge px-3 py-3">
        <div className="flex items-end justify-between">
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
            Suggested size <Info k="suggestedSize" side="top" />
          </span>
          {riskUnit != null ? (
            <span className="font-mono text-lg font-semibold text-sky-300">
              {sizing.lots}× <span className="text-[11px] font-normal text-slate-500">position</span>
            </span>
          ) : (
            <span className="text-[11px] text-amber-400">set a stop to size</span>
          )}
        </div>
        <Row label="Risk budget">{money(sizing.riskBudget)}</Row>
        <Row label={naked ? 'Stop / position' : 'Max loss'}>{riskUnit != null ? money(riskUnit) : '—'}</Row>
        <Row label="Margin / position">{money(marginNow)}</Row>

        {riskUnit != null && sizing.lots === 0 && (
          <div className="rounded border border-red-800/40 bg-red-600/10 px-2 py-1 text-[10px] text-red-300">
            One position already exceeds your {sizing.capped === 'margin' ? 'capital' : 'risk budget'} — reduce size or raise capital.
          </div>
        )}

        {/* current-position margin utilisation */}
        <div className="flex items-center gap-2 text-[11px]">
          <span className="flex shrink-0 items-center gap-1 text-slate-400">
            Margin used <Info k="marginUtil" side="right" />
          </span>
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-edge">
            <div className={`absolute left-0 top-0 h-full rounded-full ${utilCls}`} style={{ width: `${Math.min(100, util)}%` }} />
          </div>
          <span className="w-12 text-right font-mono text-slate-300">{util.toFixed(0)}%</span>
        </div>

        {riskUnit != null && sizing.lots > 0 && (
          <p className="text-[10px] text-slate-600">
            Capped by {sizing.capped === 'margin' ? 'available margin' : 'risk budget'} · {sizing.lots}× ≈ {money(sizing.marginUsed)} margin ({sizing.utilPct.toFixed(0)}% of capital).
          </p>
        )}
      </div>
    </div>
  )
}
