/**
 * chartDrawings.js — PURE model + math for the chart's drawing/annotation toolbar.
 * NO React / DOM / lightweight-charts imports. Ported verbatim from StratosAI's
 * backtest/chartDrawings.ts (TypeScript annotations stripped; all math identical).
 * The chart layer (ChartDrawingLayer) wires these to LWC's coordinate APIs.
 *
 * COORDINATE MODEL: every drawing is anchored in DATA coords — { time, price } —
 * NOT pixels, so it tracks the chart on pan/zoom/resize. The chart's time axis is a discrete
 * (logical-index) axis, so we project time <-> a FRACTIONAL logical index here (continuous,
 * interpolated between bars, extrapolated past the ends) and let LWC map logical <-> x pixel.
 * This is display-only — it never touches the engine / backtest / strategy.
 *
 * NOTE: in this (options viewer) port, `time` is unix SECONDS (the chart's own unit), not ms —
 * the math is unit-agnostic (it only ever takes differences/ratios of `times[]` values), so the
 * port is byte-for-byte identical to the source.
 */

/** Fibonacci retracement levels (0 = the first anchor, 1 = the second). */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

const LINE_TYPES = ["trendline", "horizontal", "vertical", "ray"];
export const isLineType = (t) => LINE_TYPES.includes(t);
export function isPositionType(t) {
  return t === "long" || t === "short";
}

// ───────────────────────── time ↔ fractional logical index ─────────────────────────
// `times` = the candle time array (ascending). Returns a FRACTIONAL logical index:
// integer AT a bar, interpolated BETWEEN bars, extrapolated linearly BEYOND either end (so a
// drawing whose anchor is off-screen still projects to a sensible x). Robust to <2 candles.

export function timeToLogical(times, ms) {
  const n = times.length;
  if (n === 0) return 0;
  if (n === 1) return 0;
  if (ms <= times[0]) {
    const step = times[1] - times[0] || 1;
    return (ms - times[0]) / step;
  }
  if (ms >= times[n - 1]) {
    const step = times[n - 1] - times[n - 2] || 1;
    return n - 1 + (ms - times[n - 1]) / step;
  }
  // binary search for the bracketing bar: times[i] <= ms < times[i+1]
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= ms) lo = mid + 1;
    else hi = mid;
  }
  const i = lo - 1; // times[i] <= ms < times[i+1]
  const span = times[i + 1] - times[i] || 1;
  return i + (ms - times[i]) / span;
}

export function logicalToTime(times, logical) {
  const n = times.length;
  if (n === 0) return 0;
  if (n === 1) return times[0];
  if (logical <= 0) {
    const step = times[1] - times[0] || 1;
    return Math.round(times[0] + logical * step);
  }
  if (logical >= n - 1) {
    const step = times[n - 1] - times[n - 2] || 1;
    return Math.round(times[n - 1] + (logical - (n - 1)) * step);
  }
  const i = Math.floor(logical);
  const frac = logical - i;
  const span = times[i + 1] - times[i] || 1;
  return Math.round(times[i] + frac * span);
}

/** Shift an anchor time by `bars` candle steps in LOGICAL (bar-index) space, returning the new
 *  time. The chart's time axis COLLAPSES overnight/weekend gaps, so moving a drawing by a raw
 *  time delta skips a whole day the instant a drag crosses a day boundary. Converting to a logical
 *  index, shifting by whole bars, and converting back keeps a drawing moving candle-for-candle
 *  regardless of gaps. `bars` may be fractional; callers that want candle-snapped movement round it. */
export function shiftTimeByBars(times, t, bars) {
  return logicalToTime(times, timeToLogical(times, t) + bars);
}

// ───────────────────────── fractional logical index → x pixel (via LWC timeScale) ─────────────────────────
// LWC's `timeScale().logicalToCoordinate` maps only INTEGER bar indices in this build — it returns 0
// (or null) for ANY fractional logical. So a data point whose time falls BETWEEN bars, or an
// explicitly-fractional logical, would collapse to x=0 (the chart's LEFT edge). Bar spacing is
// uniform, so we floor the logical and linearly interpolate x between the two bracketing INTEGER
// bars (exact — this only ever calls `logicalToCoordinate` with integers, sidestepping the bug).
//
// `ts` is duck-typed to just `{ logicalToCoordinate }`. Returns null only when NEITHER bracketing
// bar has a coordinate; if one end is null it falls back to the other.
export function logicalToX(ts, lg) {
  const lo = Math.floor(lg);
  const frac = lg - lo;
  const xLo = ts.logicalToCoordinate(lo);
  if (frac === 0) return xLo;
  const xHi = ts.logicalToCoordinate(lo + 1);
  return xLo == null ? xHi : xHi == null ? xLo : xLo + (xHi - xLo) * frac;
}

// ───────────────────────── geometry / hit-testing (pixel space) ─────────────────────────

/** Distance from point (px,py) to the segment (ax,ay)-(bx,by). */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** True when (px,py) is within `tol` px of a rectangle's EDGE (selection by border, so the
 *  interior stays click-through). x1/y1/x2/y2 in any order. */
export function nearRectEdge(px, py, x1, y1, x2, y2, tol) {
  const lo_x = Math.min(x1, x2);
  const hi_x = Math.max(x1, x2);
  const lo_y = Math.min(y1, y2);
  const hi_y = Math.max(y1, y2);
  const onV =
    (Math.abs(px - lo_x) <= tol || Math.abs(px - hi_x) <= tol) && py >= lo_y - tol && py <= hi_y + tol;
  const onH =
    (Math.abs(py - lo_y) <= tol || Math.abs(py - hi_y) <= tol) && px >= lo_x - tol && px <= hi_x + tol;
  return onV || onH;
}

// ───────────────────────── position-tool stats (TradingView-style) ─────────────────────────

/** Compute the live readout for a long/short position tool. Pure price math. */
export function positionStats(p) {
  const move = p.entryPrice !== 0 ? ((p.targetPrice - p.entryPrice) / p.entryPrice) * 100 : 0;
  const rewardPct = p.direction === "long" ? move : -move;
  let riskPct = 0;
  let rr = null;
  if (p.stopPrice != null && Number.isFinite(p.stopPrice) && p.entryPrice !== 0) {
    const stopMove = ((p.stopPrice - p.entryPrice) / p.entryPrice) * 100;
    riskPct = p.direction === "long" ? -stopMove : stopMove;
    const reward = Math.abs(p.targetPrice - p.entryPrice);
    const risk = Math.abs(p.entryPrice - p.stopPrice);
    rr = risk > 0 ? reward / risk : null;
  }
  return {
    direction: p.direction,
    pctToTarget: move,
    rewardPct,
    riskPct,
    rr,
    bars: Math.abs(p.bars),
  };
}

/** A short, stable id for a new drawing. `seed` keeps it deterministic in tests (no Date/random). */
export function makeDrawingId(type, seed) {
  return `dw-${type}-${seed}`;
}

/** Build a default position box for the click-to-place flow: the entry anchor + a default
 *  target (±targetPct, default 2%), stop (∓stopPct, default 1%), and a right edge `defaultBars`
 *  candles out (so a single click yields a shaped box the user then drags). Pure. long → target
 *  ABOVE / stop BELOW; short → mirrored. */
export function makePositionDrawing(args) {
  const dir = args.type === "long" ? 1 : -1;
  const tPct = (args.targetPct ?? 2) / 100;
  const sPct = (args.stopPct ?? 1) / 100;
  const target = args.entry.price * (1 + dir * tPct);
  const stop = args.entry.price * (1 - dir * sPct);
  const bars = args.defaultBars ?? 12;
  const rightTime = logicalToTime(args.times, timeToLogical(args.times, args.entry.time) + bars);
  return {
    id: args.id,
    type: args.type,
    color: args.color,
    points: [args.entry, { time: rightTime, price: args.entry.price }],
    target,
    stop,
  };
}

/** Duration in (fractional) candles between a position's entry and its right edge. */
export function positionBars(times, entryTime, rightTime) {
  return timeToLogical(times, rightTime) - timeToLogical(times, entryTime);
}
