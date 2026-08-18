/**
 * Heikin-Ashi candle transform (a CHART TYPE, not an indicator).
 *
 *   haClose = (O + H + L + C) / 4
 *   haOpen  = first bar → (O + C) / 2 ;  else (prevHaOpen + prevHaClose) / 2
 *   haHigh  = max(H, haOpen, haClose)
 *   haLow   = min(L, haOpen, haClose)
 *
 * Identical to the formula StratosAI's backtest engine already uses for its
 * `heikin_ashi` conditions, so the drawn candles and any HA strategy agree.
 *
 * DISPLAY ONLY: indicators, patterns and pivots keep computing on the REAL OHLC,
 * so a moving average or an SPH still means what it says. (TradingView instead
 * recomputes indicators on HA values — the classic reason HA backtests look far
 * better than they are.)
 *
 * `haOpen` is recursive, so the series is seeded from the first bar handed in —
 * a windowed/replayed slice re-seeds on its own first bar, exactly like TV.
 */
export function heikinAshi(candles) {
  const n = candles?.length ?? 0
  const out = new Array(n)
  let prevOpen = 0
  let prevClose = 0
  for (let i = 0; i < n; i++) {
    const c = candles[i]
    const haClose = (c.open + c.high + c.low + c.close) / 4
    const haOpen = i === 0 ? (c.open + c.close) / 2 : (prevOpen + prevClose) / 2
    out[i] = {
      ...c,
      open: haOpen,
      high: Math.max(c.high, haOpen, haClose),
      low: Math.min(c.low, haOpen, haClose),
      close: haClose,
    }
    prevOpen = haOpen
    prevClose = haClose
  }
  return out
}
