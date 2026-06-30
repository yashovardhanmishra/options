// Payoff diagram (StockMock-style): expiry P&L (solid, green/red fill) + at-clock P&L
// (dashed blue, carries time value), the current-spot line, ±1σ/±2σ bands and breakevens.
// Pure render of the payoff summary from the engine — it computes nothing. Recomputes as
// the clock scrubs, so the dashed curve decays toward the solid expiry line over the replay.
import { useEffect, useRef, useState } from 'react'
import { money } from './fmt.js'

const M = { l: 8, r: 8, t: 16, b: 22 } // inner margins (px) inside the measured box

export default function PayoffChart({ payoff, spot, expiryLabel, clockLabel }) {
  const wrapRef = useRef(null)
  const [size, setSize] = useState({ w: 720, h: 320 })
  const [hoverX, setHoverX] = useState(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  if (!payoff || !payoff.curve?.length) {
    return (
      <div ref={wrapRef} className="flex h-full w-full items-center justify-center text-xs text-slate-600">
        Open a position to see its payoff.
      </div>
    )
  }

  const { curve, breakevens, sigma } = payoff
  const { w, h } = size
  const x0 = M.l, x1 = w - M.r, y0 = M.t, y1 = h - M.b

  const sLo = curve[0].S, sHi = curve[curve.length - 1].S
  // y-range: include 0 + both curves, but clip deep losses so the near-zero region stays readable.
  const vals = []
  for (const p of curve) { vals.push(p.expiry, p.now) }
  let vMax = Math.max(0, ...vals)
  let vMin = Math.min(0, ...vals)
  const scale = Math.max(vMax, Math.abs(payoff.netCredit) || 0, 1)
  vMin = Math.max(vMin, -3.2 * scale)
  const padV = (vMax - vMin) * 0.08 || 1
  vMax += padV; vMin -= padV

  const span = sHi - sLo
  const xf = (s) => (span > 0 ? x0 + ((s - sLo) / span) * (x1 - x0) : (x0 + x1) / 2)
  const yf = (v) => y1 - ((Math.max(vMin, Math.min(vMax, v)) - vMin) / (vMax - vMin)) * (y1 - y0)
  const yZero = yf(0)

  // filled areas: clamp to >=0 (green) / <=0 (red), down to the zero line.
  const areaPath = (clamp) =>
    'M ' + curve.map((p) => `${xf(p.S).toFixed(1)},${yf(clamp(p.expiry)).toFixed(1)}`).join(' L ') +
    ` L ${xf(sHi).toFixed(1)},${yZero.toFixed(1)} L ${xf(sLo).toFixed(1)},${yZero.toFixed(1)} Z`
  const greenArea = areaPath((v) => Math.max(v, 0))
  const redArea = areaPath((v) => Math.min(v, 0))

  // expiry line, colored per segment by sign (split at zero crossings).
  let gLine = '', rLine = ''
  const addSeg = (a, b) => {
    const seg = `M ${xf(a.S).toFixed(1)},${yf(a.v).toFixed(1)} L ${xf(b.S).toFixed(1)},${yf(b.v).toFixed(1)} `
    if ((a.v + b.v) / 2 >= 0) gLine += seg; else rLine += seg
  }
  for (let i = 0; i < curve.length - 1; i++) {
    const a = { S: curve[i].S, v: curve[i].expiry }
    const b = { S: curve[i + 1].S, v: curve[i + 1].expiry }
    if ((a.v < 0) !== (b.v < 0) && a.v !== b.v) {
      const f = a.v / (a.v - b.v)
      const c = { S: a.S + f * (b.S - a.S), v: 0 }
      addSeg(a, c); addSeg(c, b)
    } else addSeg(a, b)
  }
  const nowLine = 'M ' + curve.map((p) => `${xf(p.S).toFixed(1)},${yf(p.now).toFixed(1)}`).join(' L ')

  // hover -> nearest curve point
  const hi = hoverX == null ? null : Math.max(0, Math.min(curve.length - 1, Math.round(((hoverX - x0) / (x1 - x0)) * (curve.length - 1))))
  const hp = hi == null ? null : curve[hi]

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    setHoverX(px >= x0 && px <= x1 ? px : null)
  }

  const xTicks = 5, yTicks = 4
  const sigLines = [
    { v: sigma?.m2, label: '-2σ' }, { v: sigma?.m1, label: '-1σ' },
    { v: sigma?.p1, label: '+1σ' }, { v: sigma?.p2, label: '+2σ' },
  ].filter((s) => s.v != null && s.v >= sLo && s.v <= sHi)

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <svg width={w} height={h} className="block" onMouseMove={onMove} onMouseLeave={() => setHoverX(null)}>
        {/* Themed backdrop (matches the active template's canvas). */}
        <rect x="0" y="0" width={w} height={h} rx="8" fill="var(--opt-ink)" />
        {/* sigma band shading (between -2σ and +2σ, light) */}
        {sigma?.m2 != null && sigma?.p2 != null && (
          <rect x={xf(Math.max(sLo, sigma.m2))} y={y0} width={Math.max(0, xf(Math.min(sHi, sigma.p2)) - xf(Math.max(sLo, sigma.m2)))} height={y1 - y0} fill="var(--opt-edge)" opacity="0.25" />
        )}
        {/* loss zones (outside breakevens) faint red backdrop is implied by the red area fill */}
        <path d={greenArea} fill="var(--opt-pos)" opacity="0.18" />
        <path d={redArea} fill="var(--opt-neg)" opacity="0.16" />

        {/* y grid + labels */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = vMin + ((vMax - vMin) * i) / yTicks
          const y = yf(v)
          return (
            <g key={i}>
              <line x1={x0} x2={x1} y1={y} y2={y} stroke="var(--opt-edge)" strokeWidth="1" />
              <text x={x1 - 2} y={y - 2} textAnchor="end" fontSize="9" fill="var(--opt-muted)" fontFamily="ui-monospace,monospace">{money(v)}</text>
            </g>
          )
        })}
        {/* zero line */}
        <line x1={x0} x2={x1} y1={yZero} y2={yZero} stroke="var(--opt-muted)" strokeWidth="1" />

        {/* sigma lines */}
        {sigLines.map((s) => (
          <g key={s.label}>
            <line x1={xf(s.v)} x2={xf(s.v)} y1={y0} y2={y1} stroke="var(--opt-edge)" strokeDasharray="3 3" strokeWidth="1" opacity="0.7" />
            <text x={xf(s.v)} y={y0 + 9} textAnchor="middle" fontSize="8.5" fill="var(--opt-muted)">{s.label}</text>
          </g>
        ))}

        {/* expiry curve (green/red) + at-clock dashed curve */}
        <path d={nowLine} fill="none" stroke="var(--opt-call)" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.85" />
        <path d={gLine} fill="none" stroke="var(--opt-pos)" strokeWidth="2" />
        <path d={rLine} fill="none" stroke="var(--opt-neg)" strokeWidth="2" />

        {/* breakevens */}
        {breakevens.map((be, i) => (
          <g key={i}>
            <line x1={xf(be)} x2={xf(be)} y1={yZero - 5} y2={yZero + 5} stroke="var(--opt-text)" strokeWidth="1.5" />
            <text x={xf(be)} y={y1 + 14} textAnchor="middle" fontSize="9" fill="var(--opt-muted)" fontFamily="ui-monospace,monospace">{Math.round(be)}</text>
          </g>
        ))}

        {/* current spot */}
        {spot != null && spot >= sLo && spot <= sHi && (
          <g>
            <line x1={xf(spot)} x2={xf(spot)} y1={y0} y2={y1} stroke="var(--opt-text)" strokeWidth="1" opacity="0.8" />
            <text x={xf(spot)} y={y0 - 4} textAnchor="middle" fontSize="9.5" fill="var(--opt-text)" fontWeight="bold">Spot {spot.toFixed(0)}</text>
          </g>
        )}

        {/* x ticks */}
        {Array.from({ length: xTicks + 1 }, (_, i) => {
          const s = sLo + ((sHi - sLo) * i) / xTicks
          return <text key={i} x={xf(s)} y={y1 + 14} textAnchor="middle" fontSize="9" fill="var(--opt-faint)" fontFamily="ui-monospace,monospace">{Math.round(s)}</text>
        })}

        {/* hover */}
        {hp && (
          <g>
            <line x1={xf(hp.S)} x2={xf(hp.S)} y1={y0} y2={y1} stroke="var(--opt-muted)" strokeWidth="1" strokeDasharray="2 2" />
            <circle cx={xf(hp.S)} cy={yf(hp.expiry)} r="3" fill={hp.expiry >= 0 ? 'var(--opt-pos)' : 'var(--opt-neg)'} />
            <circle cx={xf(hp.S)} cy={yf(hp.now)} r="3" fill="var(--opt-call)" />
          </g>
        )}
      </svg>

      {hp && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-edge bg-panel/95 px-2 py-1.5 text-[10px] shadow-lg"
          style={{ left: Math.min(w - 150, Math.max(0, xf(hp.S) + 8)), top: M.t + 4 }}
        >
          <div className="mb-0.5 font-mono text-slate-300">Spot {hp.S.toFixed(0)} <span className="text-slate-500">({(((hp.S - spot) / spot) * 100).toFixed(2)}%)</span></div>
          <div className="font-mono"><span className="text-slate-500">Expiry </span><span className={hp.expiry >= 0 ? 'text-emerald-400' : 'text-red-400'}>{money(hp.expiry)}</span></div>
          <div className="font-mono"><span className="text-sky-400">@{clockLabel || 'clock'} </span><span className={hp.now >= 0 ? 'text-emerald-400' : 'text-red-400'}>{money(hp.now)}</span></div>
        </div>
      )}
    </div>
  )
}
