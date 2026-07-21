import { useMemo } from 'react'
import { format, parse } from 'date-fns'

// Compact summary strip above the option chain: Day Open / Spot / Synth Fut and
// total Call / Put OI (with change). Spot + Day Open come from the backend
// (/api/underlying); Synth Fut and the OI totals are derived from the chain.

const px = (n) => (n == null ? '—' : n.toFixed(1))
const cr = (n) => (n == null ? '—' : (n / 1e7).toFixed(1) + 'Cr')
const crChg = (n) => (n == null ? '' : (n >= 0 ? '+' : '') + (n / 1e7).toFixed(1) + 'Cr')
const cls = (n) => (n == null ? 'text-slate-400' : n > 0 ? 'text-green-400' : n < 0 ? 'text-red-400' : 'text-slate-400')

function chgLabel(cur, base) {
  if (cur == null || base == null) return null
  const d = cur - base
  const pct = base ? (d / base) * 100 : 0
  return `${d >= 0 ? '+' : ''}${d.toFixed(d >= 100 || d <= -100 ? 0 : 1)}pt, ${d >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

const Stat = ({ label, value, chg, chgColor, extra }) => (
  <span className="flex items-baseline gap-1">
    <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
    <span className="font-mono font-semibold tabular-nums text-slate-100">{value}</span>
    {chg && <span className={`text-[11px] ${chgColor}`}>({chg})</span>}
    {extra && <span className="text-[10px] text-slate-500">{extra}</span>}
  </span>
)

export default function ChainHeader({ chain, underlying, expiry }) {
  const stats = useMemo(() => {
    if (!chain || chain.length === 0) return null
    let callOi = 0, putOi = 0, callChg = 0, putChg = 0
    let atm = null, best = Infinity
    for (const r of chain) {
      if (r.ce?.oi) callOi += r.ce.oi
      if (r.pe?.oi) putOi += r.pe.oi
      if (r.ce?.chgOi) callChg += r.ce.chgOi
      if (r.pe?.chgOi) putChg += r.pe.chgOi
      if (r.ce?.ltp != null && r.pe?.ltp != null) {
        const d = Math.abs(r.ce.ltp - r.pe.ltp)
        if (d < best) { best = d; atm = r }
      }
    }
    // Synthetic future from put-call parity: F ≈ K + (C - P) at the ATM strike.
    const synthFut = atm ? atm.strike + (atm.ce.ltp - atm.pe.ltp) : null
    return { callOi, putOi, callChg, putChg, synthFut }
  }, [chain])

  if (!stats) return null
  const { spot, dayOpen, prevClose } = underlying || {}
  let expLabel = expiry
  try { expLabel = format(parse(expiry, 'yyyy-MM-dd', new Date()), 'd MMM') } catch {}

  return (
    <div className="border-b border-edge bg-panel px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <Stat label="Day Open" value={px(dayOpen)} chg={chgLabel(dayOpen, prevClose)} chgColor={cls(dayOpen != null && prevClose != null ? dayOpen - prevClose : null)} />
        <Stat label="Spot" value={px(spot)} chg={chgLabel(spot, dayOpen)} chgColor={cls(spot != null && dayOpen != null ? spot - dayOpen : null)} />
        <Stat label="Synth Fut" value={px(stats.synthFut)} extra={`(${expLabel})`} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-x-5 text-sm">
        <span className="flex items-baseline gap-1">
          <span className="text-[10px] uppercase tracking-wide text-sky-400/80">Call OI</span>
          <span className="font-mono font-semibold tabular-nums text-sky-200">{cr(stats.callOi)}</span>
          <span className={`text-[11px] ${cls(stats.callChg)}`}>({crChg(stats.callChg)})</span>
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Option Chain <span className="text-slate-500">({expLabel})</span>
        </span>
        <span className="flex items-baseline gap-1">
          <span className="text-[10px] uppercase tracking-wide text-orange-400/80">Put OI</span>
          <span className="font-mono font-semibold tabular-nums text-orange-200">{cr(stats.putOi)}</span>
          <span className={`text-[11px] ${cls(stats.putChg)}`}>({crChg(stats.putChg)})</span>
        </span>
      </div>
    </div>
  )
}
