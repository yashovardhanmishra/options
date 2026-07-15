import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, CrosshairMode } from 'lightweight-charts'
import { format, parse } from 'date-fns'
import { getChart, getSpot } from '../api'
import {
  resample,
  filterByRange,
  dateStrToSec,
  secToDateStr,
  tfToSeconds,
  TIMEFRAMES,
} from '../utils/resample'
import { INDICATORS, defaultParams } from '../utils/indicators'
import { cssVar, chartThemeOptions, onThemeChange } from '../theme'
import { detectPattern, PATTERN_BY_KEY, PATTERN_PINE } from '../utils/patterns'
import { evalPine } from '../utils/pine'
import { INDICATOR_PINE } from '../utils/pinescript'
import IndicatorMenu from './IndicatorMenu'
import CodeModal from './CodeModal'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n) => String(n).padStart(2, '0')
// Format unix-seconds (wall-clock-as-UTC) using UTC parts -> shows IST clock.
const fmtDateUTC = (sec) => {
  const x = new Date(sec * 1000)
  return `${pad(x.getUTCDate())} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`
}
const fmtTimeUTC = (sec) => {
  const x = new Date(sec * 1000)
  return `${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`
}
// Up to this many trading days, the replay picker is a plain day-dropdown (options); beyond
// it (the multi-year spot index) it falls back to a native calendar.
const REPLAY_DAY_DROPDOWN_MAX = 90
// "YYYY-MM-DD" -> "Tue, 13 May 2026" for the replay-day dropdown.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const fmtReplayDate = (d) => {
  const [y, m, dd] = d.split('-').map(Number)
  const wd = DOW[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]
  return `${wd}, ${dd} ${MONTHS[m - 1]} ${y}`
}

function expiryLabel(iso) {
  try {
    return format(parse(iso, 'yyyy-MM-dd', new Date()), 'MMM dd yyyy')
  } catch {
    return iso
  }
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })
// indicator value: 2 decimals, but compact for big ones (OBV, A/D, PVT…)
const fmtVal = (v) => (Math.abs(v) >= 100000 ? compact.format(v) : v.toFixed(2))

// shared style for the replay transport buttons (step / play-pause)
const replayBtn =
  'rounded border border-edge bg-panel px-2 py-1 text-slate-200 hover:bg-edge hover:text-white'

export default function ChartPanel({ selection, onClose, spot = false }) {
  const wrapRef = useRef(null)
  const chartRef = useRef(null)
  const candleRef = useRef(null)
  const oiRef = useRef(null)
  const mapRef = useRef(new Map()) // time -> full candle (for tooltip)
  const seriesRef = useRef([]) // latest computed series (read by paint())
  const indSeriesRef = useRef(new Map()) // indicator uid -> [lightweight-charts series]
  const uidRef = useRef(0)
  const replayWinRef = useRef(150) // visible-bar window captured when replay starts
  const prevLenRef = useRef(0) // bar count last painted (to detect forward ticks / follow)
  const prevReplayOnRef = useRef(false)

  const [raw, setRaw] = useState([])
  const [tf, setTf] = useState(spot ? '15m' : '1m')
  const [customTf, setCustomTf] = useState('') // value of the custom-minutes box
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [tip, setTip] = useState(null)
  const [indicators, setIndicators] = useState([]) // [{ uid, key, params }]
  const [editing, setEditing] = useState(null) // uid whose params are being edited
  const [patterns, setPatterns] = useState([]) // active pattern keys (markers on candles)
  const [patternCode, setPatternCode] = useState({}) // key -> edited Pine (overrides default detector)
  const [codeView, setCodeView] = useState(null) // open Pine modal descriptor

  // ----- Bar replay (reveal bars one per second from a chosen date) -----
  const [replayOpen, setReplayOpen] = useState(false) // control bar visible
  const [replayOn, setReplayOn] = useState(false) // replay active (series sliced to cursor)
  const [replayCount, setReplayCount] = useState(0) // # of bars revealed (cursor = count-1)
  const [playing, setPlaying] = useState(false) // auto-advancing
  const [replaySpeed, setReplaySpeed] = useState(1) // bars per second
  const [replayDate, setReplayDate] = useState('') // chosen start date (YYYY-MM-DD)

  const addIndicator = (key) =>
    setIndicators((list) => [...list, { uid: ++uidRef.current, key, params: defaultParams(key) }])
  const removeIndicator = (uid) => {
    setIndicators((list) => list.filter((x) => x.uid !== uid))
    setEditing((e) => (e === uid ? null : e))
  }
  const updateParams = (uid, patch) =>
    setIndicators((list) =>
      list.map((x) => (x.uid === uid ? { ...x, params: { ...x.params, ...patch } } : x)),
    )

  const addPattern = (key) => setPatterns((list) => (list.includes(key) ? list : [...list, key]))
  const removePattern = (key) => setPatterns((list) => list.filter((k) => k !== key))

  // Apply edited Pine to a pattern: validate it, store as an override, and make
  // sure it's shown. Returns an error string (displayed in the modal) or null.
  const applyPatternCode = (key, code) => {
    const { error } = evalPine(code, seriesRef.current)
    if (error) return error
    setPatternCode((m) => ({ ...m, [key]: code }))
    setPatterns((list) => (list.includes(key) ? list : [...list, key]))
    return null
  }
  const resetPatternCode = (key) =>
    setPatternCode((m) => {
      const next = { ...m }
      delete next[key]
      return next
    })

  // Open the Pine-script modal. Patterns are editable (Apply redraws markers);
  // indicators are read-only.
  const viewCode = (kind, key) => {
    if (kind === 'pattern') {
      const p = PATTERN_BY_KEY[key]
      setCodeView({
        kind: 'pattern',
        key,
        editable: true,
        title: p?.name || key,
        subtitle: p?.type,
        code: patternCode[key] || PATTERN_PINE[key],
        defaultCode: PATTERN_PINE[key],
      })
    } else {
      const d = INDICATORS[key]
      setCodeView({ kind: 'indicator', editable: false, title: d?.name || key, subtitle: d?.category, code: INDICATOR_PINE[key] })
    }
  }

  // Stack the candle pane (top) above the OI pane and any oscillator panes.
  const relayout = (oscCount) => {
    const chart = chartRef.current
    if (!chart || !candleRef.current) return
    const n = oscCount + 1 // oscillators + the OI pane
    const paneH = Math.min(0.2, 0.62 / n)
    const bottomTotal = n * paneH
    const startY = 1 - bottomTotal
    candleRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: bottomTotal + 0.04 } })
    for (let i = 0; i < oscCount; i++) {
      chart.priceScale(`osc${i}`).applyOptions({
        scaleMargins: { top: startY + i * paneH, bottom: 1 - (startY + (i + 1) * paneH) },
      })
    }
    chart.priceScale('oi').applyOptions({ scaleMargins: { top: startY + oscCount * paneH, bottom: 0 } })
  }

  // ----- load full history (option strike, or the Nifty spot index) -----
  useEffect(() => {
    if (!spot && !selection) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const req = spot ? getSpot() : getChart(selection.expiry, selection.strike, selection.type)
    req
      .then((data) => {
        if (cancelled) return
        setRaw(data)
        setFrom('')
        setTo('')
      })
      .catch((e) => {
        if (cancelled) return
        setRaw([])
        setError(e?.response?.data?.detail || 'Failed to load chart data.')
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [selection, spot])

  // data span (for date-picker bounds)
  const span = useMemo(() => {
    if (raw.length === 0) return null
    return { min: raw[0].time, max: raw[raw.length - 1].time }
  }, [raw])

  // ----- filtered + resampled series (FULL — the complete view, pre-replay) -----
  const fullSeries = useMemo(() => {
    const fromSec = dateStrToSec(from)
    const toSec = dateStrToSec(to, true)
    const windowed = filterByRange(raw, fromSec, toSec)
    return resample(windowed, tf)
  }, [raw, tf, from, to])
  // Distinct trading days in the CURRENT resampled/filtered series (fullSeries) — the replay
  // start-day dropdown for a short-lived contract (an option), so every listed day is one that
  // actually has bars the replay can start on. (Deriving from `raw` could list a day that
  // resampling/filtering dropped, which would then silently fall back to the last bar.) Spot
  // has hundreds of days -> it keeps the native calendar instead; see REPLAY_DAY_DROPDOWN_MAX.
  const replayDays = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const c of fullSeries) {
      const d = secToDateStr(c.time)
      if (!seen.has(d)) { seen.add(d); out.push(d) }
    }
    return out
  }, [fullSeries])

  // During bar replay, reveal only the first `replayCount` bars (one more per tick) so
  // candles + every indicator/pattern (all derived from this `series`) play forward together.
  const series = useMemo(
    () =>
      replayOn ? fullSeries.slice(0, Math.max(1, Math.min(replayCount, fullSeries.length))) : fullSeries,
    [fullSeries, replayOn, replayCount],
  )
  seriesRef.current = series

  // time -> index in `series`, so the OHLC readout can show the change vs the
  // previous bar's close (TradingView-style) in O(1) on hover/replay.
  const idxByTime = useMemo(() => {
    const m = new Map()
    for (let i = 0; i < series.length; i++) m.set(series[i].time, i)
    return m
  }, [series])

  // Push the current series into the (already created) chart series.
  const paint = () => {
    if (!candleRef.current || !oiRef.current) return
    const s = seriesRef.current
    const map = new Map()
    const candles = []
    const ois = []
    for (const c of s) {
      candles.push({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })
      ois.push({ time: c.time, value: spot ? c.volume : c.oi })
      map.set(c.time, c)
    }
    candleRef.current.setData(candles)
    oiRef.current.setData(ois)
    mapRef.current = map
  }

  // ----- create chart once (container is always mounted) -----
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return

    const chart = createChart(el, {
      autoSize: false,
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        // Follow the active template theme (resolved from --opt-* CSS vars).
        background: { color: cssVar('--opt-ink', '#0a0e14') },
        textColor: cssVar('--opt-muted', '#8b9bb0'),
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        // Hide the TradingView attribution logo from the chart surface.
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: cssVar('--opt-edge', 'rgba(40,54,74,0.35)') },
        horzLines: { color: cssVar('--opt-edge', 'rgba(40,54,74,0.35)') },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#3b4d66', width: 1, style: 2, labelBackgroundColor: '#1e2a3a' },
        horzLine: { color: '#3b4d66', width: 1, style: 2, labelBackgroundColor: '#1e2a3a' },
      },
      rightPriceScale: { borderColor: cssVar('--opt-edge', '#1e2a3a') },
      timeScale: {
        borderColor: cssVar('--opt-edge', '#1e2a3a'),
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        // tickMarkType: 0=Year 1=Month 2=DayOfMonth 3=Time 4=TimeWithSeconds.
        // Show a date at day/month/year boundaries, else the intraday HH:MM.
        tickMarkFormatter: (time, tickMarkType) => {
          const d = new Date(time * 1000)
          if (tickMarkType === 0) return String(d.getUTCFullYear())
          if (tickMarkType <= 2) return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`
          return fmtTimeUTC(time)
        },
      },
      localization: {
        timeFormatter: (time) => `${fmtDateUTC(time)}  ${fmtTimeUTC(time)}`,
      },
    })

    const candle = chart.addCandlestickSeries({
      upColor: '#16a34a',
      downColor: '#dc2626',
      borderUpColor: '#16a34a',
      borderDownColor: '#dc2626',
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626',
      priceLineVisible: false,
      lastValueVisible: true,
    })
    // Bottom pane: open interest (options) or traded volume (spot index).
    const oi = spot
      ? chart.addHistogramSeries({
          priceScaleId: 'oi',
          color: 'rgba(96,165,250,0.55)',
          priceFormat: { type: 'volume' },
          priceLineVisible: false,
          lastValueVisible: true,
        })
      : chart.addLineSeries({
          priceScaleId: 'oi',
          color: '#eab308',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
        })
    chart.priceScale('oi').applyOptions({ borderColor: '#1e2a3a' })

    chart.subscribeCrosshairMove((param) => {
      if (
        !param.time ||
        !param.point ||
        param.point.x < 0 ||
        param.point.y < 0 ||
        param.point.x > el.clientWidth ||
        param.point.y > el.clientHeight
      ) {
        setTip(null)
        return
      }
      const c = mapRef.current.get(param.time)
      if (!c) {
        setTip(null)
        return
      }
      // pull each indicator's value(s) at the hovered bar from seriesData
      const inds = []
      for (const meta of indSeriesRef.current.values()) {
        const values = meta.plots.map((p) => {
          const d = param.seriesData.get(p.series)
          return d && d.value != null ? d.value : null
        })
        if (values.some((v) => v != null)) inds.push({ label: meta.label, color: meta.color, values })
      }
      setTip({ x: param.point.x, y: param.point.y, c, inds })
    })

    chartRef.current = chart
    candleRef.current = candle
    oiRef.current = oi
    relayout(0)

    // Paint whatever data already exists (handles StrictMode re-mount, where the
    // [series] effect won't re-fire because `series` is unchanged).
    paint()
    if (seriesRef.current.length) chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)

    // Re-skin the canvas when the template theme changes.
    const stopTheme = onThemeChange(() => chart.applyOptions(chartThemeOptions()))

    return () => {
      ro.disconnect()
      stopTheme()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      oiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----- repaint whenever the computed series changes -----
  // Non-replay changes (instrument / timeframe / date-range) re-fit. During replay we must
  // NOT re-fit or force a fixed window every tick — that throws away the user's zoom/pan.
  // setData() preserves the current visible logical range, so we only AUTO-FOLLOW the new
  // bar when the user is already at the right edge (TradingView-style); if they've zoomed or
  // panned back, we leave their view exactly where it is.
  useEffect(() => {
    const chart = chartRef.current
    // Read the pre-repaint view (still showing the OLD data) to decide whether to follow.
    const justStarted = replayOn && !prevReplayOnRef.current
    let r0 = null
    let following = false
    if (chart && replayOn && !justStarted && prevLenRef.current > 0) {
      r0 = chart.timeScale().getVisibleLogicalRange()
      if (r0) following = r0.to >= prevLenRef.current - 2 // right edge at/near the last revealed bar
    }

    paint() // setData(new slice) — preserves the visible logical range
    setTip(null)

    if (chart && series.length) {
      if (!replayOn) {
        chart.timeScale().fitContent()
      } else if (justStarted) {
        // position the initial replay window (keep the user's pre-replay zoom width)
        const W = replayWinRef.current || 150
        try {
          chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, series.length - W), to: series.length + 1 })
        } catch {
          chart.timeScale().fitContent()
        }
      } else if (following && r0) {
        // SHIFT the existing view right by the number of new bars — preserves the EXACT
        // zoom width AND position, just follows the new bar(s). No re-fit, no growth, so
        // pausing then resuming continues from the exact same view.
        const delta = series.length - prevLenRef.current
        if (delta !== 0) {
          try {
            chart.timeScale().setVisibleLogicalRange({ from: r0.from + delta, to: r0.to + delta })
          } catch {}
        }
      }
      // replay tick + user scrolled/zoomed away -> do nothing; their view is preserved.
    }
    prevLenRef.current = series.length
    prevReplayOnRef.current = replayOn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, replayOn])

  // ----- bar-replay auto-advance (reveal +1 bar every 1000/speed ms) -----
  useEffect(() => {
    if (!replayOn || !playing) return
    if (replayCount >= fullSeries.length) {
      setPlaying(false)
      return
    }
    const ms = 1000 / Math.max(0.25, replaySpeed)
    const id = setTimeout(() => setReplayCount((c) => Math.min(c + 1, fullSeries.length)), ms)
    return () => clearTimeout(id)
  }, [replayOn, playing, replayCount, replaySpeed, fullSeries.length])

  // Leave replay whenever the underlying data changes (instrument / timeframe / date range).
  useEffect(() => {
    setReplayOn(false)
    setPlaying(false)
  }, [raw, tf, from, to])

  // Seed the replay start day to the first available trading day, so the picker OPENS on the
  // data. (An empty value would open the native calendar on today — an all-disabled month for a
  // contract that expired weeks ago, reading as "can't pick a date".) Keep the user's own pick
  // only if it's still one of the available days, so the <select> value is always a real option.
  useEffect(() => {
    setReplayDate((d) => (d && replayDays.includes(d) ? d : replayDays[0] || ''))
  }, [replayDays])

  const startReplay = () => {
    const n = fullSeries.length
    if (n < 2) return
    // Default to ~40% in so there's history to the left; jump to the chosen date if given,
    // clamping to the nearest available bar (a date before/after the data -> first/last bar,
    // never a silent fallback).
    let start = Math.floor(n * 0.4)
    if (replayDate) {
      const sec = dateStrToSec(replayDate)
      const idx = fullSeries.findIndex((c) => c.time >= sec)
      start = idx >= 0 ? idx : n - 1 // date past the data -> last bar
    }
    start = Math.max(1, Math.min(start, n - 1))
    // Reflect the bar we actually landed on back into the picker, so a weekend/holiday pick on
    // the spot calendar (which maps to the next trading day) never disagrees with the UI.
    const actualDay = secToDateStr(fullSeries[start].time)
    if (actualDay !== replayDate) setReplayDate(actualDay)
    // Preserve the user's current zoom as the replay window width.
    try {
      const r = chartRef.current?.timeScale().getVisibleLogicalRange()
      replayWinRef.current = r ? Math.max(20, Math.round(r.to - r.from)) : 150
    } catch {
      replayWinRef.current = 150
    }
    setReplayOn(true)
    // `start` is the landed bar's index; count = index + 1 so that bar itself is revealed.
    setReplayCount(Math.min(start + 1, n))
    setPlaying(true)
  }
  const exitReplay = () => {
    setPlaying(false)
    setReplayOn(false)
  }
  const stepReplay = (d) => setReplayCount((c) => Math.max(1, Math.min(c + d, fullSeries.length)))

  // ----- (re)build indicator series whenever indicators or the candle data change -----
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    // tear down previous indicator series
    for (const meta of indSeriesRef.current.values()) {
      for (const item of meta.plots) {
        try {
          chart.removeSeries(item.series)
        } catch {
          /* chart already disposed */
        }
      }
    }
    indSeriesRef.current.clear()

    const candles = seriesRef.current
    const oscillators = indicators.filter((ind) => INDICATORS[ind.key] && !INDICATORS[ind.key].overlay)
    const oscScale = new Map()
    oscillators.forEach((ind, i) => oscScale.set(ind.uid, `osc${i}`))

    for (const ind of indicators) {
      const def = INDICATORS[ind.key]
      if (!def || def.disabled) continue
      let plots = []
      try {
        plots = def.compute(candles, ind.params)
      } catch {
        plots = []
      }
      const scaleId = def.overlay ? 'right' : oscScale.get(ind.uid)
      const created = []
      for (const plot of plots) {
        const s =
          plot.kind === 'histogram'
            ? chart.addHistogramSeries({ priceScaleId: scaleId, priceLineVisible: false, lastValueVisible: false })
            : chart.addLineSeries({
                priceScaleId: scaleId,
                color: plot.color,
                lineWidth: plot.lineWidth ?? 2,
                lineStyle: plot.lineStyle ?? 0,
                lineType: plot.stepped ? 1 : 0,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
              })
        s.setData(plot.data)
        created.push({ series: s, id: plot.id, color: plot.color })
      }
      if (!def.overlay && def.refs && created[0]) {
        for (const r of def.refs) {
          try {
            created[0].series.createPriceLine({ price: r.value, color: r.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
          } catch {
            /* ignore */
          }
        }
      }
      indSeriesRef.current.set(ind.uid, {
        label: def.label ? def.label(ind.params) : def.name,
        color: plots[0]?.color || '#94a3b8',
        plots: created,
      })
    }

    relayout(oscillators.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, indicators])

  // ----- candlestick-pattern markers on the price series -----
  // A pattern with edited Pine (patternCode) is detected by running that script
  // through the Pine evaluator; otherwise the built-in JS detector is used.
  useEffect(() => {
    if (!candleRef.current) return
    const candles = seriesRef.current
    const all = []
    for (const key of patterns) {
      const code = patternCode[key]
      if (code) {
        all.push(...evalPine(code, candles).markers)
      } else {
        const p = PATTERN_BY_KEY[key]
        if (p) all.push(...detectPattern(p, candles))
      }
    }
    all.sort((a, b) => a.time - b.time)
    try {
      candleRef.current.setMarkers(all)
    } catch {
      /* chart disposed mid-update */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, patterns, patternCode])

  const hasSelection = !!selection
  const ready = spot || hasSelection

  return (
    <div className="flex h-full flex-col">
      {/* Header bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge bg-panel px-4 py-2">
        <div className="text-sm font-semibold text-slate-100">
          {spot ? (
            <>
              <span className="text-base">NIFTY</span>{' '}
              <span className="text-emerald-400">Spot</span>
              <span className="ml-2 text-xs font-normal text-slate-500">Index · 1-min source</span>
            </>
          ) : hasSelection ? (
            <>
              <span className="text-base">{selection.strike}</span>{' '}
              <span className={selection.type === 'CE' ? 'text-sky-400' : 'text-orange-400'}>
                {selection.type}
              </span>
              <span className="ml-2 text-xs font-normal text-slate-500">
                Expiry: {expiryLabel(selection.expiry)}
              </span>
            </>
          ) : (
            <span className="text-slate-500">Select a strike to load its chart</span>
          )}
        </div>

        {ready && (
          <>
            {/* Timeframe toggle */}
            <div className="flex overflow-hidden rounded-md border border-edge">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t}
                  onClick={() => setTf(t)}
                  className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                    tf === t
                      ? 'bg-sky-600 text-white'
                      : 'bg-panel2 text-slate-400 hover:bg-edge hover:text-slate-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Custom timeframe: type minutes (e.g. 7) + Enter -> resamples to 7m */}
            <input
              type="text"
              inputMode="numeric"
              value={customTf}
              onChange={(e) => setCustomTf(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && customTf && setTf(`${customTf}m`)}
              onBlur={() => customTf && setTf(`${customTf}m`)}
              placeholder="min"
              title="Custom timeframe in minutes — type a number and press Enter"
              className={`w-16 rounded border px-2 py-1 text-center text-xs outline-none transition-colors ${
                customTf && tf === `${customTf}m`
                  ? 'border-sky-600 bg-sky-600/20 text-sky-200'
                  : 'border-edge bg-panel2 text-slate-300 placeholder:text-slate-500 focus:border-sky-600'
              }`}
            />

            <IndicatorMenu onAdd={addIndicator} onAddPattern={addPattern} onViewCode={viewCode} />

            {/* Date range */}
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>From</span>
              <input
                type="date"
                value={from}
                min={span ? secToDateStr(span.min) : undefined}
                max={to || (span ? secToDateStr(span.max) : undefined)}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded border border-edge bg-panel2 px-2 py-1 text-slate-200 outline-none focus:border-sky-600"
              />
              <span>To</span>
              <input
                type="date"
                value={to}
                min={from || (span ? secToDateStr(span.min) : undefined)}
                max={span ? secToDateStr(span.max) : undefined}
                onChange={(e) => setTo(e.target.value)}
                className="rounded border border-edge bg-panel2 px-2 py-1 text-slate-200 outline-none focus:border-sky-600"
              />
            </div>

            <button
              onClick={() => {
                setFrom('')
                setTo('')
              }}
              className="rounded-md border border-edge bg-panel2 px-3 py-1 text-xs text-slate-300 hover:bg-edge hover:text-white"
            >
              Reset
            </button>

            <button
              onClick={() => setReplayOpen((v) => !v)}
              title="Bar replay — reveal bars one per second from a chosen date"
              className={`rounded-md border px-3 py-1 text-xs transition-colors ${
                replayOpen || replayOn
                  ? 'border-sky-600 bg-sky-600/20 text-sky-200'
                  : 'border-edge bg-panel2 text-slate-300 hover:bg-edge hover:text-white'
              }`}
            >
              ▶ Replay{replayOn ? ' · ON' : ''}
            </button>

            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-slate-500">
                {series.length.toLocaleString()} bars
              </span>
              {onClose && (
                <button
                  onClick={onClose}
                  title="Close chart (maximize chain)"
                  className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-edge hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Bar-replay control bar */}
      {ready && replayOpen && (
        <div className="flex flex-wrap items-center gap-3 border-b border-edge bg-panel2/60 px-4 py-2 text-xs">
          {!replayOn ? (
            <>
              <span className="font-semibold text-sky-300">Bar Replay</span>
              <div className="flex items-center gap-1.5 text-slate-400">
                <span>Start day</span>
                {replayDays.length > 0 && replayDays.length <= REPLAY_DAY_DROPDOWN_MAX ? (
                  // Short-lived contract (an option): a dropdown of the days it actually
                  // traded, so every choice is valid — no calendar to wander into empty years.
                  <select
                    value={replayDate}
                    onChange={(e) => setReplayDate(e.target.value)}
                    title="Replay starts on this day (only days this contract traded are listed)"
                    className="rounded border border-edge bg-panel px-2 py-1 font-mono text-slate-200 outline-none focus:border-sky-600"
                  >
                    {replayDays.map((d) => (
                      <option key={d} value={d}>{fmtReplayDate(d)}</option>
                    ))}
                  </select>
                ) : (
                  // Long history (the spot index): a native calendar bounded to the data.
                  <input
                    type="date"
                    value={replayDate}
                    min={span ? secToDateStr(span.min) : undefined}
                    max={span ? secToDateStr(span.max) : undefined}
                    onChange={(e) => setReplayDate(e.target.value)}
                    title="Replay start date"
                    className="rounded border border-edge bg-panel px-2 py-1 text-slate-200 outline-none focus:border-sky-600"
                  />
                )}
              </div>
              <SpeedPicker value={replaySpeed} onChange={setReplaySpeed} />
              <button
                onClick={startReplay}
                className="rounded-md bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-500"
              >
                ▶ Start ({tf})
              </button>
              <span className="text-slate-500">Reveals 1 bar/sec from the chosen date.</span>
            </>
          ) : (
            <>
              <span className="font-semibold text-sky-300">REPLAY</span>
              <button onClick={() => stepReplay(-1)} title="Step back" className={replayBtn}>
                ⏮
              </button>
              <button onClick={() => setPlaying((p) => !p)} className={replayBtn}>
                {playing ? '⏸ Pause' : '▶ Play'}
              </button>
              <button onClick={() => stepReplay(1)} title="Step forward" className={replayBtn}>
                ⏭
              </button>
              <SpeedPicker value={replaySpeed} onChange={setReplaySpeed} />
              <span className="font-mono text-slate-400 tabular-nums">
                bar {replayCount.toLocaleString()} / {fullSeries.length.toLocaleString()}
                {series.length > 0
                  ? ` · ${fmtDateUTC(series[series.length - 1].time)} ${fmtTimeUTC(series[series.length - 1].time)}`
                  : ''}
              </span>
              <button
                onClick={exitReplay}
                className="ml-auto rounded-md border border-edge px-3 py-1 text-slate-300 hover:bg-edge hover:text-white"
              >
                ✕ Exit
              </button>
            </>
          )}
        </div>
      )}

      {/* Chart area — container is ALWAYS mounted so the chart can be created up front */}
      <div className="relative min-h-0 flex-1">
        <div ref={wrapRef} className="absolute inset-0" />

        {ready ? (
          <>
            <div className="pointer-events-none absolute left-3 top-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              Price
            </div>
            <div
              className={`pointer-events-none absolute bottom-12 left-3 text-[10px] font-semibold uppercase tracking-wider ${
                spot ? 'text-sky-600/80' : 'text-yellow-600/80'
              }`}
            >
              {spot ? 'Volume' : 'Open Interest'}
            </div>
          </>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-600">
            Click a CALL or PUT cell above, or use the search bar.
          </div>
        )}

        {/* Active indicator + pattern legend (with inline param editing) */}
        {ready && (indicators.length > 0 || patterns.length > 0) && (
          <div className="absolute left-3 top-7 z-10 flex max-w-[70%] flex-col gap-1">
            {indicators.map((ind) => {
              const def = INDICATORS[ind.key]
              if (!def) return null
              return (
                <div key={ind.uid} className="w-fit rounded bg-panel2/85 px-1.5 py-0.5 text-[11px] shadow shadow-black/30 backdrop-blur">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-slate-200">
                      {def.label ? def.label(ind.params) : def.name}
                    </span>
                    <button
                      onClick={() => viewCode('indicator', ind.key)}
                      title="View Pine Script"
                      className="font-mono text-[10px] leading-none text-slate-500 hover:text-sky-300"
                    >
                      {'{ }'}
                    </button>
                    {def.params?.length > 0 && (
                      <button
                        onClick={() => setEditing((e) => (e === ind.uid ? null : ind.uid))}
                        title="Settings"
                        className="text-slate-500 hover:text-sky-300"
                      >
                        ⚙
                      </button>
                    )}
                    <button
                      onClick={() => removeIndicator(ind.uid)}
                      title="Remove indicator"
                      className="text-slate-500 hover:text-red-400"
                    >
                      ✕
                    </button>
                  </div>
                  {editing === ind.uid && def.params?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-2 border-t border-edge pt-1">
                      {def.params.map((pp) => (
                        <label key={pp.key} className="flex items-center gap-1 text-[10px] text-slate-400">
                          {pp.label}
                          <input
                            type="number"
                            value={ind.params[pp.key]}
                            min={pp.min}
                            max={pp.max}
                            step={pp.step}
                            onChange={(e) => updateParams(ind.uid, { [pp.key]: Number(e.target.value) })}
                            className="w-14 rounded border border-edge bg-panel px-1 py-0.5 text-slate-200 outline-none focus:border-sky-600"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {patterns.map((key) => {
              const p = PATTERN_BY_KEY[key]
              if (!p) return null
              const col = p.dir === 'bull' ? '#22c55e' : p.dir === 'bear' ? '#ef4444' : 'var(--opt-faint)'
              return (
                <div key={key} className="w-fit rounded bg-panel2/85 px-1.5 py-0.5 text-[11px] shadow shadow-black/30 backdrop-blur">
                  <div className="flex items-center gap-1.5">
                    <span style={{ color: col }}>◆</span>
                    <span className="font-medium text-slate-200">{p.name}</span>
                    {patternCode[key] && (
                      <span title="Custom Pine applied" className="text-[10px] leading-none text-sky-400">
                        ✎
                      </span>
                    )}
                    <button
                      onClick={() => viewCode('pattern', key)}
                      title="View / edit Pine Script"
                      className="font-mono text-[10px] leading-none text-slate-500 hover:text-sky-300"
                    >
                      {'{ }'}
                    </button>
                    <button
                      onClick={() => removePattern(key)}
                      title="Remove pattern"
                      className="text-slate-500 hover:text-red-400"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/60 text-sm text-slate-300">
            Loading full history…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-red-400">
            {error}
          </div>
        )}

        {/* OHLC readout — TradingView-style single inline line, pinned top-right INSIDE the
            chart box (offset to clear the ~80px price axis), borderless with a text-shadow so
            it reads over candles. Defaults to the latest bar (the last REVEALED bar during
            replay, since `series` is already sliced to replayCount); follows the crosshair on
            hover and then also shows that bar's indicator values. */}
        {(() => {
          const c = tip?.c ?? (series.length ? series[series.length - 1] : null)
          if (!c) return null
          const inds = tip?.inds ?? []
          const idx = idxByTime.get(c.time)
          const prev = idx != null && idx > 0 ? series[idx - 1] : null
          const base = prev ? prev.close : c.open // change vs previous close (fallback: this bar's open)
          const chg = c.close - base
          const pct = base ? (chg / base) * 100 : 0
          const sign = (n) => (n >= 0 ? '+' : '')
          const green = 'text-green-400'
          const red = 'text-red-400'
          // A bar's `time` is its bucket START; on any aggregated intraday timeframe its
          // CLOSE (C) is the price at the bucket's END, not at the label minute. Show the
          // full span (e.g. 09:45–09:50) so the readout can't be misread as a 09:45 print —
          // this is exactly why the 5m "09:45" close (135.65) differs from the option
          // chain's 1-min 09:45 LTP (118.55). Clamp the end to the 15:30 session close so a
          // folded last bar never labels past the session.
          const stepSec = tfToSeconds(tf)
          let spanEndSec = null
          if (stepSec > 60 && stepSec < 86400) {
            const sessionClose = Math.floor(c.time / 86400) * 86400 + 15 * 3600 + 30 * 60
            spanEndSec = Math.min(c.time + stepSec, sessionClose)
          }
          return (
            <div className="pointer-events-none absolute right-[84px] top-2 z-20 flex max-w-[calc(100%-96px)] flex-col items-end gap-y-0.5 font-mono text-[11px] leading-tight tabular-nums [text-shadow:0_1px_4px_rgba(0,0,0,0.95)]">
              <span className="text-[10px] text-slate-400">
                {fmtDateUTC(c.time)} {fmtTimeUTC(c.time)}
                {spanEndSec != null && (
                  <span className="text-slate-500">–{fmtTimeUTC(spanEndSec)}</span>
                )}
              </span>
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5">
                <span className="text-slate-500">O <span className="text-slate-200">{c.open.toFixed(2)}</span></span>
                <span className="text-slate-500">H <span className={green}>{c.high.toFixed(2)}</span></span>
                <span className="text-slate-500">L <span className={red}>{c.low.toFixed(2)}</span></span>
                <span className="text-slate-500">C <span className={c.close >= c.open ? green : red}>{c.close.toFixed(2)}</span></span>
                <span className={chg >= 0 ? green : red}>
                  {sign(chg)}{chg.toFixed(2)} ({sign(chg)}{pct.toFixed(2)}%)
                </span>
                <span className="text-slate-500">Vol <span className={spot ? 'text-sky-300' : 'text-slate-200'}>{compact.format(c.volume)}</span></span>
                {!spot && <span className="text-slate-500">OI <span className="text-yellow-400">{compact.format(c.oi)}</span></span>}
              </div>
              {inds.length > 0 && (
                <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5">
                  {inds.map((ind, i) => (
                    <span key={i} className="flex items-center gap-1 whitespace-nowrap">
                      <span style={{ color: ind.color }}>{ind.label}</span>
                      <span className="text-slate-200">{ind.values.map((v) => (v == null ? '–' : fmtVal(v))).join(' ')}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {codeView && (
        <CodeModal
          title={codeView.title}
          subtitle={codeView.subtitle}
          code={codeView.code}
          defaultCode={codeView.defaultCode}
          editable={codeView.editable}
          onApply={codeView.editable ? (txt) => applyPatternCode(codeView.key, txt) : undefined}
          onReset={codeView.editable ? () => resetPatternCode(codeView.key) : undefined}
          onClose={() => setCodeView(null)}
        />
      )}
    </div>
  )
}

const REPLAY_SPEEDS = [0.5, 1, 2, 4, 10]
function SpeedPicker({ value, onChange }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-edge" title="Replay speed (bars per second)">
      {REPLAY_SPEEDS.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={`px-2 py-1 text-xs ${
            value === s ? 'bg-sky-600 text-white' : 'bg-panel2 text-slate-400 hover:bg-edge hover:text-slate-200'
          }`}
        >
          {s}×
        </button>
      ))}
    </div>
  )
}
