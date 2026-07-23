// Technical-indicator engine.
//
// Each candle: { time, open, high, low, close, volume, oi }.
// An indicator definition declares:
//   key, name, category, overlay (price pane vs own oscillator pane),
//   params: [{ key, label, default, min, max, step }],
//   refs?: [{ value, color }]   reference levels drawn in the oscillator pane,
//   label(p): short legend text,
//   compute(candles, p): array of plots.
// A plot: { id, kind:'line'|'histogram', color, lineWidth?, lineStyle?, data:[{time,value[,color]}] }
//
// Indicators marked { disabled: '<reason>' } appear greyed in the menu.

export const CATEGORIES = [
  'Trend',
  'Momentum',
  'Volatility',
  'Volume',
  'Bar Statistics',
  'Support/Resistance & Other',
]

// ---------------------------------------------------------------- math helpers
const SMA = (src, n) => {
  const out = new Array(src.length).fill(null)
  let sum = 0
  let count = 0
  for (let i = 0; i < src.length; i++) {
    const v = src[i]
    if (v == null) {
      out[i] = null
      continue
    }
    sum += v
    count++
    if (i >= n && src[i - n] != null) {
      sum -= src[i - n]
      count--
    }
    if (count === n) out[i] = sum / n
  }
  return out
}

// EMA seeded with the first available value (robust to leading nulls).
const EMA = (src, n) => {
  const out = new Array(src.length).fill(null)
  const k = 2 / (n + 1)
  let prev = null
  for (let i = 0; i < src.length; i++) {
    const v = src[i]
    if (v == null) {
      out[i] = prev
      continue
    }
    prev = prev == null ? v : v * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

// Wilder's smoothing (a.k.a. RMA / SMMA), seeded with SMA of the first n values.
const RMA = (src, n) => {
  const out = new Array(src.length).fill(null)
  let prev = null
  let sum = 0
  let count = 0
  for (let i = 0; i < src.length; i++) {
    const v = src[i]
    if (v == null) {
      out[i] = prev
      continue
    }
    if (prev == null) {
      sum += v
      count++
      if (count === n) {
        prev = sum / n
        out[i] = prev
      }
    } else {
      prev = (prev * (n - 1) + v) / n
      out[i] = prev
    }
  }
  return out
}

const WMA = (src, n) => {
  const out = new Array(src.length).fill(null)
  const denom = (n * (n + 1)) / 2
  for (let i = n - 1; i < src.length; i++) {
    let s = 0
    let ok = true
    for (let j = 0; j < n; j++) {
      const v = src[i - j]
      if (v == null) {
        ok = false
        break
      }
      s += v * (n - j)
    }
    out[i] = ok ? s / denom : null
  }
  return out
}

const HMA = (src, n) => {
  const half = Math.max(1, Math.floor(n / 2))
  const sq = Math.max(1, Math.round(Math.sqrt(n)))
  const wH = WMA(src, half)
  const wF = WMA(src, n)
  const diff = src.map((_, i) =>
    wH[i] == null || wF[i] == null ? null : 2 * wH[i] - wF[i],
  )
  return WMA(diff, sq)
}

const STDEV = (src, n) => {
  const out = new Array(src.length).fill(null)
  for (let i = n - 1; i < src.length; i++) {
    let sum = 0
    let ok = true
    for (let j = 0; j < n; j++) {
      if (src[i - j] == null) {
        ok = false
        break
      }
      sum += src[i - j]
    }
    if (!ok) continue
    const mean = sum / n
    let sq = 0
    for (let j = 0; j < n; j++) sq += (src[i - j] - mean) ** 2
    out[i] = Math.sqrt(sq / n)
  }
  return out
}

const HIGHEST = (src, n) => {
  const out = new Array(src.length).fill(null)
  for (let i = n - 1; i < src.length; i++) {
    let m = -Infinity
    for (let j = 0; j < n; j++) m = Math.max(m, src[i - j])
    out[i] = m
  }
  return out
}

const LOWEST = (src, n) => {
  const out = new Array(src.length).fill(null)
  for (let i = n - 1; i < src.length; i++) {
    let m = Infinity
    for (let j = 0; j < n; j++) m = Math.min(m, src[i - j])
    out[i] = m
  }
  return out
}

const trueRange = (c) =>
  c.map((x, i) => {
    if (i === 0) return x.high - x.low
    const pc = c[i - 1].close
    return Math.max(x.high - x.low, Math.abs(x.high - pc), Math.abs(x.low - pc))
  })

const closes = (c) => c.map((x) => x.close)
const highs = (c) => c.map((x) => x.high)
const lows = (c) => c.map((x) => x.low)
const typical = (c) => c.map((x) => (x.high + x.low + x.close) / 3)

// Turn an aligned value array into lightweight-charts line data (drops nulls).
const line = (candles, arr, id, color, opts = {}) => ({
  id,
  kind: 'line',
  color,
  lineWidth: opts.lineWidth ?? 2,
  lineStyle: opts.lineStyle ?? 0,
  data: candles.reduce((acc, c, i) => {
    if (arr[i] != null && Number.isFinite(arr[i])) acc.push({ time: c.time, value: arr[i] })
    return acc
  }, []),
})

// ---------------------------------------------------------------- palette
const C = {
  blue: '#3b82f6',
  sky: '#38bdf8',
  amber: '#f59e0b',
  orange: '#fb923c',
  green: '#22c55e',
  red: '#ef4444',
  purple: '#a78bfa',
  pink: '#ec4899',
  teal: '#2dd4bf',
  gray: '#94a3b8',
  yellow: '#eab308',
}

const len = (def = 20) => ({ key: 'length', label: 'Length', default: def, min: 1, max: 500, step: 1 })

// ---------------------------------------------------------------- registry
// Order within each category drives the menu listing.
export const INDICATORS = {
  // ---- Bar Statistics (per-candle price derivations, no params) ----
  typicalbar: {
    key: 'typicalbar', name: 'Typical Bar Average (HLC/3)', category: 'Bar Statistics', overlay: true,
    params: [], label: () => 'Typical (HLC/3)',
    compute: (c) => [line(c, c.map((x) => (x.high + x.low + x.close) / 3), 'typicalbar', C.blue)],
  },
  bodyavg: {
    key: 'bodyavg', name: 'Body Average ((O-C)/2)', category: 'Bar Statistics', overlay: false,
    params: [], refs: [{ value: 0, color: '#475569' }], label: () => 'Body (O-C)/2',
    compute: (c) => [line(c, c.map((x) => (x.open - x.close) / 2), 'bodyavg', C.pink)],
  },
  rangeavg: {
    key: 'rangeavg', name: 'Range Average ((H-L)/2)', category: 'Bar Statistics', overlay: false,
    params: [], label: () => 'Range (H-L)/2',
    compute: (c) => [line(c, c.map((x) => (x.high - x.low) / 2), 'rangeavg', C.teal)],
  },
  // ---- Trend ----
  sma: {
    key: 'sma', name: 'Simple Moving Average (SMA)', category: 'Trend', overlay: true,
    params: [len(20)], label: (p) => `SMA ${p.length}`,
    compute: (c, p) => [line(c, SMA(closes(c), p.length), 'sma', C.blue)],
  },
  ema: {
    key: 'ema', name: 'Exponential Moving Average (EMA)', category: 'Trend', overlay: true,
    params: [len(20)], label: (p) => `EMA ${p.length}`,
    compute: (c, p) => [line(c, EMA(closes(c), p.length), 'ema', C.amber)],
  },
  wma: {
    key: 'wma', name: 'Weighted Moving Average (WMA)', category: 'Trend', overlay: true,
    params: [len(20)], label: (p) => `WMA ${p.length}`,
    compute: (c, p) => [line(c, WMA(closes(c), p.length), 'wma', C.teal)],
  },
  smma: {
    key: 'smma', name: 'Smoothed Moving Average (SMMA)', category: 'Trend', overlay: true,
    params: [len(20)], label: (p) => `SMMA ${p.length}`,
    compute: (c, p) => [line(c, RMA(closes(c), p.length), 'smma', C.purple)],
  },
  lwma: {
    key: 'lwma', name: 'Linear Weighted Moving Average', category: 'Trend', overlay: true,
    params: [len(20)], label: (p) => `LWMA ${p.length}`,
    compute: (c, p) => [line(c, WMA(closes(c), p.length), 'lwma', C.pink)],
  },
  hma: {
    key: 'hma', name: 'Hull Moving Average (HMA)', category: 'Trend', overlay: true,
    params: [len(16)], label: (p) => `HMA ${p.length}`,
    compute: (c, p) => [line(c, HMA(closes(c), p.length), 'hma', C.green)],
  },
  donchian: {
    key: 'donchian', name: 'Donchian Channels', category: 'Trend', overlay: true,
    params: [len(20)], label: (p) => `Donchian ${p.length}`,
    compute: (c, p) => {
      const u = HIGHEST(highs(c), p.length)
      const l = LOWEST(lows(c), p.length)
      const m = u.map((v, i) => (v == null || l[i] == null ? null : (v + l[i]) / 2))
      return [
        line(c, u, 'up', C.sky, { lineWidth: 1 }),
        line(c, m, 'mid', C.gray, { lineWidth: 1, lineStyle: 2 }),
        line(c, l, 'low', C.sky, { lineWidth: 1 }),
      ]
    },
  },
  supertrend: {
    key: 'supertrend', name: 'Supertrend', category: 'Trend', overlay: true,
    params: [
      { key: 'atr', label: 'ATR', default: 10, min: 1, max: 100, step: 1 },
      { key: 'mult', label: 'Mult', default: 3, min: 0.5, max: 10, step: 0.1 },
    ],
    label: (p) => `Supertrend ${p.atr},${p.mult}`,
    compute: (c, p) => {
      const atr = RMA(trueRange(c), p.atr)
      const n = c.length
      const st = new Array(n).fill(null) // supertrend value (active band) per bar
      const up = new Array(n).fill(false) // trend direction per bar
      let fu = null
      let fl = null
      let trend = true
      let started = false
      for (let i = 0; i < n; i++) {
        if (atr[i] == null) continue
        const hl2 = (c[i].high + c[i].low) / 2
        const bu = hl2 + p.mult * atr[i]
        const bl = hl2 - p.mult * atr[i]
        const pc = i > 0 ? c[i - 1].close : c[i].close
        fu = !started || bu < fu || pc > fu ? bu : fu
        fl = !started || bl > fl || pc < fl ? bl : fl
        if (!started) {
          trend = c[i].close >= bl
          started = true
        } else if (trend && c[i].close < fl) {
          trend = false
        } else if (!trend && c[i].close > fu) {
          trend = true
        }
        st[i] = trend ? fl : fu
        up[i] = trend
      }
      // ONE continuous line, coloured per point. In lightweight-charts v4 the line
      // renderer strokes each segment with its LEFT point's colour, so we colour each
      // bar by its trend (green up / red down) and paint the single flip segment
      // TRANSPARENT — that breaks the line cleanly at every flip (the band jumps from
      // below price to above), instead of drawing a connector across the gap.
      // Whitespace does NOT break a v4 line (it draws straight through), which is why
      // the two-series approach drew long diagonals; per-point colour is the fix.
      const GAP = 'rgba(0,0,0,0)'
      const data = []
      for (let i = 0; i < n; i++) {
        if (st[i] == null) continue
        const flips = i + 1 < n && st[i + 1] != null && up[i + 1] !== up[i]
        data.push({ time: c[i].time, value: st[i], color: flips ? GAP : up[i] ? C.green : C.red })
      }
      return [{ id: 'st', kind: 'line', color: C.green, lineWidth: 2, data }]
    },
  },
  adx: {
    key: 'adx', name: 'Average Directional Index (ADX)', category: 'Trend', overlay: false,
    params: [len(14)], refs: [{ value: 25, color: '#475569' }], label: (p) => `ADX ${p.length}`,
    compute: (c, p) => {
      const n = p.length
      const tr = trueRange(c)
      const plusDM = c.map((x, i) => {
        if (i === 0) return 0
        const up = x.high - c[i - 1].high
        const dn = c[i - 1].low - x.low
        return up > dn && up > 0 ? up : 0
      })
      const minusDM = c.map((x, i) => {
        if (i === 0) return 0
        const up = x.high - c[i - 1].high
        const dn = c[i - 1].low - x.low
        return dn > up && dn > 0 ? dn : 0
      })
      const atr = RMA(tr, n)
      const pDI = RMA(plusDM, n).map((v, i) => (v == null || !atr[i] ? null : (100 * v) / atr[i]))
      const mDI = RMA(minusDM, n).map((v, i) => (v == null || !atr[i] ? null : (100 * v) / atr[i]))
      const dx = pDI.map((v, i) =>
        v == null || mDI[i] == null || v + mDI[i] === 0 ? null : (100 * Math.abs(v - mDI[i])) / (v + mDI[i]),
      )
      const adx = RMA(dx, n)
      return [
        line(c, adx, 'adx', C.yellow),
        line(c, pDI, '+di', C.green, { lineWidth: 1 }),
        line(c, mDI, '-di', C.red, { lineWidth: 1 }),
      ]
    },
  },
  trix: { key: 'trix', name: 'Trix Indicator', category: 'Trend', disabled: 'coming soon' },
  psar: { key: 'psar', name: 'Parabolic SAR', category: 'Trend', disabled: 'coming soon' },
  ichimoku: { key: 'ichimoku', name: 'Ichimoku Cloud', category: 'Trend', disabled: 'coming soon' },
  aroon: { key: 'aroon', name: 'Aroon Oscillator', category: 'Trend', disabled: 'coming soon' },
  chandelier: { key: 'chandelier', name: 'Chandelier Exit', category: 'Trend', disabled: 'coming soon' },

  // ---- Momentum ----
  rsi: {
    key: 'rsi', name: 'Relative Strength Index (RSI)', category: 'Momentum', overlay: false,
    params: [len(14)], refs: [{ value: 70, color: '#475569' }, { value: 30, color: '#475569' }],
    label: (p) => `RSI ${p.length}`,
    compute: (c, p) => {
      const cl = closes(c)
      const gain = cl.map((v, i) => (i === 0 ? null : Math.max(0, v - cl[i - 1])))
      const loss = cl.map((v, i) => (i === 0 ? null : Math.max(0, cl[i - 1] - v)))
      const ag = RMA(gain, p.length)
      const al = RMA(loss, p.length)
      const rsi = ag.map((v, i) => {
        if (v == null || al[i] == null) return null
        if (al[i] === 0) return 100
        const rs = v / al[i]
        return 100 - 100 / (1 + rs)
      })
      return [line(c, rsi, 'rsi', C.purple)]
    },
  },
  macd: {
    key: 'macd', name: 'MACD', category: 'Momentum', overlay: false,
    params: [
      { key: 'fast', label: 'Fast', default: 12, min: 1, max: 200, step: 1 },
      { key: 'slow', label: 'Slow', default: 26, min: 1, max: 400, step: 1 },
      { key: 'signal', label: 'Signal', default: 9, min: 1, max: 200, step: 1 },
    ],
    label: (p) => `MACD ${p.fast},${p.slow},${p.signal}`,
    compute: (c, p) => {
      const cl = closes(c)
      const ef = EMA(cl, p.fast)
      const es = EMA(cl, p.slow)
      const macd = ef.map((v, i) => (v == null || es[i] == null ? null : v - es[i]))
      const signal = EMA(macd, p.signal)
      const hist = macd.map((v, i) => (v == null || signal[i] == null ? null : v - signal[i]))
      return [
        {
          id: 'hist', kind: 'histogram',
          data: c.reduce((a, x, i) => {
            if (hist[i] != null) a.push({ time: x.time, value: hist[i], color: hist[i] >= 0 ? '#22c55e88' : '#ef444488' })
            return a
          }, []),
        },
        line(c, macd, 'macd', C.blue),
        line(c, signal, 'signal', C.orange, { lineWidth: 1 }),
      ]
    },
  },
  stoch: {
    key: 'stoch', name: 'Stochastic Oscillator', category: 'Momentum', overlay: false,
    params: [
      { key: 'k', label: '%K', default: 14, min: 1, max: 200, step: 1 },
      { key: 'd', label: '%D', default: 3, min: 1, max: 100, step: 1 },
      { key: 'smooth', label: 'Smooth', default: 3, min: 1, max: 100, step: 1 },
    ],
    refs: [{ value: 80, color: '#475569' }, { value: 20, color: '#475569' }],
    label: (p) => `Stoch ${p.k},${p.d},${p.smooth}`,
    compute: (c, p) => {
      const hh = HIGHEST(highs(c), p.k)
      const ll = LOWEST(lows(c), p.k)
      const rawK = c.map((x, i) =>
        hh[i] == null || ll[i] == null || hh[i] === ll[i] ? null : (100 * (x.close - ll[i])) / (hh[i] - ll[i]),
      )
      const k = SMA(rawK, p.smooth)
      const d = SMA(k, p.d)
      return [line(c, k, 'k', C.blue), line(c, d, 'd', C.orange, { lineWidth: 1 })]
    },
  },
  williams: {
    key: 'williams', name: 'Williams %R', category: 'Momentum', overlay: false,
    params: [len(14)], refs: [{ value: -20, color: '#475569' }, { value: -80, color: '#475569' }],
    label: (p) => `Williams %R ${p.length}`,
    compute: (c, p) => {
      const hh = HIGHEST(highs(c), p.length)
      const ll = LOWEST(lows(c), p.length)
      const wr = c.map((x, i) =>
        hh[i] == null || ll[i] == null || hh[i] === ll[i] ? null : (-100 * (hh[i] - x.close)) / (hh[i] - ll[i]),
      )
      return [line(c, wr, 'wr', C.pink)]
    },
  },
  roc: {
    key: 'roc', name: 'Momentum (Rate of Change)', category: 'Momentum', overlay: false,
    params: [len(10)], refs: [{ value: 0, color: '#475569' }], label: (p) => `ROC ${p.length}`,
    compute: (c, p) => {
      const cl = closes(c)
      const roc = cl.map((v, i) => (i < p.length || !cl[i - p.length] ? null : (100 * (v - cl[i - p.length])) / cl[i - p.length]))
      return [line(c, roc, 'roc', C.teal)]
    },
  },
  cci: {
    key: 'cci', name: 'Commodity Channel Index (CCI)', category: 'Momentum', overlay: false,
    params: [len(20)], refs: [{ value: 100, color: '#475569' }, { value: -100, color: '#475569' }],
    label: (p) => `CCI ${p.length}`,
    compute: (c, p) => {
      const tp = typical(c)
      const ma = SMA(tp, p.length)
      const cci = new Array(c.length).fill(null)
      for (let i = p.length - 1; i < c.length; i++) {
        if (ma[i] == null) continue
        let md = 0
        for (let j = 0; j < p.length; j++) md += Math.abs(tp[i - j] - ma[i])
        md /= p.length
        cci[i] = md === 0 ? 0 : (tp[i] - ma[i]) / (0.015 * md)
      }
      return [line(c, cci, 'cci', C.amber)]
    },
  },
  tsi: {
    key: 'tsi', name: 'True Strength Index (TSI)', category: 'Momentum', overlay: false,
    params: [
      { key: 'long', label: 'Long', default: 25, min: 1, max: 200, step: 1 },
      { key: 'short', label: 'Short', default: 13, min: 1, max: 200, step: 1 },
    ],
    refs: [{ value: 0, color: '#475569' }], label: (p) => `TSI ${p.long},${p.short}`,
    compute: (c, p) => {
      const cl = closes(c)
      const mom = cl.map((v, i) => (i === 0 ? null : v - cl[i - 1]))
      const absMom = mom.map((v) => (v == null ? null : Math.abs(v)))
      const ds = EMA(EMA(mom, p.long), p.short)
      const das = EMA(EMA(absMom, p.long), p.short)
      const tsi = ds.map((v, i) => (v == null || !das[i] ? null : (100 * v) / das[i]))
      return [line(c, tsi, 'tsi', C.purple)]
    },
  },
  imi: { key: 'imi', name: 'Intraday Momentum Index (IMI)', category: 'Momentum', disabled: 'coming soon' },
  dpo: { key: 'dpo', name: 'Detrended Price Oscillator (DPO)', category: 'Momentum', disabled: 'coming soon' },
  fisher: { key: 'fisher', name: 'Fisher Transform', category: 'Momentum', disabled: 'coming soon' },
  mbo: { key: 'mbo', name: 'Motherboard Oscillator', category: 'Momentum', disabled: 'not a standard indicator' },
  vortex: { key: 'vortex', name: 'Vortex Indicator', category: 'Momentum', disabled: 'coming soon' },

  // ---- Volatility ----
  bb: {
    key: 'bb', name: 'Bollinger Bands', category: 'Volatility', overlay: true,
    params: [len(20), { key: 'mult', label: 'StdDev', default: 2, min: 0.1, max: 6, step: 0.1 }],
    label: (p) => `BB ${p.length},${p.mult}`,
    compute: (c, p) => {
      const cl = closes(c)
      const basis = SMA(cl, p.length)
      const sd = STDEV(cl, p.length)
      const up = basis.map((v, i) => (v == null || sd[i] == null ? null : v + p.mult * sd[i]))
      const lo = basis.map((v, i) => (v == null || sd[i] == null ? null : v - p.mult * sd[i]))
      return [
        line(c, up, 'up', C.sky, { lineWidth: 1 }),
        line(c, basis, 'basis', C.orange, { lineWidth: 1, lineStyle: 2 }),
        line(c, lo, 'low', C.sky, { lineWidth: 1 }),
      ]
    },
  },
  keltner: {
    key: 'keltner', name: 'Keltner Channels', category: 'Volatility', overlay: true,
    params: [len(20), { key: 'mult', label: 'Mult', default: 2, min: 0.1, max: 6, step: 0.1 }, { key: 'atr', label: 'ATR len', default: 10, min: 1, max: 200, step: 1 }],
    label: (p) => `Keltner ${p.length},${p.mult}`,
    compute: (c, p) => {
      const basis = EMA(closes(c), p.length)
      const atr = RMA(trueRange(c), p.atr)
      const up = basis.map((v, i) => (v == null || atr[i] == null ? null : v + p.mult * atr[i]))
      const lo = basis.map((v, i) => (v == null || atr[i] == null ? null : v - p.mult * atr[i]))
      return [
        line(c, up, 'up', C.teal, { lineWidth: 1 }),
        line(c, basis, 'basis', C.orange, { lineWidth: 1, lineStyle: 2 }),
        line(c, lo, 'low', C.teal, { lineWidth: 1 }),
      ]
    },
  },
  envelopes: {
    key: 'envelopes', name: 'Price Envelopes', category: 'Volatility', overlay: true,
    params: [len(20), { key: 'pct', label: 'Percent', default: 1, min: 0.1, max: 20, step: 0.1 }],
    label: (p) => `Env ${p.length},${p.pct}%`,
    compute: (c, p) => {
      const basis = SMA(closes(c), p.length)
      const up = basis.map((v) => (v == null ? null : v * (1 + p.pct / 100)))
      const lo = basis.map((v) => (v == null ? null : v * (1 - p.pct / 100)))
      return [
        line(c, up, 'up', C.gray, { lineWidth: 1 }),
        line(c, basis, 'basis', C.orange, { lineWidth: 1, lineStyle: 2 }),
        line(c, lo, 'low', C.gray, { lineWidth: 1 }),
      ]
    },
  },
  atr: {
    key: 'atr', name: 'Average True Range (ATR)', category: 'Volatility', overlay: false,
    params: [len(14)], label: (p) => `ATR ${p.length}`,
    compute: (c, p) => [line(c, RMA(trueRange(c), p.length), 'atr', C.red)],
  },
  stddev: {
    key: 'stddev', name: 'Standard Deviation', category: 'Volatility', overlay: false,
    params: [len(20)], label: (p) => `StdDev ${p.length}`,
    compute: (c, p) => [line(c, STDEV(closes(c), p.length), 'sd', C.sky)],
  },
  chaikinvol: { key: 'chaikinvol', name: 'Chaikin Volatility', category: 'Volatility', disabled: 'coming soon' },
  vix: { key: 'vix', name: 'Volatility Index (VIX)', category: 'Volatility', disabled: 'needs separate index data' },

  // ---- Volume ----
  vwap: {
    key: 'vwap', name: 'Volume Weighted Average Price (VWAP)', category: 'Volume', overlay: true,
    params: [], label: () => 'VWAP',
    compute: (c) => {
      let pv = 0
      let vol = 0
      let day = null
      const out = c.map((x) => {
        const d = Math.floor(x.time / 86400)
        if (d !== day) {
          day = d
          pv = 0
          vol = 0
        }
        const tp = (x.high + x.low + x.close) / 3
        pv += tp * x.volume
        vol += x.volume
        return vol > 0 ? pv / vol : null
      })
      return [line(c, out, 'vwap', C.amber)]
    },
  },
  obv: {
    key: 'obv', name: 'On-Balance Volume (OBV)', category: 'Volume', overlay: false,
    params: [], label: () => 'OBV',
    compute: (c) => {
      let v = 0
      const out = c.map((x, i) => {
        if (i > 0) {
          if (x.close > c[i - 1].close) v += x.volume
          else if (x.close < c[i - 1].close) v -= x.volume
        }
        return v
      })
      return [line(c, out, 'obv', C.teal)]
    },
  },
  ad: {
    key: 'ad', name: 'Accumulation/Distribution (A/D)', category: 'Volume', overlay: false,
    params: [], label: () => 'A/D',
    compute: (c) => {
      let v = 0
      const out = c.map((x) => {
        const rng = x.high - x.low
        const mfm = rng === 0 ? 0 : ((x.close - x.low) - (x.high - x.close)) / rng
        v += mfm * x.volume
        return v
      })
      return [line(c, out, 'ad', C.green)]
    },
  },
  mfi: {
    key: 'mfi', name: 'Money Flow Index (MFI)', category: 'Volume', overlay: false,
    params: [len(14)], refs: [{ value: 80, color: '#475569' }, { value: 20, color: '#475569' }],
    label: (p) => `MFI ${p.length}`,
    compute: (c, p) => {
      const tp = typical(c)
      const pos = new Array(c.length).fill(null)
      const neg = new Array(c.length).fill(null)
      for (let i = 1; i < c.length; i++) {
        const raw = tp[i] * c[i].volume
        pos[i] = tp[i] > tp[i - 1] ? raw : 0
        neg[i] = tp[i] < tp[i - 1] ? raw : 0
      }
      const out = new Array(c.length).fill(null)
      for (let i = p.length; i < c.length; i++) {
        let sp = 0
        let sn = 0
        for (let j = 0; j < p.length; j++) {
          sp += pos[i - j] || 0
          sn += neg[i - j] || 0
        }
        out[i] = sn === 0 ? 100 : 100 - 100 / (1 + sp / sn)
      }
      return [line(c, out, 'mfi', C.purple)]
    },
  },
  pvt: {
    key: 'pvt', name: 'Price Volume Trend (PVT)', category: 'Volume', overlay: false,
    params: [], label: () => 'PVT',
    compute: (c) => {
      let v = 0
      const out = c.map((x, i) => {
        if (i > 0 && c[i - 1].close) v += ((x.close - c[i - 1].close) / c[i - 1].close) * x.volume
        return v
      })
      return [line(c, out, 'pvt', C.sky)]
    },
  },
  cmf: {
    key: 'cmf', name: 'Chaikin Money Flow (CMF)', category: 'Volume', overlay: false,
    params: [len(20)], refs: [{ value: 0, color: '#475569' }], label: (p) => `CMF ${p.length}`,
    compute: (c, p) => {
      const mfv = c.map((x) => {
        const rng = x.high - x.low
        return (rng === 0 ? 0 : ((x.close - x.low) - (x.high - x.close)) / rng) * x.volume
      })
      const out = new Array(c.length).fill(null)
      for (let i = p.length - 1; i < c.length; i++) {
        let sf = 0
        let sv = 0
        for (let j = 0; j < p.length; j++) {
          sf += mfv[i - j]
          sv += c[i - j].volume
        }
        out[i] = sv === 0 ? 0 : sf / sv
      }
      return [line(c, out, 'cmf', C.orange)]
    },
  },
  forceindex: {
    key: 'forceindex', name: 'Force Index', category: 'Volume', overlay: false,
    params: [len(13)], refs: [{ value: 0, color: '#475569' }], label: (p) => `Force ${p.length}`,
    compute: (c, p) => {
      const raw = c.map((x, i) => (i === 0 ? null : (x.close - c[i - 1].close) * x.volume))
      return [line(c, EMA(raw, p.length), 'fi', C.pink)]
    },
  },
  volumeprofile: { key: 'volumeprofile', name: 'Volume Profile', category: 'Volume', disabled: 'coming soon' },
  rvol: { key: 'rvol', name: 'Relative Volume (RVOL)', category: 'Volume', disabled: 'coming soon' },
  updown: { key: 'updown', name: 'Up/Down Volume', category: 'Volume', disabled: 'coming soon' },

  // ---- Support/Resistance & Other ----
  pivots: {
    key: 'pivots', name: 'Pivot Points (Classic)', category: 'Support/Resistance & Other', overlay: true,
    params: [], label: () => 'Pivots',
    compute: (c) => {
      // Per-session pivots from the previous day's H/L/C, drawn as stepped lines.
      const byDay = new Map()
      for (const x of c) {
        const d = Math.floor(x.time / 86400)
        const o = byDay.get(d) || { high: -Infinity, low: Infinity, close: 0 }
        o.high = Math.max(o.high, x.high)
        o.low = Math.min(o.low, x.low)
        o.close = x.close
        byDay.set(d, o)
      }
      const days = [...byDay.keys()].sort((a, b) => a - b)
      const piv = new Map()
      for (let i = 1; i < days.length; i++) {
        const pd = byDay.get(days[i - 1])
        const p = (pd.high + pd.low + pd.close) / 3
        piv.set(days[i], { P: p, R1: 2 * p - pd.low, S1: 2 * p - pd.high, R2: p + (pd.high - pd.low), S2: p - (pd.high - pd.low) })
      }
      const series = (sel, color, ls = 0) =>
        line(c, c.map((x) => piv.get(Math.floor(x.time / 86400))?.[sel] ?? null), sel, color, { lineWidth: 1, lineStyle: ls })
      const out = [series('P', C.amber, 0), series('R1', C.green), series('S1', C.red), series('R2', C.green, 2), series('S2', C.red, 2)]
      out.forEach((o) => (o.stepped = true))
      return out
    },
  },
  camarilla: {
    key: 'camarilla', name: 'Camarilla Pivot Points', category: 'Support/Resistance & Other', overlay: true,
    params: [], label: () => 'Camarilla',
    compute: (c) => {
      const byDay = new Map()
      for (const x of c) {
        const d = Math.floor(x.time / 86400)
        const o = byDay.get(d) || { high: -Infinity, low: Infinity, close: 0 }
        o.high = Math.max(o.high, x.high)
        o.low = Math.min(o.low, x.low)
        o.close = x.close
        byDay.set(d, o)
      }
      const days = [...byDay.keys()].sort((a, b) => a - b)
      const piv = new Map()
      for (let i = 1; i < days.length; i++) {
        const pd = byDay.get(days[i - 1])
        const r = pd.high - pd.low
        piv.set(days[i], {
          H3: pd.close + (r * 1.1) / 4, H4: pd.close + (r * 1.1) / 2,
          L3: pd.close - (r * 1.1) / 4, L4: pd.close - (r * 1.1) / 2,
        })
      }
      const series = (sel, color) =>
        line(c, c.map((x) => piv.get(Math.floor(x.time / 86400))?.[sel] ?? null), sel, color, { lineWidth: 1 })
      const out = [series('H4', C.green), series('H3', C.green), series('L3', C.red), series('L4', C.red)]
      out.forEach((o) => (o.stepped = true))
      return out
    },
  },
  fib: { key: 'fib', name: 'Fibonacci Retracement', category: 'Support/Resistance & Other', disabled: 'drawing tool — coming soon' },
  gann: { key: 'gann', name: 'Gann Fan', category: 'Support/Resistance & Other', disabled: 'drawing tool — coming soon' },
  demarker: { key: 'demarker', name: 'DeMarker Indicator', category: 'Support/Resistance & Other', disabled: 'coming soon' },
  elder: { key: 'elder', name: 'Elder Rays', category: 'Support/Resistance & Other', disabled: 'coming soon' },
  pcr: { key: 'pcr', name: 'Put-Call Ratio (PCR)', category: 'Support/Resistance & Other', disabled: 'chain-wide — N/A on a single strike' },
  oi: { key: 'oi', name: 'Open Interest (OI)', category: 'Support/Resistance & Other', disabled: 'already shown as the OI pane' },
}

// Catalog grouped by category for the menu (preserves insertion order).
export const CATALOG = CATEGORIES.map((cat) => ({
  category: cat,
  items: Object.values(INDICATORS).filter((d) => d.category === cat),
}))

// Build a default-params object for an indicator key.
export const defaultParams = (key) => {
  const def = INDICATORS[key]
  const p = {}
  for (const param of def.params || []) p[param.key] = param.default
  return p
}
