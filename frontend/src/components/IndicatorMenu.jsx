import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CATALOG } from '../utils/indicators'
import { PATTERN_CATALOG } from '../utils/patterns'

// Dropdown to browse + add indicators and candlestick patterns, grouped and
// searchable. Each row has a `{ }` button that opens its Pine Script.
export default function IndicatorMenu({ onAdd, onAddPattern, onViewCode }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState(null) // {top,left,maxHeight} for the portaled (fixed) panel
  const btnRef = useRef(null)
  const panelRef = useRef(null)

  // Close on a click outside BOTH the trigger button and the (portaled) panel.
  useEffect(() => {
    const onDoc = (e) => {
      if (btnRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Position the panel in the VIEWPORT (it's portaled to <body> as position:fixed) so it can never
  // be clipped by an ancestor's overflow or pushed off-screen. The old `absolute left-0` panel
  // overflowed the right edge (then got clipped, leaving the empty band the user saw) whenever the
  // ƒ button sat near the screen's right, and could run past the bottom when the toolbar wrapped it
  // low. We anchor just below the button, FLIP to right-aligned if a left-aligned panel would spill
  // past the right edge, clamp within the viewport, and cap the height to the room below so the list
  // scrolls INSIDE the panel instead of off-screen.
  useLayoutEffect(() => {
    if (!open) return
    const PANEL_W = 320 // w-80
    const GAP = 4
    const M = 8 // viewport margin
    const place = () => {
      const b = btnRef.current?.getBoundingClientRect()
      if (!b) return
      const vw = document.documentElement.clientWidth
      const vh = document.documentElement.clientHeight
      let left = b.left
      if (left + PANEL_W > vw - M) left = b.right - PANEL_W // flip to right-aligned
      left = Math.max(M, Math.min(left, vw - PANEL_W - M))
      const top = b.bottom + GAP
      const maxHeight = Math.min(448, Math.max(160, vh - top - M)) // 448 = the old 28rem cap
      setPos({ top, left, maxHeight })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true) // recompute on ancestor scroll too
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const term = q.trim().toLowerCase()
  const filt = (catalog) =>
    catalog
      .map((g) => ({ ...g, items: term ? g.items.filter((it) => it.name.toLowerCase().includes(term)) : g.items }))
      .filter((g) => g.items.length)
  const indGroups = filt(CATALOG)
  const patGroups = filt(PATTERN_CATALOG)

  const Row = ({ it, kind }) => (
    <div
      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-xs ${
        it.disabled ? 'text-slate-600' : 'text-slate-200 hover:bg-sky-900/40'
      }`}
    >
      <button
        disabled={!!it.disabled}
        onClick={() => {
          if (it.disabled) return
          ;(kind === 'pattern' ? onAddPattern : onAdd)(it.key)
          setOpen(false)
        }}
        className={`flex min-w-0 flex-1 items-center gap-1.5 text-left ${it.disabled ? 'cursor-not-allowed' : ''}`}
      >
        <span className="truncate">{it.name}</span>
        {kind === 'pattern' && it.type && (
          <span className="shrink-0 text-[9px] uppercase tracking-wide text-slate-500">{it.type}</span>
        )}
        {it.disabled && (
          <span className="shrink-0 text-[9px] uppercase tracking-wide text-slate-600">{it.disabled}</span>
        )}
      </button>
      <button
        onClick={() => onViewCode(kind, it.key)}
        title="View Pine Script"
        className="shrink-0 rounded border border-edge px-1.5 py-0.5 font-mono text-[10px] leading-none text-slate-400 hover:border-sky-600 hover:text-sky-300"
      >
        {'{ }'}
      </button>
    </div>
  )

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        title="Add indicator or pattern"
        className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
          open
            ? 'border-sky-600 bg-sky-600/20 text-sky-200'
            : 'border-edge bg-panel2 text-slate-300 hover:bg-edge hover:text-white'
        }`}
      >
        <span className="text-sm leading-none">ƒ</span> Indicators
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[100] w-80 overflow-auto rounded-md border border-edge bg-panel2 shadow-2xl shadow-black/60"
            style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}
          >
          <div className="sticky top-0 z-10 border-b border-edge bg-panel2 p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search indicators & patterns…"
              className="w-full rounded border border-edge bg-panel px-2 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-600"
            />
          </div>

          {indGroups.map((g) => (
            <div key={`ind-${g.category}`}>
              <div className="bg-ink/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {g.category} ({g.items.length})
              </div>
              {g.items.map((it) => (
                <Row key={it.key} it={it} kind="indicator" />
              ))}
            </div>
          ))}

          {patGroups.length > 0 && (
            <div className="border-t border-edge bg-sky-950/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-400">
              Candlestick Patterns
            </div>
          )}
          {patGroups.map((g) => (
            <div key={`pat-${g.category}`}>
              <div className="bg-ink/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {g.category} ({g.items.length})
              </div>
              {g.items.map((it) => (
                <Row key={it.key} it={it} kind="pattern" />
              ))}
            </div>
          ))}

          {indGroups.length === 0 && patGroups.length === 0 && (
            <div className="px-3 py-3 text-xs text-slate-500">No match for “{q}”.</div>
          )}
          </div>,
          document.body,
        )}
    </div>
  )
}
