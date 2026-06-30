// Equity curve: plots the SAMPLED equityCurve (realized + unrealized) over the replayed
// session so far. It just renders sim.curve — a slice of the precomputed full curve — so
// scrubbing back redraws it identically. Uses the app's lightweight-charts v4.
import { useEffect, useRef } from 'react'
import { createChart, CrosshairMode } from 'lightweight-charts'
import { cssVar, chartThemeOptions, onThemeChange } from '../../theme'

const pad = (n) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtT = (s) => { const d = new Date(s * 1000); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }
const fmtD = (s) => { const d = new Date(s * 1000); return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}` }

export default function EquityCurve({ curve }) {
  const wrapRef = useRef(null)
  const chartRef = useRef(null)
  const equityRef = useRef(null)
  const realizedRef = useRef(null)
  const zeroRef = useRef(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { color: cssVar('--opt-ink', '#0a0e14') }, textColor: cssVar('--opt-muted', '#8b9bb0'), fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 10 },
      grid: { vertLines: { color: cssVar('--opt-edge', 'rgba(40,54,74,0.30)') }, horzLines: { color: cssVar('--opt-edge', 'rgba(40,54,74,0.30)') } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: cssVar('--opt-edge', '#1e2a3a') },
      timeScale: {
        borderColor: cssVar('--opt-edge', '#1e2a3a'), timeVisible: true, secondsVisible: false,
        tickMarkFormatter: (time, type) => (type <= 2 ? fmtD(time) : fmtT(time)),
      },
      localization: { timeFormatter: (s) => `${fmtD(s)} ${fmtT(s)}`, priceFormatter: (p) => `₹${Math.round(p).toLocaleString('en-IN')}` },
    })
    zeroRef.current = chart.addLineSeries({ color: '#3b4d66', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
    realizedRef.current = chart.addLineSeries({ color: '#64748b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'realized' })
    equityRef.current = chart.addLineSeries({ color: '#38bdf8', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'equity' })
    chartRef.current = chart

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    const stopTheme = onThemeChange(() => chart.applyOptions(chartThemeOptions()))
    return () => { ro.disconnect(); stopTheme(); chart.remove(); chartRef.current = null }
  }, [])

  useEffect(() => {
    if (!chartRef.current) return
    const eq = curve.map((p) => ({ time: p.t, value: p.equity }))
    const rl = curve.map((p) => ({ time: p.t, value: p.realized }))
    // baseline at 0 spanning the curve; collapse to one point when the curve has a single
    // bar (two identical timestamps would fail lightweight-charts' ascending-order check).
    const first = curve[0]?.t
    const last = curve[curve.length - 1]?.t
    const zero = !curve.length ? [] : first === last ? [{ time: first, value: 0 }] : [{ time: first, value: 0 }, { time: last, value: 0 }]
    equityRef.current.setData(eq)
    realizedRef.current.setData(rl)
    zeroRef.current.setData(zero)
    if (eq.length) chartRef.current.timeScale().fitContent()
  }, [curve])

  return (
    <div className="relative h-full w-full">
      <div ref={wrapRef} className="h-full w-full" />
      {curve.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-600">
          Equity curve builds as the clock advances.
        </div>
      )}
    </div>
  )
}
