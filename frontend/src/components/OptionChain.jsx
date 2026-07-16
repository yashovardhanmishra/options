import { useMemo, useState, useEffect, useRef } from 'react'

const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
})
const indian = new Intl.NumberFormat('en-IN')

const fmtOi = (n) => (n == null ? '—' : compact.format(n))
const fmtVol = (n) => (n == null ? '—' : compact.format(n))
const fmtLtp = (n) => (n == null ? '—' : n.toFixed(2))
const fmtFull = (n) => (n == null ? '' : indian.format(n))
const fmtChg = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + compact.format(n))
const chgCls = (n) =>
  n == null ? 'text-slate-600' : n > 0 ? 'text-green-400' : n < 0 ? 'text-red-400' : 'text-slate-400'

// selectable metrics (see the multi-select block below) → the row field + a display label
const METRIC_LABEL = { oi: 'OI', chgOi: 'Chg OI', volume: 'Vol' }

/** Horizontal OI bar. side='ce' anchors right (grows left), 'pe' anchors left. */
function OiBar({ value, max, side }) {
  const pct = max > 0 && value ? Math.max(2, (value / max) * 100) : 0
  const color = side === 'ce' ? 'bg-sky-500/55' : 'bg-orange-500/55'
  return (
    <div className="relative h-3.5 w-full overflow-hidden">
      <div
        className={`absolute top-0 h-full rounded-sm ${color} ${
          side === 'ce' ? 'right-0' : 'left-0'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// Held-position highlight on the LTP cell: buy → green, sell → red, both sides of the strike
// held → sky blue. `positions` = { net: {`${strike}${type}`: netSide}, both: Set<strike> }.
const HILITE = {
  buy: 'rgba(16,185,129,0.28)',
  sell: 'rgba(239,68,68,0.28)',
  both: 'rgba(56,189,248,0.30)',
}
function sideHi(positions, strike, type) {
  if (!positions) return null
  if (positions.both?.has(strike)) return 'both'
  const net = positions.net?.[`${strike}${type}`]
  return net > 0 ? 'buy' : net < 0 ? 'sell' : null
}

export default function OptionChain({ chain, onSelect, selected, loading, positions }) {
  const { atmStrike, maxOi } = useMemo(() => {
    if (!chain || chain.length === 0) return { atmStrike: null, maxOi: 0 }

    // True ATM via put-call parity: the strike where CE and PE prices are
    // closest sits at the underlying (C - P = S - K·e^-rt ≈ 0 when K ≈ forward).
    // Uses the time-specific LTPs, so the ATM moves as you scrub the time
    // selector. Falls back to mid-of-strikes only if no strike has both sides.
    let atm = null
    let bestDiff = Infinity
    for (const r of chain) {
      if (r.ce?.ltp != null && r.pe?.ltp != null) {
        const d = Math.abs(r.ce.ltp - r.pe.ltp)
        if (d < bestDiff) {
          bestDiff = d
          atm = r.strike
        }
      }
    }
    if (atm == null) {
      const strikes = chain.map((r) => r.strike)
      const mid = (Math.min(...strikes) + Math.max(...strikes)) / 2
      atm = strikes[0]
      for (const s of strikes) if (Math.abs(s - mid) < Math.abs(atm - mid)) atm = s
    }

    let mx = 0
    for (const r of chain) {
      if (r.ce?.oi > mx) mx = r.ce.oi
      if (r.pe?.oi > mx) mx = r.pe.oi
    }
    return { atmStrike: atm, maxOi: mx }
  }, [chain])

  // ── Column multi-select (spreadsheet-style) — click / shift-click / ⌘-click / drag on an
  //    OI, Chg-OI or Vol cell to pick rows, Shift+↑/↓ to extend, Esc to clear. The floating
  //    footer sums the picked cells in FULL numbers (not compact K/M). Each metric+side is a
  //    separate column; clicking a strike / LTP (which opens the chart / trades) clears it. ──
  const [sel, setSel] = useState(null) // null | { metric:'oi'|'chgOi'|'volume', side:'CE'|'PE', set:Set<idx>, anchor, focus }
  const dragRef = useRef(null) // { metric, side } while dragging
  const movedRef = useRef(false) // did the drag move across rows?
  const suppressRef = useRef(false) // swallow the click that ends a drag

  const valAt = (i, metric, side) => chain[i]?.[side === 'CE' ? 'ce' : 'pe']?.[metric]
  const hasVal = (i, metric, side) => valAt(i, metric, side) != null
  const rangeSet = (a, b, metric, side) => {
    const s = new Set()
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (hasVal(i, metric, side)) s.add(i)
    return s
  }
  // next index in `dir` (+1/-1) that actually has this metric on this side (skips gaps); clamps.
  const step = (from, dir, metric, side) => {
    for (let i = from + dir; i >= 0 && i < chain.length; i += dir)
      if (hasVal(i, metric, side)) return i
    return from
  }
  const isSel = (i, metric, side) =>
    !!sel && sel.metric === metric && sel.side === side && sel.set.has(i)
  const selSum = sel
    ? [...sel.set].reduce((sum, i) => sum + (valAt(i, sel.metric, sel.side) || 0), 0)
    : 0

  const pick = (e, i, metric, side) => {
    if (suppressRef.current) {
      suppressRef.current = false
      return
    }
    if (!hasVal(i, metric, side)) return
    e.stopPropagation()
    setSel((cur) => {
      const sameCol = cur && cur.metric === metric && cur.side === side
      if (e.shiftKey && sameCol)
        return { metric, side, set: rangeSet(cur.anchor, i, metric, side), anchor: cur.anchor, focus: i }
      if ((e.metaKey || e.ctrlKey) && sameCol) {
        const set = new Set(cur.set)
        set.has(i) ? set.delete(i) : set.add(i)
        return set.size ? { metric, side, set, anchor: i, focus: i } : null
      }
      return { metric, side, set: new Set([i]), anchor: i, focus: i }
    })
  }
  const dragStart = (e, i, metric, side) => {
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || !hasVal(i, metric, side)) return
    dragRef.current = { metric, side }
    movedRef.current = false
    setSel({ metric, side, set: new Set([i]), anchor: i, focus: i })
  }
  const dragOver = (i, metric, side) => {
    const d = dragRef.current
    if (!d || d.metric !== metric || d.side !== side || !hasVal(i, metric, side)) return
    movedRef.current = true
    setSel((cur) => (cur ? { ...cur, set: rangeSet(cur.anchor, i, metric, side), focus: i } : cur))
  }
  const cellHandlers = (i, metric, side) => ({
    onMouseDown: (e) => dragStart(e, i, metric, side),
    onMouseEnter: () => dragOver(i, metric, side),
    onClick: (e) => pick(e, i, metric, side),
  })
  const selCls = (on, side) =>
    on
      ? side === 'CE'
        ? 'bg-sky-500/30 ring-1 ring-inset ring-sky-300/70'
        : 'bg-orange-500/30 ring-1 ring-inset ring-orange-300/70'
      : ''

  useEffect(() => {
    const up = () => {
      if (dragRef.current && movedRef.current) suppressRef.current = true
      dragRef.current = null
      movedRef.current = false
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])
  useEffect(() => {
    if (!sel) return
    const onKey = (e) => {
      if (e.key === 'Escape') return setSel(null)
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      e.preventDefault()
      const dir = e.key === 'ArrowDown' ? 1 : -1
      setSel((cur) => {
        if (!cur) return cur
        const nf = step(cur.focus, dir, cur.metric, cur.side)
        return e.shiftKey
          ? { ...cur, set: rangeSet(cur.anchor, nf, cur.metric, cur.side), focus: nf }
          : { metric: cur.metric, side: cur.side, set: new Set([nf]), anchor: nf, focus: nf }
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, chain])
  useEffect(() => setSel(null), [chain]) // drop stale index-based selection on new data

  if (!chain || chain.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        {loading ? 'Loading chain…' : 'No chain data for this expiry / date.'}
      </div>
    )
  }

  const Th = ({ children, className = '' }) => (
    <th
      className={`sticky top-0 z-10 bg-panel px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 ${className}`}
    >
      {children}
    </th>
  )

  return (
    <div className="relative h-full">
      <div className="h-full overflow-auto">
        <table className="w-full border-collapse text-right font-mono text-xs tabular-nums">
          <thead>
            <tr>
              <th
                colSpan={5}
                className="sticky top-0 z-10 bg-panel px-2 py-1 text-center text-[11px] font-bold uppercase tracking-widest text-sky-400"
              >
                Calls
              </th>
              <th className="sticky top-0 z-10 bg-panel px-2 py-1 text-center text-[11px] font-bold uppercase tracking-widest text-slate-300">
                Strike
              </th>
              <th
                colSpan={5}
                className="sticky top-0 z-10 bg-panel px-2 py-1 text-center text-[11px] font-bold uppercase tracking-widest text-orange-400"
              >
                Puts
              </th>
            </tr>
            <tr>
              <Th className="text-center">OI bar</Th>
              <Th>OI</Th>
              <Th>Chg OI</Th>
              <Th>Vol</Th>
              <Th className="text-sky-300/80">LTP</Th>
              <Th className="text-center">—</Th>
              <Th className="text-left text-orange-300/80">LTP</Th>
              <Th className="text-left">Vol</Th>
              <Th className="text-left">Chg OI</Th>
              <Th className="text-left">OI</Th>
              <Th className="text-center">OI bar</Th>
            </tr>
          </thead>
          <tbody>
            {chain.map((row, i) => {
              const isAtm = row.strike === atmStrike
              const ceSel = selected?.strike === row.strike && selected?.type === 'CE'
              const peSel = selected?.strike === row.strike && selected?.type === 'PE'
              const ceHi = sideHi(positions, row.strike, 'CE')
              const peHi = sideHi(positions, row.strike, 'PE')

              const ceCell =
                'cursor-pointer bg-sky-500/[0.04] px-2 py-1 transition-colors hover:bg-sky-500/20'
              const peCell =
                'cursor-pointer bg-orange-500/[0.04] px-2 py-1 transition-colors hover:bg-orange-500/20'
              const ceSelCls = ceSel ? 'bg-sky-500/25 ring-1 ring-inset ring-sky-400/60' : ''
              const peSelCls = peSel ? 'bg-orange-500/25 ring-1 ring-inset ring-orange-400/60' : ''

              // LTP cells open the chart / place a trade (and clear any metric selection).
              const onCe = () => {
                setSel(null)
                row.ce && onSelect(row.strike, 'CE')
              }
              const onPe = () => {
                setSel(null)
                row.pe && onSelect(row.strike, 'PE')
              }

              return (
                <tr key={row.strike} className={isAtm ? 'bg-amber-400/[0.07]' : ''}>
                  {/* CALLS */}
                  <td
                    className={`${ceCell} ${selCls(isSel(i, 'oi', 'CE'), 'CE')} w-[88px] select-none`}
                    {...cellHandlers(i, 'oi', 'CE')}
                  >
                    <OiBar value={row.ce?.oi} max={maxOi} side="ce" />
                  </td>
                  <td
                    className={`${ceCell} ${selCls(isSel(i, 'oi', 'CE'), 'CE')} select-none text-slate-300`}
                    {...cellHandlers(i, 'oi', 'CE')}
                    title={fmtFull(row.ce?.oi)}
                  >
                    {fmtOi(row.ce?.oi)}
                  </td>
                  <td
                    className={`${ceCell} ${selCls(isSel(i, 'chgOi', 'CE'), 'CE')} select-none ${chgCls(row.ce?.chgOi)}`}
                    {...cellHandlers(i, 'chgOi', 'CE')}
                    title={fmtFull(row.ce?.chgOi)}
                  >
                    {fmtChg(row.ce?.chgOi)}
                  </td>
                  <td
                    className={`${ceCell} ${selCls(isSel(i, 'volume', 'CE'), 'CE')} select-none text-slate-400`}
                    {...cellHandlers(i, 'volume', 'CE')}
                    title={fmtFull(row.ce?.volume)}
                  >
                    {fmtVol(row.ce?.volume)}
                  </td>
                  <td
                    className={`${ceCell} ${ceSelCls} font-semibold text-sky-200`}
                    style={ceHi ? { background: HILITE[ceHi] } : undefined}
                    onClick={onCe}
                  >
                    {fmtLtp(row.ce?.ltp)}
                  </td>

                  {/* STRIKE */}
                  <td
                    className={`px-2 py-1 text-center font-bold ${
                      isAtm
                        ? 'bg-amber-400/20 text-amber-300'
                        : 'bg-panel2 text-slate-200'
                    }`}
                  >
                    {row.strike}
                  </td>

                  {/* PUTS */}
                  <td
                    className={`${peCell} ${peSelCls} text-left font-semibold text-orange-200`}
                    style={peHi ? { background: HILITE[peHi] } : undefined}
                    onClick={onPe}
                  >
                    {fmtLtp(row.pe?.ltp)}
                  </td>
                  <td
                    className={`${peCell} ${selCls(isSel(i, 'volume', 'PE'), 'PE')} select-none text-left text-slate-400`}
                    {...cellHandlers(i, 'volume', 'PE')}
                    title={fmtFull(row.pe?.volume)}
                  >
                    {fmtVol(row.pe?.volume)}
                  </td>
                  <td
                    className={`${peCell} ${selCls(isSel(i, 'chgOi', 'PE'), 'PE')} select-none text-left ${chgCls(row.pe?.chgOi)}`}
                    {...cellHandlers(i, 'chgOi', 'PE')}
                    title={fmtFull(row.pe?.chgOi)}
                  >
                    {fmtChg(row.pe?.chgOi)}
                  </td>
                  <td
                    className={`${peCell} ${selCls(isSel(i, 'oi', 'PE'), 'PE')} select-none text-left text-slate-300`}
                    {...cellHandlers(i, 'oi', 'PE')}
                    title={fmtFull(row.pe?.oi)}
                  >
                    {fmtOi(row.pe?.oi)}
                  </td>
                  <td
                    className={`${peCell} ${selCls(isSel(i, 'oi', 'PE'), 'PE')} w-[88px] select-none`}
                    {...cellHandlers(i, 'oi', 'PE')}
                  >
                    <OiBar value={row.pe?.oi} max={maxOi} side="pe" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {sel && sel.set.size > 0 && (
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-edge bg-panel2/95 px-3 py-1.5 shadow-xl backdrop-blur">
          <span
            className={`text-xs font-semibold uppercase tracking-wide ${
              sel.side === 'CE' ? 'text-sky-300' : 'text-orange-300'
            }`}
          >
            {sel.side} {METRIC_LABEL[sel.metric]}
          </span>
          <span className="text-xs text-slate-400">
            {sel.set.size} {sel.set.size === 1 ? 'strike' : 'strikes'}
          </span>
          <span className="font-mono text-sm font-bold tabular-nums text-white">
            Σ&nbsp;{sel.metric === 'chgOi' && selSum > 0 ? '+' : ''}
            {indian.format(selSum)}
          </span>
          <button
            onClick={() => setSel(null)}
            title="Clear selection (Esc)"
            className="text-slate-500 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
