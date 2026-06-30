import { useMemo } from 'react'

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
          {chain.map((row) => {
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

            const onCe = () => row.ce && onSelect(row.strike, 'CE')
            const onPe = () => row.pe && onSelect(row.strike, 'PE')

            return (
              <tr
                key={row.strike}
                className={isAtm ? 'bg-amber-400/[0.07]' : ''}
              >
                {/* CALLS */}
                <td className={`${ceCell} ${ceSelCls} w-[88px]`} onClick={onCe}>
                  <OiBar value={row.ce?.oi} max={maxOi} side="ce" />
                </td>
                <td
                  className={`${ceCell} ${ceSelCls} text-slate-300`}
                  onClick={onCe}
                  title={fmtFull(row.ce?.oi)}
                >
                  {fmtOi(row.ce?.oi)}
                </td>
                <td
                  className={`${ceCell} ${ceSelCls} ${chgCls(row.ce?.chgOi)}`}
                  onClick={onCe}
                  title={fmtFull(row.ce?.chgOi)}
                >
                  {fmtChg(row.ce?.chgOi)}
                </td>
                <td
                  className={`${ceCell} ${ceSelCls} text-slate-400`}
                  onClick={onCe}
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
                  className={`${peCell} ${peSelCls} text-left text-slate-400`}
                  onClick={onPe}
                  title={fmtFull(row.pe?.volume)}
                >
                  {fmtVol(row.pe?.volume)}
                </td>
                <td
                  className={`${peCell} ${peSelCls} text-left ${chgCls(row.pe?.chgOi)}`}
                  onClick={onPe}
                  title={fmtFull(row.pe?.chgOi)}
                >
                  {fmtChg(row.pe?.chgOi)}
                </td>
                <td
                  className={`${peCell} ${peSelCls} text-left text-slate-300`}
                  onClick={onPe}
                  title={fmtFull(row.pe?.oi)}
                >
                  {fmtOi(row.pe?.oi)}
                </td>
                <td className={`${peCell} ${peSelCls} w-[88px]`} onClick={onPe}>
                  <OiBar value={row.pe?.oi} max={maxOi} side="pe" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
