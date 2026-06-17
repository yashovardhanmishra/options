// Reference Pine Script v5 snippets, keyed by indicator.
//
// Each value is a template-literal string holding a complete, compilable Pine v5
// indicator. These are shown to the user as "the Pine equivalent" of the chart's
// built-in indicators; the app computes the real plots client-side (see
// indicators.js) — this map is documentation/reference only.
//
// NOTE: Pine never uses backticks or ${...}, so the template literals are safe.

export const INDICATOR_PINE = {
  // ------------------------------------------------------------------ TREND
  sma: `//@version=5
indicator("Simple Moving Average", overlay=true)
len = input.int(20, "Length")
plot(ta.sma(close, len), "SMA", color=color.blue, linewidth=2)`,

  ema: `//@version=5
indicator("Exponential Moving Average", overlay=true)
len = input.int(20, "Length")
plot(ta.ema(close, len), "EMA", color=color.orange, linewidth=2)`,

  wma: `//@version=5
indicator("Weighted Moving Average", overlay=true)
len = input.int(20, "Length")
plot(ta.wma(close, len), "WMA", color=color.purple, linewidth=2)`,

  smma: `//@version=5
indicator("Smoothed Moving Average", overlay=true)
len = input.int(20, "Length")
// SMMA (a.k.a. RMA): Wilder's smoothing
plot(ta.rma(close, len), "SMMA", color=color.teal, linewidth=2)`,

  lwma: `//@version=5
indicator("Linear Weighted Moving Average", overlay=true)
len = input.int(20, "Length")
// LWMA == WMA (linearly weighted)
plot(ta.wma(close, len), "LWMA", color=color.maroon, linewidth=2)`,

  hma: `//@version=5
indicator("Hull Moving Average", overlay=true)
len = input.int(20, "Length")
plot(ta.hma(close, len), "HMA", color=color.fuchsia, linewidth=2)`,

  donchian: `//@version=5
indicator("Donchian Channels", overlay=true)
len = input.int(20, "Length")
upper = ta.highest(high, len)
lower = ta.lowest(low, len)
basis = math.avg(upper, lower)
plot(upper, "Upper", color=color.green)
plot(lower, "Lower", color=color.red)
plot(basis, "Basis", color=color.gray)`,

  supertrend: `//@version=5
indicator("Supertrend", overlay=true)
atrPeriod = input.int(10, "ATR Period")
factor = input.float(3.0, "Factor")
[supertrend, direction] = ta.supertrend(factor, atrPeriod)
plot(supertrend, "Supertrend", color = direction < 0 ? color.green : color.red, linewidth=2)`,

  psar: `//@version=5
indicator("Parabolic SAR", overlay=true)
start = input.float(0.02, "Start")
inc = input.float(0.02, "Increment")
maxv = input.float(0.2, "Max")
plot(ta.sar(start, inc, maxv), "PSAR", color=color.blue, style=plot.style_cross)`,

  ichimoku: `//@version=5
indicator("Ichimoku Cloud", overlay=true)
conLen = input.int(9, "Conversion")
baseLen = input.int(26, "Base")
spanBLen = input.int(52, "Leading Span B")
donchian(len) => math.avg(ta.lowest(low, len), ta.highest(high, len))
conversion = donchian(conLen)
base = donchian(baseLen)
spanA = math.avg(conversion, base)
spanB = donchian(spanBLen)
plot(conversion, "Conversion", color=color.blue)
plot(base, "Base", color=color.red)
p1 = plot(spanA, "Span A", color=color.green, offset=baseLen)
p2 = plot(spanB, "Span B", color=color.red, offset=baseLen)
fill(p1, p2, color=color.new(color.green, 85))
plot(close, "Lagging Span", color=color.gray, offset=-baseLen)`,

  chandelier: `//@version=5
indicator("Chandelier Exit", overlay=true)
len = input.int(22, "Length")
mult = input.float(3.0, "Multiplier")
atr = mult * ta.atr(len)
longStop = ta.highest(high, len) - atr
shortStop = ta.lowest(low, len) + atr
plot(longStop, "Long Stop", color=color.green)
plot(shortStop, "Short Stop", color=color.red)`,

  // -------------------------------------------------- TREND OSCILLATORS
  adx: `//@version=5
indicator("Average Directional Index", overlay=false)
len = input.int(14, "Length")
[diplus, diminus, adx] = ta.dmi(len, len)
plot(adx, "ADX", color=color.black, linewidth=2)
plot(diplus, "+DI", color=color.green)
plot(diminus, "-DI", color=color.red)
hline(25, "Trend", color=color.gray)`,

  trix: `//@version=5
indicator("Trix", overlay=false)
len = input.int(15, "Length")
e1 = ta.ema(close, len)
e2 = ta.ema(e1, len)
e3 = ta.ema(e2, len)
trix = 10000 * ta.change(e3) / e3
plot(trix, "Trix", color=color.blue, linewidth=2)
hline(0, "Zero", color=color.gray)`,

  aroon: `//@version=5
indicator("Aroon Oscillator", overlay=false)
len = input.int(14, "Length")
upper = 100 * (ta.highestbars(high, len + 1) + len) / len
lower = 100 * (ta.lowestbars(low, len + 1) + len) / len
plot(upper - lower, "Aroon Osc", color=color.purple, linewidth=2)
hline(0, "Zero", color=color.gray)`,

  vortex: `//@version=5
indicator("Vortex", overlay=false)
len = input.int(14, "Length")
vmPlus = math.sum(math.abs(high - low[1]), len)
vmMinus = math.sum(math.abs(low - high[1]), len)
str = math.sum(ta.tr, len)
plot(vmPlus / str, "VI+", color=color.green, linewidth=2)
plot(vmMinus / str, "VI-", color=color.red, linewidth=2)`,

  // ------------------------------------------------------------- MOMENTUM
  rsi: `//@version=5
indicator("RSI", overlay=false)
len = input.int(14, "Length")
r = ta.rsi(close, len)
plot(r, "RSI", color=color.purple, linewidth=2)
hline(70, "Overbought", color=color.red)
hline(30, "Oversold", color=color.green)`,

  macd: `//@version=5
indicator("MACD", overlay=false)
fast = input.int(12, "Fast")
slow = input.int(26, "Slow")
sig = input.int(9, "Signal")
[macdLine, signalLine, hist] = ta.macd(close, fast, slow, sig)
plot(macdLine, "MACD", color=color.blue)
plot(signalLine, "Signal", color=color.orange)
plot(hist, "Histogram", color=color.gray, style=plot.style_histogram)`,

  stoch: `//@version=5
indicator("Stochastic", overlay=false)
kLen = input.int(14, "%K Length")
kSmooth = input.int(3, "%K Smoothing")
dSmooth = input.int(3, "%D Smoothing")
k = ta.sma(ta.stoch(close, high, low, kLen), kSmooth)
d = ta.sma(k, dSmooth)
plot(k, "%K", color=color.blue)
plot(d, "%D", color=color.orange)
hline(80, "Overbought", color=color.red)
hline(20, "Oversold", color=color.green)`,

  williams: `//@version=5
indicator("Williams %R", overlay=false)
len = input.int(14, "Length")
hh = ta.highest(high, len)
ll = ta.lowest(low, len)
plot(100 * (close - hh) / (hh - ll), "%R", color=color.blue, linewidth=2)
hline(-20, "Overbought", color=color.red)
hline(-80, "Oversold", color=color.green)`,

  roc: `//@version=5
indicator("Rate of Change", overlay=false)
len = input.int(10, "Length")
plot(ta.roc(close, len), "ROC", color=color.blue, linewidth=2)
hline(0, "Zero", color=color.gray)`,

  cci: `//@version=5
indicator("CCI", overlay=false)
len = input.int(20, "Length")
plot(ta.cci(close, len), "CCI", color=color.blue, linewidth=2)
hline(100, "Overbought", color=color.red)
hline(-100, "Oversold", color=color.green)`,

  tsi: `//@version=5
indicator("True Strength Index", overlay=false)
longLen = input.int(25, "Long")
shortLen = input.int(13, "Short")
pc = ta.change(close)
dsPc = ta.ema(ta.ema(pc, longLen), shortLen)
dsAbsPc = ta.ema(ta.ema(math.abs(pc), longLen), shortLen)
plot(100 * dsPc / dsAbsPc, "TSI", color=color.blue, linewidth=2)
hline(0, "Zero", color=color.gray)`,

  imi: `//@version=5
indicator("Intraday Momentum Index", overlay=false)
len = input.int(14, "Length")
gains = math.sum(close > open ? close - open : 0, len)
losses = math.sum(close < open ? open - close : 0, len)
plot(100 * gains / (gains + losses), "IMI", color=color.purple, linewidth=2)
hline(70, "Overbought", color=color.red)
hline(30, "Oversold", color=color.green)`,

  dpo: `//@version=5
indicator("Detrended Price Oscillator", overlay=false)
len = input.int(20, "Length")
barsBack = len / 2 + 1
dpo = close - ta.sma(close, len)[barsBack]
plot(dpo, "DPO", color=color.blue, linewidth=2)
hline(0, "Zero", color=color.gray)`,

  fisher: `//@version=5
indicator("Fisher Transform", overlay=false)
len = input.int(9, "Length")
hl2v = (high + low) / 2
maxh = ta.highest(hl2v, len)
minl = ta.lowest(hl2v, len)
var float value = 0.0
value := 0.66 * ((hl2v - minl) / math.max(maxh - minl, 0.001) - 0.5) + 0.67 * nz(value[1])
value := math.max(math.min(value, 0.999), -0.999)
var float fish = 0.0
fish := 0.5 * math.log((1 + value) / (1 - value)) + 0.5 * nz(fish[1])
plot(fish, "Fisher", color=color.blue, linewidth=2)
plot(fish[1], "Trigger", color=color.orange)
hline(0, "Zero", color=color.gray)`,

  mbo: `//@version=5
indicator("Motherboard Oscillator", overlay=false)
// note: "Motherboard Oscillator" is non-standard; implemented here as a
// zero-centered, double-smoothed momentum (price minus its own EMA, smoothed).
len = input.int(14, "Length")
smooth = input.int(3, "Smoothing")
mom = close - ta.ema(close, len)
osc = ta.ema(mom, smooth)
plot(osc, "MBO", color=color.teal, linewidth=2, style=plot.style_area)
hline(0, "Zero", color=color.gray)`,

  demarker: `//@version=5
indicator("DeMarker", overlay=false)
len = input.int(14, "Length")
deMax = high > high[1] ? high - high[1] : 0
deMin = low < low[1] ? low[1] - low : 0
dem = ta.sma(deMax, len) / (ta.sma(deMax, len) + ta.sma(deMin, len))
plot(dem, "DeMarker", color=color.blue, linewidth=2)
hline(0.7, "Overbought", color=color.red)
hline(0.3, "Oversold", color=color.green)`,

  // ----------------------------------------------------------- VOLATILITY
  bb: `//@version=5
indicator("Bollinger Bands", overlay=true)
len = input.int(20, "Length")
mult = input.float(2.0, "Multiplier")
[basis, upper, lower] = ta.bb(close, len, mult)
plot(basis, "Basis", color=color.orange)
p1 = plot(upper, "Upper", color=color.blue)
p2 = plot(lower, "Lower", color=color.blue)
fill(p1, p2, color=color.new(color.blue, 90))`,

  keltner: `//@version=5
indicator("Keltner Channels", overlay=true)
len = input.int(20, "Length")
mult = input.float(2.0, "Multiplier")
basis = ta.ema(close, len)
rng = mult * ta.atr(len)
plot(basis, "Basis", color=color.orange)
p1 = plot(basis + rng, "Upper", color=color.blue)
p2 = plot(basis - rng, "Lower", color=color.blue)
fill(p1, p2, color=color.new(color.blue, 90))`,

  envelopes: `//@version=5
indicator("Price Envelopes", overlay=true)
len = input.int(20, "Length")
pct = input.float(2.5, "Percent")
basis = ta.sma(close, len)
k = pct / 100
plot(basis, "Basis", color=color.orange)
plot(basis * (1 + k), "Upper", color=color.blue)
plot(basis * (1 - k), "Lower", color=color.blue)`,

  atr: `//@version=5
indicator("Average True Range", overlay=false)
len = input.int(14, "Length")
plot(ta.atr(len), "ATR", color=color.red, linewidth=2)`,

  stddev: `//@version=5
indicator("Standard Deviation", overlay=false)
len = input.int(20, "Length")
plot(ta.stdev(close, len), "StdDev", color=color.purple, linewidth=2)`,

  chaikinvol: `//@version=5
indicator("Chaikin Volatility", overlay=false)
len = input.int(10, "Length")
ema = ta.ema(high - low, len)
plot(100 * ta.change(ema, len) / ema[len], "Chaikin Vol", color=color.orange, linewidth=2)
hline(0, "Zero", color=color.gray)`,

  vix: `//@version=5
indicator("Volatility Index", overlay=false)
// note: VIX is an external symbol, not derivable from this chart's OHLCV.
// Pull India VIX (or CBOE VIX) via request.security from the index feed.
sym = input.symbol("CBOE:VIX", "VIX Symbol")
vix = request.security(sym, timeframe.period, close)
plot(vix, "VIX", color=color.red, linewidth=2)
hline(20, "Elevated", color=color.gray)`,

  // ---------------------------------------------------------------- VOLUME
  vwap: `//@version=5
indicator("VWAP", overlay=true)
plot(ta.vwap(hlc3), "VWAP", color=color.blue, linewidth=2)`,

  obv: `//@version=5
indicator("On-Balance Volume", overlay=false)
plot(ta.obv, "OBV", color=color.blue, linewidth=2)`,

  ad: `//@version=5
indicator("Accumulation/Distribution", overlay=false)
mfm = (close - low - (high - close)) / (high - low)
mfv = mfm * volume
ad = ta.cum(nz(mfv))
plot(ad, "A/D", color=color.teal, linewidth=2)`,

  mfi: `//@version=5
indicator("Money Flow Index", overlay=false)
len = input.int(14, "Length")
plot(ta.mfi(hlc3, len), "MFI", color=color.purple, linewidth=2)
hline(80, "Overbought", color=color.red)
hline(20, "Oversold", color=color.green)`,

  pvt: `//@version=5
indicator("Price Volume Trend", overlay=false)
pvt = ta.cum(ta.change(close) / close[1] * volume)
plot(pvt, "PVT", color=color.blue, linewidth=2)`,

  cmf: `//@version=5
indicator("Chaikin Money Flow", overlay=false)
len = input.int(20, "Length")
mfm = (close - low - (high - close)) / (high - low)
mfv = mfm * volume
cmf = math.sum(nz(mfv), len) / math.sum(volume, len)
plot(cmf, "CMF", color=color.teal, linewidth=2)
hline(0, "Zero", color=color.gray)`,

  forceindex: `//@version=5
indicator("Force Index", overlay=false)
len = input.int(13, "Length")
fi = ta.ema(ta.change(close) * volume, len)
plot(fi, "Force Index", color=color.blue, linewidth=2)
hline(0, "Zero", color=color.gray)`,

  volumeprofile: `//@version=5
indicator("Volume Profile", overlay=true)
// note: a true Volume Profile (histogram of volume by price bin) needs the
// box/array drawing API and a full bar scan; not a single plot(). As a simple
// proxy this marks the volume-weighted average price as the "value area" anchor.
plot(ta.vwap(hlc3), "POC proxy (VWAP)", color=color.orange, linewidth=2)`,

  rvol: `//@version=5
indicator("Relative Volume", overlay=false)
len = input.int(20, "Length")
rvol = volume / ta.sma(volume, len)
plot(rvol, "RVOL", color=color.blue, style=plot.style_columns)
hline(1, "Average", color=color.gray)`,

  updown: `//@version=5
indicator("Up/Down Volume", overlay=false)
upVol = close >= open ? volume : 0
downVol = close < open ? -volume : 0
plot(upVol, "Up Volume", color=color.green, style=plot.style_columns)
plot(downVol, "Down Volume", color=color.red, style=plot.style_columns)`,

  // ----------------------------------------- SUPPORT/RESISTANCE & OTHER
  pivots: `//@version=5
indicator("Pivot Points Classic", overlay=true)
pivot = (high[1] + low[1] + close[1]) / 3
r1 = 2 * pivot - low[1]
s1 = 2 * pivot - high[1]
r2 = pivot + (high[1] - low[1])
s2 = pivot - (high[1] - low[1])
plot(pivot, "P", color=color.orange)
plot(r1, "R1", color=color.red)
plot(s1, "S1", color=color.green)
plot(r2, "R2", color=color.red)
plot(s2, "S2", color=color.green)`,

  camarilla: `//@version=5
indicator("Camarilla Pivot Points", overlay=true)
rng = high[1] - low[1]
c = close[1]
r1 = c + rng * 1.1 / 12
s1 = c - rng * 1.1 / 12
r2 = c + rng * 1.1 / 6
s2 = c - rng * 1.1 / 6
r3 = c + rng * 1.1 / 4
s3 = c - rng * 1.1 / 4
plot(r3, "R3", color=color.red)
plot(r2, "R2", color=color.red)
plot(r1, "R1", color=color.red)
plot(s1, "S1", color=color.green)
plot(s2, "S2", color=color.green)
plot(s3, "S3", color=color.green)`,

  fib: `//@version=5
indicator("Fibonacci Retracement", overlay=true)
len = input.int(100, "Lookback")
hi = ta.highest(high, len)
lo = ta.lowest(low, len)
d = hi - lo
plot(hi, "0%", color=color.gray)
plot(hi - d * 0.236, "23.6%", color=color.red)
plot(hi - d * 0.382, "38.2%", color=color.orange)
plot(hi - d * 0.5, "50%", color=color.yellow)
plot(hi - d * 0.618, "61.8%", color=color.green)
plot(hi - d * 0.786, "78.6%", color=color.blue)
plot(lo, "100%", color=color.gray)`,

  gann: `//@version=5
indicator("Gann Fan", overlay=true)
// note: a Gann Fan is a drawing tool (angled lines from a pivot). This is a
// simple proxy: a 1x1 angle line rising one ATR per bar from a recent low.
len = input.int(50, "Anchor Lookback")
anchor = ta.lowest(low, len)
slope = ta.atr(14)
var float startBar = na
if bar_index % len == 0
    startBar := bar_index
line1x1 = anchor + slope * (bar_index - nz(startBar, bar_index))
plot(line1x1, "1x1", color=color.purple, linewidth=2)`,

  elder: `//@version=5
indicator("Elder Rays (Bull & Bear Power)", overlay=false)
len = input.int(13, "Length")
ema = ta.ema(close, len)
bullPower = high - ema
bearPower = low - ema
plot(bullPower, "Bull Power", color=color.green, style=plot.style_columns)
plot(bearPower, "Bear Power", color=color.red, style=plot.style_columns)
hline(0, "Zero", color=color.gray)`,

  pcr: `//@version=5
indicator("Put-Call Ratio", overlay=false)
// note: PCR needs aggregated put vs call options data (volume or OI across the
// chain), which isn't on a single chart's OHLCV. Supply put/call symbols and
// take the ratio of their volumes via request.security as an illustration.
putSym = input.symbol("", "Put Symbol")
callSym = input.symbol("", "Call Symbol")
putVol = request.security(putSym, timeframe.period, volume)
callVol = request.security(callSym, timeframe.period, volume)
plot(callVol != 0 ? putVol / callVol : na, "PCR", color=color.purple, linewidth=2)
hline(1, "Neutral", color=color.gray)`,

  oi: `//@version=5
indicator("Open Interest", overlay=false)
// note: Open Interest is a separate data series, not part of OHLCV; on feeds
// that publish it you request the "_OI" companion symbol. Many chart feeds
// don't expose it, in which case this returns na.
oi = request.security(syminfo.tickerid + "_OI", timeframe.period, close, ignore_invalid_symbol=true)
plot(oi, "OI", color=color.blue, linewidth=2, style=plot.style_columns)`,
}
