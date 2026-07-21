// One-click strategy builder. A modal grid of catalog strategies (Neutral / Bullish / Bearish
// / Volatility). Lots + Width controls at the top re-resolve every card against the LIVE chain,
// so each card previews its real strikes and net credit/debit before you place. Clicking a card
// places all legs as one grouped batch at the clock (sim.placeStrategy) and closes.
import { useMemo, useState } from 'react'
import { STRATEGIES, CATEGORIES } from '../strategy/catalog.js'
import { money } from './fmt.js'

const FILTERS = ['All', ...CATEGORIES]
const WIDTHS = [
  { w: 1, label: 'Tight' },
  { w: 2, label: 'Normal' },
  { w: 3, label: 'Wide' },
]

const OUTLOOK = {
  bull: { label: 'Bullish', cls: 'bg-emerald-600/20 text-emerald-300' },
  bear: { label: 'Bearish', cls: 'bg-red-600/20 text-red-300' },
  neutral: { label: 'Neutral', cls: 'bg-sky-600/20 text-sky-300' },
  vol: { label: 'Volatility', cls: 'bg-violet-600/20 text-violet-300' },
}

/** Compact leg chip: "-2 22000 CE" coloured by side + option type. */
function LegChip({ spec }) {
  const long = spec.side > 0
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-panel px-1 py-0.5 font-mono text-[10px]">
      <span className={long ? 'text-emerald-400' : 'text-red-400'}>{long ? '+' : '-'}{spec.lots}</span>
      <span className="text-slate-300">{spec.strike}</span>
      <span className={spec.type === 'CE' ? 'text-sky-400' : 'text-orange-400'}>{spec.type}</span>
    </span>
  )
}

function StrategyCard({ s, data, onPlace }) {
  const res = data?.res
  const margin = data?.margin
  const ok = res && res.missing.length === 0 && res.specs.length > 0
  const o = OUTLOOK[s.outlook] || OUTLOOK.neutral
  const credit = res ? res.net >= 0 : false
  return (
    <button
      onClick={() => ok && onPlace(s.id)}
      disabled={!ok}
      title={s.desc}
      className={`group flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors ${
        ok
          ? 'border-edge bg-panel2 hover:border-sky-600/70 hover:bg-panel'
          : 'cursor-not-allowed border-edge/40 bg-panel2/40 opacity-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-semibold leading-tight text-slate-100">{s.name}</span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${o.cls}`}>{o.label}</span>
      </div>

      <p className="line-clamp-2 text-[10.5px] leading-snug text-slate-500">{s.desc}</p>

      {ok ? (
        <>
          <div className="flex flex-wrap gap-1">
            {res.specs.map((sp, i) => <LegChip key={i} spec={sp} />)}
          </div>
          <div className="mt-auto flex items-center justify-between pt-1 text-[10px]">
            <span className="text-slate-600">{res.specs.length} legs</span>
            <span className={`font-mono font-semibold ${credit ? 'text-emerald-400' : 'text-amber-400'}`}>
              {credit ? 'Credit ' : 'Debit '}{money(Math.abs(res.net))}
            </span>
          </div>
          {margin && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-600">Margin ≈ {money(margin.total)}</span>
              <span className={margin.defined ? 'text-emerald-500/80' : margin.hasNaked ? 'text-amber-500/80' : 'text-slate-600'}>
                {margin.defined ? 'defined-risk' : margin.hasNaked ? 'naked' : ''}
              </span>
            </div>
          )}
        </>
      ) : (
        <span className="mt-auto text-[10px] text-slate-600">Chain doesn’t reach these strikes</span>
      )}
    </button>
  )
}

export default function StrategyPicker({ sim, onClose }) {
  const [lots, setLots] = useState(1)
  const [width, setWidth] = useState(2)
  const [filter, setFilter] = useState('All')

  // Re-resolve + margin-preview every strategy whenever lots/width/clock changes.
  // resolveStrategy is a cheap snapshot read; marginFor adds a light preview payoff.
  const previews = useMemo(() => {
    const m = {}
    for (const s of STRATEGIES) {
      const res = sim.resolveStrategy(s.id, { lots, width })
      m[s.id] = { res, margin: res && !res.missing.length ? sim.marginFor(res) : null }
    }
    return m
  }, [sim, lots, width])

  const shown = filter === 'All' ? STRATEGIES : STRATEGIES.filter((s) => s.cat === filter)

  const place = (id) => {
    const r = sim.placeStrategy(id, { lots, width })
    if (r && !r.missing.length && r.specs.length) onClose()
  }

  const hasChain = sim.atmStrike != null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-[860px] max-w-full flex-col rounded-xl border border-edge bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <div>
            <h3 className="text-sm font-bold tracking-wide text-slate-100">Strategy Builder</h3>
            <p className="text-[11px] text-slate-500">
              {hasChain
                ? <>One click builds the full structure around <span className="font-mono text-slate-300">ATM {sim.atmStrike}</span> · step <span className="font-mono text-slate-300">{sim.strikeStep}</span></>
                : 'Load an expiry to enable one-click strategies.'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-edge bg-panel2 px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Lots</span>
            <button onClick={() => setLots((l) => Math.max(1, l - 1))} className="flex h-6 w-6 items-center justify-center rounded border border-edge bg-panel text-sm font-bold leading-none text-slate-300 hover:bg-edge hover:text-white">-</button>
            <span className="w-6 text-center font-mono text-slate-100">{lots}</span>
            <button onClick={() => setLots((l) => l + 1)} className="flex h-6 w-6 items-center justify-center rounded border border-edge bg-panel text-sm font-bold leading-none text-slate-300 hover:bg-edge hover:text-white">+</button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Width</span>
            <div className="flex overflow-hidden rounded border border-edge">
              {WIDTHS.map(({ w, label }) => (
                <button
                  key={w}
                  onClick={() => setWidth(w)}
                  title={`OTM legs ${w} strike-step${w > 1 ? 's' : ''} out`}
                  className={`px-2 py-1 text-[11px] font-medium ${width === w ? 'bg-sky-600 text-white' : 'bg-panel text-slate-400 hover:bg-edge'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded px-2 py-1 text-[11px] font-medium ${filter === f ? 'bg-edge text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* grid */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {!hasChain ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-500">No chain loaded.</div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((s) => (
                <StrategyCard key={s.id} s={s} data={previews[s.id]} onPlace={place} />
              ))}
            </div>
          )}
        </div>

        {/* footer hint */}
        <div className="border-t border-edge px-4 py-2 text-[10.5px] text-slate-600">
          Strikes snap to the nearest tradable strike on the live chain. Net is premium per lot-size at the current clock — sells collect (credit), buys pay (debit).
        </div>
      </div>
    </div>
  )
}
