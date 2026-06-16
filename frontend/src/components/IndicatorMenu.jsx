import { useEffect, useRef, useState } from 'react'
import { CATALOG } from '../utils/indicators'

// Dropdown to browse + add indicators, grouped by category and searchable.
export default function IndicatorMenu({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const term = q.trim().toLowerCase()
  const groups = CATALOG.map((g) => ({
    ...g,
    items: term ? g.items.filter((it) => it.name.toLowerCase().includes(term)) : g.items,
  })).filter((g) => g.items.length)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Add indicator"
        className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
          open
            ? 'border-sky-600 bg-sky-600/20 text-sky-200'
            : 'border-edge bg-panel2 text-slate-300 hover:bg-edge hover:text-white'
        }`}
      >
        <span className="text-sm leading-none">ƒ</span> Indicators
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1 max-h-[26rem] w-80 overflow-auto rounded-md border border-edge bg-panel2 shadow-2xl shadow-black/60">
          <div className="sticky top-0 border-b border-edge bg-panel2 p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search indicators…"
              className="w-full rounded border border-edge bg-panel px-2 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-600"
            />
          </div>

          {groups.map((g) => (
            <div key={g.category}>
              <div className="bg-ink/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {g.category} ({g.items.length})
              </div>
              {g.items.map((it) => (
                <button
                  key={it.key}
                  disabled={!!it.disabled}
                  onClick={() => {
                    onAdd(it.key)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs ${
                    it.disabled
                      ? 'cursor-not-allowed text-slate-600'
                      : 'text-slate-200 hover:bg-sky-900/40'
                  }`}
                >
                  <span>{it.name}</span>
                  {it.disabled && (
                    <span className="shrink-0 text-[9px] uppercase tracking-wide text-slate-600">
                      {it.disabled}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}

          {groups.length === 0 && (
            <div className="px-3 py-3 text-xs text-slate-500">No match for “{q}”.</div>
          )}
        </div>
      )}
    </div>
  )
}
