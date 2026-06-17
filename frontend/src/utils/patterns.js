// Candlestick pattern detection engine + registry (50 patterns).
//
// Each pattern exposes a `test(candles, i)` predicate evaluated at the pattern's
// CONFIRMATION bar `i` (the last bar of the pattern). `detectPattern` turns that
// into lightweight-charts markers. Markers are styled by sentiment `dir`:
//   bull    -> green up-arrow below the bar
//   bear    -> red down-arrow above the bar
//   neutral -> gray circle above the bar
// Detection runs entirely client-side on the same resampled candles the chart
// draws, so markers always line up with what's on screen.

// ----------------------------------------------------------- geometry helpers
const body = (c) => Math.abs(c.close - c.open)
const rng = (c) => c.high - c.low
const upW = (c) => c.high - Math.max(c.open, c.close) // upper shadow length
const loW = (c) => Math.min(c.open, c.close) - c.low // lower shadow length
const bull = (c) => c.close > c.open
const bear = (c) => c.close < c.open
const bTop = (c) => Math.max(c.open, c.close) // top of the real body
const bBot = (c) => Math.min(c.open, c.close) // bottom of the real body
const mid = (c) => (c.open + c.close) / 2 // real-body midpoint

const isDoji = (c) => rng(c) > 0 && body(c) <= 0.1 * rng(c)
const isMaru = (c) =>
  rng(c) > 0 && upW(c) <= 0.05 * rng(c) && loW(c) <= 0.05 * rng(c) && body(c) >= 0.9 * rng(c)

// adaptive "approximately equal": within 10% of the involved bars' range
const near = (x, y, ...cs) => {
  let r = 0
  for (const c of cs) r = Math.max(r, rng(c))
  return Math.abs(x - y) <= 0.1 * (r || Math.max(Math.abs(x), Math.abs(y), 1e-9))
}
// mean real-body of the `n` bars before i (for "long" / "small" sizing)
const avgBody = (cs, i, n = 10) => {
  let s = 0
  let k = 0
  for (let j = Math.max(0, i - n); j < i; j++) {
    s += body(cs[j])
    k++
  }
  return k ? s / k : body(cs[i])
}
// prior trend into the bar at index f (the pattern's first bar)
const downBefore = (cs, f, lb = 3) => f - 1 - lb >= 0 && cs[f - 1].close < cs[f - 1 - lb].close
const upBefore = (cs, f, lb = 3) => f - 1 - lb >= 0 && cs[f - 1].close > cs[f - 1 - lb].close

// small body sized vs its own range, used by several reversal shapes
const smallBody = (c) => rng(c) > 0 && body(c) <= 0.3 * rng(c)

// ----------------------------------------------------------- pattern registry
// group: how the dropdown buckets them. dir: marker sentiment. bars: lookback.
export const PATTERNS = [
  // ===== single candle =====
  { key: 'doji', name: 'Doji', type: 'Neutral', group: 'Single candle', dir: 'neutral', bars: 1, mark: 'D',
    test: (cs, i) => isDoji(cs[i]) },
  { key: 'dragonfly_doji', name: 'Dragonfly Doji', type: 'Bullish Reversal', group: 'Single candle', dir: 'bull', bars: 1, mark: 'DD',
    test: (cs, i) => { const c = cs[i]; return isDoji(c) && loW(c) >= 0.6 * rng(c) && upW(c) <= 0.1 * rng(c) } },
  { key: 'gravestone_doji', name: 'Gravestone Doji', type: 'Bearish Reversal', group: 'Single candle', dir: 'bear', bars: 1, mark: 'GD',
    test: (cs, i) => { const c = cs[i]; return isDoji(c) && upW(c) >= 0.6 * rng(c) && loW(c) <= 0.1 * rng(c) } },
  { key: 'long_legged_doji', name: 'Long-Legged Doji', type: 'Neutral', group: 'Single candle', dir: 'neutral', bars: 1, mark: 'LLD',
    test: (cs, i) => { const c = cs[i]; return isDoji(c) && upW(c) >= 0.3 * rng(c) && loW(c) >= 0.3 * rng(c) } },
  { key: 'hammer', name: 'Hammer', type: 'Bullish Reversal', group: 'Single candle', dir: 'bull', bars: 1, mark: 'H',
    test: (cs, i) => { const c = cs[i]; const b = body(c); return rng(c) > 0 && b >= 0.1 * rng(c) && loW(c) >= 2 * b && upW(c) <= b && downBefore(cs, i) } },
  { key: 'hanging_man', name: 'Hanging Man', type: 'Bearish Reversal', group: 'Single candle', dir: 'bear', bars: 1, mark: 'HM',
    test: (cs, i) => { const c = cs[i]; const b = body(c); return rng(c) > 0 && b >= 0.1 * rng(c) && loW(c) >= 2 * b && upW(c) <= b && upBefore(cs, i) } },
  { key: 'inverted_hammer', name: 'Inverted Hammer', type: 'Bullish Reversal', group: 'Single candle', dir: 'bull', bars: 1, mark: 'IH',
    test: (cs, i) => { const c = cs[i]; const b = body(c); return rng(c) > 0 && b >= 0.1 * rng(c) && upW(c) >= 2 * b && loW(c) <= b && downBefore(cs, i) } },
  { key: 'shooting_star', name: 'Shooting Star', type: 'Bearish Reversal', group: 'Single candle', dir: 'bear', bars: 1, mark: 'SS',
    test: (cs, i) => { const c = cs[i]; const b = body(c); return rng(c) > 0 && b >= 0.1 * rng(c) && upW(c) >= 2 * b && loW(c) <= b && upBefore(cs, i) } },
  { key: 'marubozu', name: 'Marubozu', type: 'Continuation', group: 'Single candle', dir: 'neutral', bars: 1, mark: 'M',
    test: (cs, i) => isMaru(cs[i]) },
  { key: 'bullish_marubozu', name: 'Bullish Marubozu', type: 'Bullish', group: 'Single candle', dir: 'bull', bars: 1, mark: 'M+',
    test: (cs, i) => isMaru(cs[i]) && bull(cs[i]) },
  { key: 'bearish_marubozu', name: 'Bearish Marubozu', type: 'Bearish', group: 'Single candle', dir: 'bear', bars: 1, mark: 'M-',
    test: (cs, i) => isMaru(cs[i]) && bear(cs[i]) },
  { key: 'spinning_top', name: 'Spinning Top', type: 'Neutral', group: 'Single candle', dir: 'neutral', bars: 1, mark: 'ST',
    test: (cs, i) => { const c = cs[i]; return smallBody(c) && upW(c) >= 0.2 * rng(c) && loW(c) >= 0.2 * rng(c) && !isDoji(c) } },
  { key: 'high_wave', name: 'High Wave Candle', type: 'Neutral', group: 'Single candle', dir: 'neutral', bars: 1, mark: 'HW',
    test: (cs, i) => { const c = cs[i]; return rng(c) > 0 && body(c) <= 0.2 * rng(c) && upW(c) >= 0.4 * rng(c) && loW(c) >= 0.4 * rng(c) } },
  { key: 'long_bullish', name: 'Long Bullish Candle', type: 'Bullish', group: 'Single candle', dir: 'bull', bars: 1, mark: 'LB',
    test: (cs, i) => { const c = cs[i]; return bull(c) && body(c) >= 0.7 * rng(c) && body(c) >= 1.3 * avgBody(cs, i) } },
  { key: 'long_bearish', name: 'Long Bearish Candle', type: 'Bearish', group: 'Single candle', dir: 'bear', bars: 1, mark: 'LR',
    test: (cs, i) => { const c = cs[i]; return bear(c) && body(c) >= 0.7 * rng(c) && body(c) >= 1.3 * avgBody(cs, i) } },

  // ===== two candle =====
  { key: 'bullish_engulfing', name: 'Bullish Engulfing', type: 'Bullish Reversal', group: 'Two candle', dir: 'bull', bars: 2, mark: 'BE',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return bear(p) && bull(c) && bBot(c) <= bBot(p) && bTop(c) >= bTop(p) && body(c) > body(p) } },
  { key: 'bearish_engulfing', name: 'Bearish Engulfing', type: 'Bearish Reversal', group: 'Two candle', dir: 'bear', bars: 2, mark: 'BR',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return bull(p) && bear(c) && bBot(c) <= bBot(p) && bTop(c) >= bTop(p) && body(c) > body(p) } },
  { key: 'piercing_line', name: 'Piercing Line', type: 'Bullish Reversal', group: 'Two candle', dir: 'bull', bars: 2, mark: 'PL',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return bear(p) && bull(c) && c.open < p.low && c.close > mid(p) && c.close < p.open } },
  { key: 'dark_cloud_cover', name: 'Dark Cloud Cover', type: 'Bearish Reversal', group: 'Two candle', dir: 'bear', bars: 2, mark: 'DCC',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return bull(p) && bear(c) && c.open > p.high && c.close < mid(p) && c.close > p.open } },
  { key: 'harami', name: 'Harami', type: 'Reversal', group: 'Two candle', dir: 'neutral', bars: 2, mark: 'HA',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return body(p) > 0 && bTop(c) <= bTop(p) && bBot(c) >= bBot(p) && body(p) >= 2 * body(c) && bull(p) !== bull(c) } },
  { key: 'bullish_harami', name: 'Bullish Harami', type: 'Bullish', group: 'Two candle', dir: 'bull', bars: 2, mark: 'HA+',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return bear(p) && bull(c) && bTop(c) <= bTop(p) && bBot(c) >= bBot(p) && body(p) >= 2 * body(c) && downBefore(cs, i - 1) } },
  { key: 'bearish_harami', name: 'Bearish Harami', type: 'Bearish', group: 'Two candle', dir: 'bear', bars: 2, mark: 'HA-',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return bull(p) && bear(c) && bTop(c) <= bTop(p) && bBot(c) >= bBot(p) && body(p) >= 2 * body(c) && upBefore(cs, i - 1) } },
  { key: 'harami_cross', name: 'Harami Cross', type: 'Reversal', group: 'Two candle', dir: 'neutral', bars: 2, mark: 'HC',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return body(p) > 0 && isDoji(c) && bTop(c) <= bTop(p) && bBot(c) >= bBot(p) && body(p) >= 2 * rng(c) } },
  { key: 'tweezer_top', name: 'Tweezer Top', type: 'Bearish Reversal', group: 'Two candle', dir: 'bear', bars: 2, mark: 'TT',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return bull(p) && bear(c) && near(p.high, c.high, p, c) && upBefore(cs, i - 1) } },
  { key: 'tweezer_bottom', name: 'Tweezer Bottom', type: 'Bullish Reversal', group: 'Two candle', dir: 'bull', bars: 2, mark: 'TB',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return bear(p) && bull(c) && near(p.low, c.low, p, c) && downBefore(cs, i - 1) } },
  { key: 'matching_low', name: 'Matching Low', type: 'Bullish', group: 'Two candle', dir: 'bull', bars: 2, mark: 'ML',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return bear(p) && bear(c) && near(p.close, c.close, p, c) && downBefore(cs, i - 1) } },
  { key: 'matching_high', name: 'Matching High', type: 'Bearish', group: 'Two candle', dir: 'bear', bars: 2, mark: 'MH',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return bull(p) && bull(c) && near(p.close, c.close, p, c) && upBefore(cs, i - 1) } },
  { key: 'kicking', name: 'Kicking', type: 'Strong Reversal', group: 'Two candle', dir: 'neutral', bars: 2, mark: 'K',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return (isMaru(p) && bear(p) && isMaru(c) && bull(c) && c.low > p.high) || (isMaru(p) && bull(p) && isMaru(c) && bear(c) && c.high < p.low) } },
  { key: 'bullish_kicking', name: 'Bullish Kicking', type: 'Bullish', group: 'Two candle', dir: 'bull', bars: 2, mark: 'K+',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return isMaru(p) && bear(p) && isMaru(c) && bull(c) && c.low > p.high } },
  { key: 'bearish_kicking', name: 'Bearish Kicking', type: 'Bearish', group: 'Two candle', dir: 'bear', bars: 2, mark: 'K-',
    test: (cs, i) => { const p = cs[i - 1]; const c = cs[i]; return isMaru(p) && bull(p) && isMaru(c) && bear(c) && c.high < p.low } },

  // ===== three candle =====
  { key: 'morning_star', name: 'Morning Star', type: 'Bullish Reversal', group: 'Three candle', dir: 'bull', bars: 3, mark: 'MS',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return bear(a) && body(a) >= avgBody(cs, i - 2) && body(b) <= 0.5 * body(a) && bTop(b) <= bBot(a) + 0.05 * rng(a) && bull(d) && d.close > mid(a) && downBefore(cs, i - 2) } },
  { key: 'evening_star', name: 'Evening Star', type: 'Bearish Reversal', group: 'Three candle', dir: 'bear', bars: 3, mark: 'ES',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return bull(a) && body(a) >= avgBody(cs, i - 2) && body(b) <= 0.5 * body(a) && bBot(b) >= bTop(a) - 0.05 * rng(a) && bear(d) && d.close < mid(a) && upBefore(cs, i - 2) } },
  { key: 'morning_doji_star', name: 'Morning Doji Star', type: 'Bullish', group: 'Three candle', dir: 'bull', bars: 3, mark: 'MDS',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return bear(a) && isDoji(b) && bTop(b) <= bBot(a) + 0.05 * rng(a) && bull(d) && d.close > mid(a) && downBefore(cs, i - 2) } },
  { key: 'evening_doji_star', name: 'Evening Doji Star', type: 'Bearish', group: 'Three candle', dir: 'bear', bars: 3, mark: 'EDS',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return bull(a) && isDoji(b) && bBot(b) >= bTop(a) - 0.05 * rng(a) && bear(d) && d.close < mid(a) && upBefore(cs, i - 2) } },
  { key: 'three_white_soldiers', name: 'Three White Soldiers', type: 'Bullish Continuation/Reversal', group: 'Three candle', dir: 'bull', bars: 3, mark: '3WS',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return bull(a) && bull(b) && bull(d) && b.close > a.close && d.close > b.close && b.open > a.open && b.open < a.close && d.open > b.open && d.open < b.close && upW(b) <= 0.3 * body(b) && upW(d) <= 0.3 * body(d) } },
  { key: 'three_black_crows', name: 'Three Black Crows', type: 'Bearish Continuation/Reversal', group: 'Three candle', dir: 'bear', bars: 3, mark: '3BC',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return bear(a) && bear(b) && bear(d) && b.close < a.close && d.close < b.close && b.open < a.open && b.open > a.close && d.open < b.open && d.open > b.close && loW(b) <= 0.3 * body(b) && loW(d) <= 0.3 * body(d) } },
  { key: 'three_inside_up', name: 'Three Inside Up', type: 'Bullish', group: 'Three candle', dir: 'bull', bars: 3, mark: '3IU',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return bear(a) && bull(b) && bTop(b) <= bTop(a) && bBot(b) >= bBot(a) && body(a) >= 2 * body(b) && bull(d) && d.close > a.open } },
  { key: 'three_inside_down', name: 'Three Inside Down', type: 'Bearish', group: 'Three candle', dir: 'bear', bars: 3, mark: '3ID',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return bull(a) && bear(b) && bTop(b) <= bTop(a) && bBot(b) >= bBot(a) && body(a) >= 2 * body(b) && bear(d) && d.close < a.open } },
  { key: 'three_outside_up', name: 'Three Outside Up', type: 'Bullish', group: 'Three candle', dir: 'bull', bars: 3, mark: '3OU',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return bear(a) && bull(b) && bBot(b) <= bBot(a) && bTop(b) >= bTop(a) && body(b) > body(a) && bull(d) && d.close > b.close } },
  { key: 'three_outside_down', name: 'Three Outside Down', type: 'Bearish', group: 'Three candle', dir: 'bear', bars: 3, mark: '3OD',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return bull(a) && bear(b) && bBot(b) <= bBot(a) && bTop(b) >= bTop(a) && body(b) > body(a) && bear(d) && d.close < b.close } },
  { key: 'three_stars_south', name: 'Three Stars in the South', type: 'Bullish', group: 'Three candle', dir: 'bull', bars: 3, mark: '3SS',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return downBefore(cs, i - 2) && bear(a) && bear(b) && bear(d) && body(a) > body(b) && body(b) >= body(d) && b.low >= a.low && d.low >= b.low && loW(a) >= body(a) } },
  { key: 'upside_gap_two_crows', name: 'Upside Gap Two Crows', type: 'Bearish', group: 'Three candle', dir: 'bear', bars: 3, mark: 'UGC',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return upBefore(cs, i - 2) && bull(a) && bear(b) && bBot(b) > a.close && bear(d) && d.open > b.open && d.close < b.close && d.close > a.close } },
  { key: 'unique_three_river', name: 'Unique Three River', type: 'Bullish', group: 'Three candle', dir: 'bull', bars: 3, mark: 'U3R',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return downBefore(cs, i - 2) && bear(a) && bear(b) && b.low < a.low && bBot(b) <= bBot(a) && loW(b) >= body(b) && bull(d) && d.close < b.close && body(d) < body(b) } },
  { key: 'abandoned_baby', name: 'Abandoned Baby', type: 'Strong Reversal', group: 'Three candle', dir: 'neutral', bars: 3, mark: 'AB',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return (bear(a) && isDoji(b) && b.high < a.low && bull(d) && d.low > b.high) || (bull(a) && isDoji(b) && b.low > a.high && bear(d) && d.high < b.low) } },
  { key: 'bullish_abandoned_baby', name: 'Bullish Abandoned Baby', type: 'Bullish', group: 'Three candle', dir: 'bull', bars: 3, mark: 'AB+',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return bear(a) && isDoji(b) && b.high < a.low && bull(d) && d.low > b.high && downBefore(cs, i - 2) } },
  { key: 'bearish_abandoned_baby', name: 'Bearish Abandoned Baby', type: 'Bearish', group: 'Three candle', dir: 'bear', bars: 3, mark: 'AB-',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return bull(a) && isDoji(b) && b.low > a.high && bear(d) && d.high < b.low && upBefore(cs, i - 2) } },
  { key: 'stick_sandwich', name: 'Stick Sandwich', type: 'Bullish Reversal', group: 'Three candle', dir: 'bull', bars: 3, mark: 'SW',
    test: (cs, i) => { const a = cs[i - 2]; const b = cs[i - 1]; const d = cs[i]; return bear(a) && bull(b) && bear(d) && near(a.close, d.close, a, d) && downBefore(cs, i - 2) } },

  // ===== complex (4-5 candles) =====
  { key: 'three_line_strike', name: 'Three-Line Strike', type: 'Continuation', group: 'Complex', dir: 'neutral', bars: 4, mark: '3LS',
    test: (cs, i) => {
      const a = cs[i - 3]; const b = cs[i - 2]; const c = cs[i - 1]; const d = cs[i]
      const up = bull(a) && bull(b) && bull(c) && b.close > a.close && c.close > b.close && bear(d) && d.open >= c.close && d.close < a.open
      const dn = bear(a) && bear(b) && bear(c) && b.close < a.close && c.close < b.close && bull(d) && d.open <= c.close && d.close > a.open
      return up || dn
    } },
  { key: 'rising_three_methods', name: 'Rising Three Methods', type: 'Bullish Continuation', group: 'Complex', dir: 'bull', bars: 5, mark: 'R3M',
    test: (cs, i) => {
      const a = cs[i - 4]; const b = cs[i - 3]; const c = cs[i - 2]; const d = cs[i - 1]; const e = cs[i]
      const hi = Math.max(b.high, c.high, d.high)
      const lo = Math.min(b.low, c.low, d.low)
      return bull(a) && body(a) >= 1.2 * avgBody(cs, i - 4) && bear(b) && bear(c) && bear(d) && hi <= a.high && lo >= a.low && bull(e) && e.close > a.close
    } },
  { key: 'falling_three_methods', name: 'Falling Three Methods', type: 'Bearish Continuation', group: 'Complex', dir: 'bear', bars: 5, mark: 'F3M',
    test: (cs, i) => {
      const a = cs[i - 4]; const b = cs[i - 3]; const c = cs[i - 2]; const d = cs[i - 1]; const e = cs[i]
      const hi = Math.max(b.high, c.high, d.high)
      const lo = Math.min(b.low, c.low, d.low)
      return bear(a) && body(a) >= 1.2 * avgBody(cs, i - 4) && bull(b) && bull(c) && bull(d) && hi <= a.high && lo >= a.low && bear(e) && e.close < a.close
    } },
]

export const PATTERN_BY_KEY = Object.fromEntries(PATTERNS.map((p) => [p.key, p]))

// grouped for the dropdown, in registry order
export const PATTERN_GROUPS = ['Single candle', 'Two candle', 'Three candle', 'Complex']
export const PATTERN_CATALOG = PATTERN_GROUPS.map((group) => ({
  category: group,
  items: PATTERNS.filter((p) => p.group === group),
}))

// ----------------------------------------------------------- marker building
const STYLE = {
  bull: { position: 'belowBar', color: '#22c55e', shape: 'arrowUp' },
  bear: { position: 'aboveBar', color: '#ef4444', shape: 'arrowDown' },
  neutral: { position: 'aboveBar', color: '#9ca3af', shape: 'circle' },
}

// markers (lightweight-charts format) for one pattern over the candle array
export function detectPattern(p, candles) {
  const st = STYLE[p.dir] || STYLE.neutral
  const out = []
  const start = (p.bars || 1) - 1
  for (let i = start; i < candles.length; i++) {
    let hit = false
    try {
      hit = p.test(candles, i)
    } catch {
      hit = false
    }
    if (hit) out.push({ time: candles[i].time, position: st.position, color: st.color, shape: st.shape, text: p.mark })
  }
  return out
}

// merged, time-sorted markers for a set of active pattern keys
export function buildMarkers(keys, candles) {
  const all = []
  for (const k of keys) {
    const p = PATTERN_BY_KEY[k]
    if (p) all.push(...detectPattern(p, candles))
  }
  all.sort((a, b) => a.time - b.time)
  return all
}

// ----------------------------------------------------------- Pine Script
// One compilable Pine v5 indicator per pattern, mirroring the detector above.
export const PATTERN_PINE = {
  doji: `//@version=5
indicator("Doji", overlay=true)
rng = high - low
d = rng > 0 and math.abs(close - open) <= 0.1 * rng
plotshape(d, "Doji", shape.circle, location.abovebar, color.gray, size=size.tiny, text="D")`,
  dragonfly_doji: `//@version=5
indicator("Dragonfly Doji", overlay=true)
rng = high - low
body = math.abs(close - open)
loW = math.min(open, close) - low
upW = high - math.max(open, close)
d = rng > 0 and body <= 0.1 * rng and loW >= 0.6 * rng and upW <= 0.1 * rng
plotshape(d, "Dragonfly Doji", shape.triangleup, location.belowbar, color.green, text="DD")`,
  gravestone_doji: `//@version=5
indicator("Gravestone Doji", overlay=true)
rng = high - low
body = math.abs(close - open)
upW = high - math.max(open, close)
loW = math.min(open, close) - low
d = rng > 0 and body <= 0.1 * rng and upW >= 0.6 * rng and loW <= 0.1 * rng
plotshape(d, "Gravestone Doji", shape.triangledown, location.abovebar, color.red, text="GD")`,
  long_legged_doji: `//@version=5
indicator("Long-Legged Doji", overlay=true)
rng = high - low
body = math.abs(close - open)
upW = high - math.max(open, close)
loW = math.min(open, close) - low
d = rng > 0 and body <= 0.1 * rng and upW >= 0.3 * rng and loW >= 0.3 * rng
plotshape(d, "Long-Legged Doji", shape.circle, location.abovebar, color.gray, size=size.tiny, text="LLD")`,
  hammer: `//@version=5
indicator("Hammer", overlay=true)
rng = high - low
body = math.abs(close - open)
upW = high - math.max(open, close)
loW = math.min(open, close) - low
down = close[1] < close[4]
h = rng > 0 and body >= 0.1 * rng and loW >= 2 * body and upW <= body and down
plotshape(h, "Hammer", shape.triangleup, location.belowbar, color.green, text="H")`,
  hanging_man: `//@version=5
indicator("Hanging Man", overlay=true)
rng = high - low
body = math.abs(close - open)
upW = high - math.max(open, close)
loW = math.min(open, close) - low
up = close[1] > close[4]
hm = rng > 0 and body >= 0.1 * rng and loW >= 2 * body and upW <= body and up
plotshape(hm, "Hanging Man", shape.triangledown, location.abovebar, color.red, text="HM")`,
  inverted_hammer: `//@version=5
indicator("Inverted Hammer", overlay=true)
rng = high - low
body = math.abs(close - open)
upW = high - math.max(open, close)
loW = math.min(open, close) - low
down = close[1] < close[4]
ih = rng > 0 and body >= 0.1 * rng and upW >= 2 * body and loW <= body and down
plotshape(ih, "Inverted Hammer", shape.triangleup, location.belowbar, color.green, text="IH")`,
  shooting_star: `//@version=5
indicator("Shooting Star", overlay=true)
rng = high - low
body = math.abs(close - open)
upW = high - math.max(open, close)
loW = math.min(open, close) - low
up = close[1] > close[4]
ss = rng > 0 and body >= 0.1 * rng and upW >= 2 * body and loW <= body and up
plotshape(ss, "Shooting Star", shape.triangledown, location.abovebar, color.red, text="SS")`,
  marubozu: `//@version=5
indicator("Marubozu", overlay=true)
rng = high - low
body = math.abs(close - open)
upW = high - math.max(open, close)
loW = math.min(open, close) - low
m = rng > 0 and upW <= 0.05 * rng and loW <= 0.05 * rng and body >= 0.9 * rng
plotshape(m, "Marubozu", shape.square, location.abovebar, color.gray, size=size.tiny, text="M")`,
  bullish_marubozu: `//@version=5
indicator("Bullish Marubozu", overlay=true)
rng = high - low
body = math.abs(close - open)
upW = high - math.max(open, close)
loW = math.min(open, close) - low
m = rng > 0 and upW <= 0.05 * rng and loW <= 0.05 * rng and body >= 0.9 * rng and close > open
plotshape(m, "Bullish Marubozu", shape.triangleup, location.belowbar, color.green, text="M+")`,
  bearish_marubozu: `//@version=5
indicator("Bearish Marubozu", overlay=true)
rng = high - low
body = math.abs(close - open)
upW = high - math.max(open, close)
loW = math.min(open, close) - low
m = rng > 0 and upW <= 0.05 * rng and loW <= 0.05 * rng and body >= 0.9 * rng and close < open
plotshape(m, "Bearish Marubozu", shape.triangledown, location.abovebar, color.red, text="M-")`,
  spinning_top: `//@version=5
indicator("Spinning Top", overlay=true)
rng = high - low
body = math.abs(close - open)
upW = high - math.max(open, close)
loW = math.min(open, close) - low
st = rng > 0 and body <= 0.3 * rng and body > 0.1 * rng and upW >= 0.2 * rng and loW >= 0.2 * rng
plotshape(st, "Spinning Top", shape.circle, location.abovebar, color.gray, size=size.tiny, text="ST")`,
  high_wave: `//@version=5
indicator("High Wave Candle", overlay=true)
rng = high - low
body = math.abs(close - open)
upW = high - math.max(open, close)
loW = math.min(open, close) - low
hw = rng > 0 and body <= 0.2 * rng and upW >= 0.4 * rng and loW >= 0.4 * rng
plotshape(hw, "High Wave", shape.circle, location.abovebar, color.gray, size=size.tiny, text="HW")`,
  long_bullish: `//@version=5
indicator("Long Bullish Candle", overlay=true)
rng = high - low
body = math.abs(close - open)
avg = ta.sma(math.abs(close - open), 10)[1]
lb = close > open and body >= 0.7 * rng and body >= 1.3 * avg
plotshape(lb, "Long Bullish", shape.triangleup, location.belowbar, color.green, text="LB")`,
  long_bearish: `//@version=5
indicator("Long Bearish Candle", overlay=true)
rng = high - low
body = math.abs(close - open)
avg = ta.sma(math.abs(close - open), 10)[1]
lr = close < open and body >= 0.7 * rng and body >= 1.3 * avg
plotshape(lr, "Long Bearish", shape.triangledown, location.abovebar, color.red, text="LR")`,

  bullish_engulfing: `//@version=5
indicator("Bullish Engulfing", overlay=true)
be = close[1] < open[1] and close > open and math.min(open, close) <= math.min(open[1], close[1]) and math.max(open, close) >= math.max(open[1], close[1]) and math.abs(close - open) > math.abs(close[1] - open[1])
plotshape(be, "Bullish Engulfing", shape.triangleup, location.belowbar, color.green, text="BE")`,
  bearish_engulfing: `//@version=5
indicator("Bearish Engulfing", overlay=true)
br = close[1] > open[1] and close < open and math.min(open, close) <= math.min(open[1], close[1]) and math.max(open, close) >= math.max(open[1], close[1]) and math.abs(close - open) > math.abs(close[1] - open[1])
plotshape(br, "Bearish Engulfing", shape.triangledown, location.abovebar, color.red, text="BR")`,
  piercing_line: `//@version=5
indicator("Piercing Line", overlay=true)
midp = (open[1] + close[1]) / 2
pl = close[1] < open[1] and close > open and open < low[1] and close > midp and close < open[1]
plotshape(pl, "Piercing Line", shape.triangleup, location.belowbar, color.green, text="PL")`,
  dark_cloud_cover: `//@version=5
indicator("Dark Cloud Cover", overlay=true)
midp = (open[1] + close[1]) / 2
dcc = close[1] > open[1] and close < open and open > high[1] and close < midp and close > open[1]
plotshape(dcc, "Dark Cloud Cover", shape.triangledown, location.abovebar, color.red, text="DCC")`,
  harami: `//@version=5
indicator("Harami", overlay=true)
bp = math.abs(close[1] - open[1])
bc = math.abs(close - open)
inside = math.max(open, close) <= math.max(open[1], close[1]) and math.min(open, close) >= math.min(open[1], close[1])
ha = bp > 0 and inside and bp >= 2 * bc and (close[1] > open[1]) != (close > open)
plotshape(ha, "Harami", shape.diamond, location.abovebar, color.gray, size=size.tiny, text="HA")`,
  bullish_harami: `//@version=5
indicator("Bullish Harami", overlay=true)
bp = math.abs(close[1] - open[1])
bc = math.abs(close - open)
inside = math.max(open, close) <= math.max(open[1], close[1]) and math.min(open, close) >= math.min(open[1], close[1])
down = close[2] < close[5]
ha = close[1] < open[1] and close > open and inside and bp >= 2 * bc and down
plotshape(ha, "Bullish Harami", shape.triangleup, location.belowbar, color.green, text="HA+")`,
  bearish_harami: `//@version=5
indicator("Bearish Harami", overlay=true)
bp = math.abs(close[1] - open[1])
bc = math.abs(close - open)
inside = math.max(open, close) <= math.max(open[1], close[1]) and math.min(open, close) >= math.min(open[1], close[1])
up = close[2] > close[5]
ha = close[1] > open[1] and close < open and inside and bp >= 2 * bc and up
plotshape(ha, "Bearish Harami", shape.triangledown, location.abovebar, color.red, text="HA-")`,
  harami_cross: `//@version=5
indicator("Harami Cross", overlay=true)
bp = math.abs(close[1] - open[1])
rngc = high - low
doji = rngc > 0 and math.abs(close - open) <= 0.1 * rngc
inside = math.max(open, close) <= math.max(open[1], close[1]) and math.min(open, close) >= math.min(open[1], close[1])
hc = bp > 0 and doji and inside and bp >= 2 * rngc
plotshape(hc, "Harami Cross", shape.diamond, location.abovebar, color.gray, size=size.tiny, text="HC")`,
  tweezer_top: `//@version=5
indicator("Tweezer Top", overlay=true)
tol = 0.1 * math.max(high[1] - low[1], high - low)
up = close[2] > close[5]
tt = close[1] > open[1] and close < open and math.abs(high[1] - high) <= tol and up
plotshape(tt, "Tweezer Top", shape.triangledown, location.abovebar, color.red, text="TT")`,
  tweezer_bottom: `//@version=5
indicator("Tweezer Bottom", overlay=true)
tol = 0.1 * math.max(high[1] - low[1], high - low)
down = close[2] < close[5]
tb = close[1] < open[1] and close > open and math.abs(low[1] - low) <= tol and down
plotshape(tb, "Tweezer Bottom", shape.triangleup, location.belowbar, color.green, text="TB")`,
  matching_low: `//@version=5
indicator("Matching Low", overlay=true)
tol = 0.1 * math.max(high[1] - low[1], high - low)
down = close[2] < close[5]
ml = close[1] < open[1] and close < open and math.abs(close[1] - close) <= tol and down
plotshape(ml, "Matching Low", shape.triangleup, location.belowbar, color.green, text="ML")`,
  matching_high: `//@version=5
indicator("Matching High", overlay=true)
tol = 0.1 * math.max(high[1] - low[1], high - low)
up = close[2] > close[5]
mh = close[1] > open[1] and close > open and math.abs(close[1] - close) <= tol and up
plotshape(mh, "Matching High", shape.triangledown, location.abovebar, color.red, text="MH")`,
  kicking: `//@version=5
indicator("Kicking", overlay=true)
maru(o, h, l, c) => (h - l) > 0 and (h - math.max(o, c)) <= 0.05 * (h - l) and (math.min(o, c) - l) <= 0.05 * (h - l) and math.abs(c - o) >= 0.9 * (h - l)
bullK = maru(open[1], high[1], low[1], close[1]) and close[1] < open[1] and maru(open, high, low, close) and close > open and low > high[1]
bearK = maru(open[1], high[1], low[1], close[1]) and close[1] > open[1] and maru(open, high, low, close) and close < open and high < low[1]
plotshape(bullK or bearK, "Kicking", shape.diamond, location.abovebar, color.gray, size=size.tiny, text="K")`,
  bullish_kicking: `//@version=5
indicator("Bullish Kicking", overlay=true)
maru(o, h, l, c) => (h - l) > 0 and (h - math.max(o, c)) <= 0.05 * (h - l) and (math.min(o, c) - l) <= 0.05 * (h - l) and math.abs(c - o) >= 0.9 * (h - l)
k = maru(open[1], high[1], low[1], close[1]) and close[1] < open[1] and maru(open, high, low, close) and close > open and low > high[1]
plotshape(k, "Bullish Kicking", shape.triangleup, location.belowbar, color.green, text="K+")`,
  bearish_kicking: `//@version=5
indicator("Bearish Kicking", overlay=true)
maru(o, h, l, c) => (h - l) > 0 and (h - math.max(o, c)) <= 0.05 * (h - l) and (math.min(o, c) - l) <= 0.05 * (h - l) and math.abs(c - o) >= 0.9 * (h - l)
k = maru(open[1], high[1], low[1], close[1]) and close[1] > open[1] and maru(open, high, low, close) and close < open and high < low[1]
plotshape(k, "Bearish Kicking", shape.triangledown, location.abovebar, color.red, text="K-")`,

  morning_star: `//@version=5
indicator("Morning Star", overlay=true)
ba = math.abs(close[2] - open[2])
bb = math.abs(close[1] - open[1])
mida = (open[2] + close[2]) / 2
down = close[3] < close[6]
ms = close[2] < open[2] and bb <= 0.5 * ba and math.max(open[1], close[1]) <= math.min(open[2], close[2]) + 0.05 * (high[2] - low[2]) and close > open and close > mida and down
plotshape(ms, "Morning Star", shape.triangleup, location.belowbar, color.green, text="MS")`,
  evening_star: `//@version=5
indicator("Evening Star", overlay=true)
ba = math.abs(close[2] - open[2])
bb = math.abs(close[1] - open[1])
mida = (open[2] + close[2]) / 2
up = close[3] > close[6]
es = close[2] > open[2] and bb <= 0.5 * ba and math.min(open[1], close[1]) >= math.max(open[2], close[2]) - 0.05 * (high[2] - low[2]) and close < open and close < mida and up
plotshape(es, "Evening Star", shape.triangledown, location.abovebar, color.red, text="ES")`,
  morning_doji_star: `//@version=5
indicator("Morning Doji Star", overlay=true)
rng1 = high[1] - low[1]
doji = rng1 > 0 and math.abs(close[1] - open[1]) <= 0.1 * rng1
mida = (open[2] + close[2]) / 2
down = close[3] < close[6]
mds = close[2] < open[2] and doji and math.max(open[1], close[1]) <= math.min(open[2], close[2]) + 0.05 * (high[2] - low[2]) and close > open and close > mida and down
plotshape(mds, "Morning Doji Star", shape.triangleup, location.belowbar, color.green, text="MDS")`,
  evening_doji_star: `//@version=5
indicator("Evening Doji Star", overlay=true)
rng1 = high[1] - low[1]
doji = rng1 > 0 and math.abs(close[1] - open[1]) <= 0.1 * rng1
mida = (open[2] + close[2]) / 2
up = close[3] > close[6]
eds = close[2] > open[2] and doji and math.min(open[1], close[1]) >= math.max(open[2], close[2]) - 0.05 * (high[2] - low[2]) and close < open and close < mida and up
plotshape(eds, "Evening Doji Star", shape.triangledown, location.abovebar, color.red, text="EDS")`,
  three_white_soldiers: `//@version=5
indicator("Three White Soldiers", overlay=true)
b1 = close > open
b2 = close[1] > open[1]
b3 = close[2] > open[2]
upW = high - math.max(open, close)
upW1 = high[1] - math.max(open[1], close[1])
tws = b1 and b2 and b3 and close[1] > close[2] and close > close[1] and open[1] > open[2] and open[1] < close[2] and open > open[1] and open < close[1] and upW1 <= 0.3 * math.abs(close[1] - open[1]) and upW <= 0.3 * math.abs(close - open)
plotshape(tws, "Three White Soldiers", shape.triangleup, location.belowbar, color.green, text="3WS")`,
  three_black_crows: `//@version=5
indicator("Three Black Crows", overlay=true)
s1 = close < open
s2 = close[1] < open[1]
s3 = close[2] < open[2]
loW = math.min(open, close) - low
loW1 = math.min(open[1], close[1]) - low[1]
tbc = s1 and s2 and s3 and close[1] < close[2] and close < close[1] and open[1] < open[2] and open[1] > close[2] and open < open[1] and open > close[1] and loW1 <= 0.3 * math.abs(close[1] - open[1]) and loW <= 0.3 * math.abs(close - open)
plotshape(tbc, "Three Black Crows", shape.triangledown, location.abovebar, color.red, text="3BC")`,
  three_inside_up: `//@version=5
indicator("Three Inside Up", overlay=true)
ba = math.abs(close[2] - open[2])
bb = math.abs(close[1] - open[1])
inside = math.max(open[1], close[1]) <= math.max(open[2], close[2]) and math.min(open[1], close[1]) >= math.min(open[2], close[2])
tiu = close[2] < open[2] and close[1] > open[1] and inside and ba >= 2 * bb and close > open and close > open[2]
plotshape(tiu, "Three Inside Up", shape.triangleup, location.belowbar, color.green, text="3IU")`,
  three_inside_down: `//@version=5
indicator("Three Inside Down", overlay=true)
ba = math.abs(close[2] - open[2])
bb = math.abs(close[1] - open[1])
inside = math.max(open[1], close[1]) <= math.max(open[2], close[2]) and math.min(open[1], close[1]) >= math.min(open[2], close[2])
tid = close[2] > open[2] and close[1] < open[1] and inside and ba >= 2 * bb and close < open and close < open[2]
plotshape(tid, "Three Inside Down", shape.triangledown, location.abovebar, color.red, text="3ID")`,
  three_outside_up: `//@version=5
indicator("Three Outside Up", overlay=true)
ba = math.abs(close[2] - open[2])
bb = math.abs(close[1] - open[1])
engulf = math.min(open[1], close[1]) <= math.min(open[2], close[2]) and math.max(open[1], close[1]) >= math.max(open[2], close[2])
tou = close[2] < open[2] and close[1] > open[1] and engulf and bb > ba and close > open and close > close[1]
plotshape(tou, "Three Outside Up", shape.triangleup, location.belowbar, color.green, text="3OU")`,
  three_outside_down: `//@version=5
indicator("Three Outside Down", overlay=true)
ba = math.abs(close[2] - open[2])
bb = math.abs(close[1] - open[1])
engulf = math.min(open[1], close[1]) <= math.min(open[2], close[2]) and math.max(open[1], close[1]) >= math.max(open[2], close[2])
tod = close[2] > open[2] and close[1] < open[1] and engulf and bb > ba and close < open and close < close[1]
plotshape(tod, "Three Outside Down", shape.triangledown, location.abovebar, color.red, text="3OD")`,
  three_stars_south: `//@version=5
indicator("Three Stars in the South", overlay=true)
ba = math.abs(close[2] - open[2])
bb = math.abs(close[1] - open[1])
bc = math.abs(close - open)
loWa = math.min(open[2], close[2]) - low[2]
down = close[3] < close[6]
tss = down and close[2] < open[2] and close[1] < open[1] and close < open and ba > bb and bb >= bc and low[1] >= low[2] and low >= low[1] and loWa >= ba
plotshape(tss, "Three Stars South", shape.triangleup, location.belowbar, color.green, text="3SS")`,
  upside_gap_two_crows: `//@version=5
indicator("Upside Gap Two Crows", overlay=true)
up = close[3] > close[6]
ugc = up and close[2] > open[2] and close[1] < open[1] and math.min(open[1], close[1]) > close[2] and close < open and open > open[1] and close < close[1] and close > close[2]
plotshape(ugc, "Upside Gap Two Crows", shape.triangledown, location.abovebar, color.red, text="UGC")`,
  unique_three_river: `//@version=5
indicator("Unique Three River", overlay=true)
bb = math.abs(close[1] - open[1])
bc = math.abs(close - open)
loW1 = math.min(open[1], close[1]) - low[1]
down = close[3] < close[6]
u3r = down and close[2] < open[2] and close[1] < open[1] and low[1] < low[2] and math.min(open[1], close[1]) <= math.min(open[2], close[2]) and loW1 >= bb and close > open and close < close[1] and bc < bb
plotshape(u3r, "Unique Three River", shape.triangleup, location.belowbar, color.green, text="U3R")`,
  abandoned_baby: `//@version=5
indicator("Abandoned Baby", overlay=true)
rng1 = high[1] - low[1]
doji = rng1 > 0 and math.abs(close[1] - open[1]) <= 0.1 * rng1
bullAB = close[2] < open[2] and doji and high[1] < low[2] and close > open and low > high[1]
bearAB = close[2] > open[2] and doji and low[1] > high[2] and close < open and high < low[1]
plotshape(bullAB or bearAB, "Abandoned Baby", shape.diamond, location.abovebar, color.gray, size=size.tiny, text="AB")`,
  bullish_abandoned_baby: `//@version=5
indicator("Bullish Abandoned Baby", overlay=true)
rng1 = high[1] - low[1]
doji = rng1 > 0 and math.abs(close[1] - open[1]) <= 0.1 * rng1
down = close[3] < close[6]
ab = close[2] < open[2] and doji and high[1] < low[2] and close > open and low > high[1] and down
plotshape(ab, "Bullish Abandoned Baby", shape.triangleup, location.belowbar, color.green, text="AB+")`,
  bearish_abandoned_baby: `//@version=5
indicator("Bearish Abandoned Baby", overlay=true)
rng1 = high[1] - low[1]
doji = rng1 > 0 and math.abs(close[1] - open[1]) <= 0.1 * rng1
up = close[3] > close[6]
ab = close[2] > open[2] and doji and low[1] > high[2] and close < open and high < low[1] and up
plotshape(ab, "Bearish Abandoned Baby", shape.triangledown, location.abovebar, color.red, text="AB-")`,
  stick_sandwich: `//@version=5
indicator("Stick Sandwich", overlay=true)
tol = 0.1 * math.max(high[2] - low[2], high - low)
down = close[3] < close[6]
sw = close[2] < open[2] and close[1] > open[1] and close < open and math.abs(close[2] - close) <= tol and down
plotshape(sw, "Stick Sandwich", shape.triangleup, location.belowbar, color.green, text="SW")`,

  three_line_strike: `//@version=5
indicator("Three-Line Strike", overlay=true)
upTrend = close[3] > open[3] and close[2] > open[2] and close[1] > open[1] and close[2] > close[3] and close[1] > close[2] and close < open and open >= close[1] and close < open[3]
dnTrend = close[3] < open[3] and close[2] < open[2] and close[1] < open[1] and close[2] < close[3] and close[1] < close[2] and close > open and open <= close[1] and close > open[3]
plotshape(upTrend or dnTrend, "Three-Line Strike", shape.diamond, location.abovebar, color.gray, size=size.tiny, text="3LS")`,
  rising_three_methods: `//@version=5
indicator("Rising Three Methods", overlay=true)
ba = math.abs(close[4] - open[4])
avg = ta.sma(math.abs(close - open), 10)[5]
hi = math.max(high[3], high[2], high[1])
lo = math.min(low[3], low[2], low[1])
r3m = close[4] > open[4] and ba >= 1.2 * avg and close[3] < open[3] and close[2] < open[2] and close[1] < open[1] and hi <= high[4] and lo >= low[4] and close > open and close > close[4]
plotshape(r3m, "Rising Three Methods", shape.triangleup, location.belowbar, color.green, text="R3M")`,
  falling_three_methods: `//@version=5
indicator("Falling Three Methods", overlay=true)
ba = math.abs(close[4] - open[4])
avg = ta.sma(math.abs(close - open), 10)[5]
hi = math.max(high[3], high[2], high[1])
lo = math.min(low[3], low[2], low[1])
f3m = close[4] < open[4] and ba >= 1.2 * avg and close[3] > open[3] and close[2] > open[2] and close[1] > open[1] and hi <= high[4] and lo >= low[4] and close < open and close < close[4]
plotshape(f3m, "Falling Three Methods", shape.triangledown, location.abovebar, color.red, text="F3M")`,
}
