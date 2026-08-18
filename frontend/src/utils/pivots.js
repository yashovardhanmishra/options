/**
 * SPH / SPL / LPH / LPL market-structure pivots.
 *
 * A 1:1 port of the user's Pine v6 indicator ("SPH / SPL / LPH / LPL Pivots").
 * The Pine runs bar-by-bar on confirmed bars; this replays the identical state
 * machine over the candle array, so the marks match the TradingView script.
 *
 * SMALL pivots — trigger candle T, then TWO confirmations:
 *   bar1 = the very next candle: close < T.close AND low  < T.low   (SPH)
 *   bar2 = within `win` candles after bar1: same test again
 *   SPH  = the HIGHEST high between the previous pivot and this completion.
 *   SPL  = the mirror (close > T.close AND high > T.high; LOWEST low).
 *   SPH and SPL strictly alternate, and one candle carries at most ONE of them
 *   (the search span starts the bar AFTER the previous pivot).
 *
 * LARGE pivots — chosen from the marked small pivots, so an LPL always lands on
 * an SPL and an LPH on an SPH:
 *   close ABOVE the most recent SPH → LPL = the LOWEST SPL since the last LPH.
 *   close BELOW the most recent SPL → LPH = the HIGHEST SPH since the last LPL.
 *   A live LPH keeps MIGRATING onto any higher SPH that confirms before the next
 *   LPL locks it (mirror for LPL) — at break time the leg's top SPH often has not
 *   confirmed yet, and without this the LPH sticks to a lower SPH.
 *
 * Pure + O(n·win): safe to call on every resample. Returns bar INDICES; the
 * caller maps them to candle times.
 */

/**
 * @param {Array<{high:number,low:number,close:number}>} candles
 * @param {number} win  bar2 must appear within N candles after bar1 (Pine default 3)
 * @returns {{smalls: Array<{bar:number,val:number,side:1|-1}>,
 *            larges: Array<{bar:number,val:number,side:1|-1}>}}
 *          side: 1 = high (SPH/LPH), -1 = low (SPL/LPL)
 */
export function computePivots(candles, win = 3) {
  const out = { smalls: [], larges: [] }
  if (!Array.isArray(candles) || candles.length < 3) return out
  const n = candles.length
  const W = Math.max(1, Math.min(10, Math.round(win) || 3))

  // pivot store (mirrors the Pine arrays)
  const pSide = []
  const pBar = []
  const pVal = []

  let lastSph = -1 // index into the pivot store of the most recent SPH / SPL
  let lastSpl = -1
  let anchorIdx = 0 // first pivot eligible for the next large pivot
  let lastLarge = 0 // -1 = last large was LPL, 1 = LPH, 0 = none
  let lastFire = -1 // bar index that confirmed the previous small pivot

  // the live large pivot — it keeps following a better small pivot until the
  // opposite large pivot locks it. `lgRec` is the emitted record we mutate.
  let lgSide = 0
  let lgVal = 0
  let lgRec = null

  for (let i = 0; i < n; i++) {
    const c = candles[i]
    const nPiv = pSide.length
    // after an SPL (or at the very start) we look for an SPH, and vice versa
    const seekSPH = nPiv === 0 || pSide[nPiv - 1] === -1

    // ---------------------- small pivots ----------------------------
    // trigger at t, bar1 at t+1 (consecutive), bar2 = this candle,
    // 1..W candles after bar1 → k = 2 .. W+1. The loop ascends and keeps
    // overwriting, so the LARGEST k (earliest valid trigger) wins — as in Pine.
    let fireK = 0
    for (let k = 2; k <= W + 1; k++) {
      const t = i - k
      // t >= lastFire (not >): the candle that CONFIRMED the previous pivot may
      // itself be the next pattern's trigger — it usually is the turning candle.
      if (t >= lastFire && t >= 0) {
        const T = candles[t]
        const b1 = candles[t + 1]
        const ok1 = seekSPH
          ? b1.close < T.close && b1.low < T.low
          : b1.close > T.close && b1.high > T.high
        const ok2 = seekSPH
          ? c.close < T.close && c.low < T.low
          : c.close > T.close && c.high > T.high
        if (ok1 && ok2) fireK = k
      }
    }

    if (fireK > 0) {
      // the span starts the bar AFTER the previous pivot, so one candle can
      // never carry both an SPH and an SPL
      const fromIdx = nPiv > 0 ? Math.min(pBar[nPiv - 1] + 1, i) : i - fireK
      let bestV = seekSPH ? candles[fromIdx].high : candles[fromIdx].low
      let bestB = fromIdx
      for (let j = fromIdx; j <= i; j++) {
        const x = seekSPH ? candles[j].high : candles[j].low
        if (seekSPH ? x > bestV : x < bestV) {
          bestV = x
          bestB = j
        }
      }
      pSide.push(seekSPH ? 1 : -1)
      pBar.push(bestB)
      pVal.push(bestV)
      out.smalls.push({ bar: bestB, val: bestV, side: seekSPH ? 1 : -1 })
      if (seekSPH) lastSph = pSide.length - 1
      else lastSpl = pSide.length - 1
      lastFire = i

      // ---- the live large pivot migrates onto this better small pivot ----
      if (lgSide === 1 && seekSPH && bestV > lgVal) {
        lgVal = bestV
        anchorIdx = pSide.length
        if (lgRec) {
          lgRec.bar = bestB
          lgRec.val = bestV
        }
      }
      if (lgSide === -1 && !seekSPH && bestV < lgVal) {
        lgVal = bestV
        anchorIdx = pSide.length
        if (lgRec) {
          lgRec.bar = bestB
          lgRec.val = bestV
        }
      }
    }

    // ---------------------- large pivots ----------------------------
    // close above the most recent SPH → LPL = the LOWEST SPL since the last LPH
    if (lastSph >= 0 && lastLarge !== -1 && c.close > pVal[lastSph]) {
      let best = -1
      for (let j = anchorIdx; j <= pSide.length - 1; j++) {
        if (pSide[j] === -1 && (best < 0 || pVal[j] < pVal[best])) best = j
      }
      if (best >= 0) {
        const rec = { bar: pBar[best], val: pVal[best], side: -1 }
        out.larges.push(rec)
        lastLarge = -1
        anchorIdx = best + 1
        lgSide = -1
        lgVal = pVal[best]
        lgRec = rec
      }
    }

    // close below the most recent SPL → LPH = the HIGHEST SPH since the last LPL
    if (lastSpl >= 0 && lastLarge !== 1 && c.close < pVal[lastSpl]) {
      let best2 = -1
      for (let j = anchorIdx; j <= pSide.length - 1; j++) {
        if (pSide[j] === 1 && (best2 < 0 || pVal[j] > pVal[best2])) best2 = j
      }
      if (best2 >= 0) {
        const rec = { bar: pBar[best2], val: pVal[best2], side: 1 }
        out.larges.push(rec)
        lastLarge = 1
        anchorIdx = best2 + 1
        lgSide = 1
        lgVal = pVal[best2]
        lgRec = rec
      }
    }
  }

  return out
}

/** Colours match the Pine defaults (highs red, lows teal). */
export const PIVOT_COLORS = { high: '#ef5350', low: '#26a69a' }

/**
 * lightweight-charts markers for the four pivot kinds. Small pivots sit tight to
 * the candle; large pivots use the bigger arrow shape so they read at a glance.
 * @param {Array<{time:number}>} candles
 */
export function pivotMarkers(candles, { win = 3, small = true, large = true } = {}) {
  const { smalls, larges } = computePivots(candles, win)
  const marks = []
  if (small) {
    for (const p of smalls) {
      const c = candles[p.bar]
      if (!c) continue
      marks.push(
        p.side === 1
          ? { time: c.time, position: 'aboveBar', color: PIVOT_COLORS.high, shape: 'circle', text: 'SPH' }
          : { time: c.time, position: 'belowBar', color: PIVOT_COLORS.low, shape: 'circle', text: 'SPL' },
      )
    }
  }
  if (large) {
    for (const p of larges) {
      const c = candles[p.bar]
      if (!c) continue
      marks.push(
        p.side === 1
          ? { time: c.time, position: 'aboveBar', color: PIVOT_COLORS.high, shape: 'arrowDown', text: 'LPH' }
          : { time: c.time, position: 'belowBar', color: PIVOT_COLORS.low, shape: 'arrowUp', text: 'LPL' },
      )
    }
  }
  marks.sort((a, b) => a.time - b.time)
  return marks
}

/** The authentic TradingView Pine v6 source this port mirrors (shown by the `{ }` viewer). */
export const PIVOT_PINE = `//@version=6
indicator("SPH / SPL / LPH / LPL Pivots", "Pivots", overlay = true, max_labels_count = 500, max_lines_count = 500)

// ─────────────────────────────────────────────────────────────────────────────
// SPH  trigger candle T
//      bar1 = the very next candle: close < T.close AND low < T.low
//      bar2 = within 3 candles after bar1: close < T.close AND low < T.low
//      SPH = highest high between the recent SPL and this completion.
// SPL  mirror: bar1/bar2 with close > T.close AND high > T.high
//      SPL = lowest low between the recent SPH and this completion.
//      SPH and SPL strictly alternate, and one candle carries at most ONE of
//      them (the search span starts the bar after the previous pivot).
//
// LPL  a candle CLOSES above the most recent SPH  → the LOWEST SPL formed since
//      the most recent LPH becomes the LPL.
// LPH  a candle CLOSES below the most recent SPL  → the HIGHEST SPH formed since
//      the most recent LPL becomes the LPH.
//      Large pivots are chosen from the marked small pivots, so an LPL always
//      lands exactly on an SPL and an LPH exactly on an SPH.
//      A live LPH keeps MOVING onto any higher SPH that confirms before the next
//      LPL locks it (mirror for LPL).
//
// HOW FAR BACK THE MARKS GO — a TradingView limit, not a detection limit:
//   labels, lines and boxes are capped at 500 objects EACH (500 is the platform
//   maximum), and Pine v6 removed dynamic plot offsets, so a plot cannot be put
//   back on the pivot candle. Therefore:
//     • the ▾▴ triangles are plots — UNLIMITED, every signal in all history is
//       marked, on the candle that CONFIRMED it;
//     • SPH/SPL/LPH/LPL text labels are drawing objects — only the newest 500
//       survive. Set "Labels" to "Large pivots only" to spend that budget on
//       LPH/LPL and push the labelled structure back many years;
//     • the zigzag uses lines (also newest 500) so older swings still read
//       visually after their labels have been dropped by the platform.
//
// Verified against a Python twin on 4 years of Nifty 5-min data (74,604 bars):
// 14,028 small + 2,790 large pivots; SPH↔SPL and LPL↔LPH alternation exact;
// ZERO candles carrying two pivots; every large pivot sits on a small pivot;
// every small pivot is the true extreme of its leg; truncated re-runs reproduce
// every locked mark identically (no lookahead).
// ─────────────────────────────────────────────────────────────────────────────

// ============================== Inputs ==============================
gR = "Rules"
gV = "Display"

win = input.int(3, "bar2 appears within N candles after bar1", minval = 1, maxval = 10, group = gR)

lblMode   = input.string("All pivots", "Labels (newest 500 only — TradingView limit)", options = ["All pivots", "Large pivots only", "None"], group = gV)
showMarks = input.bool(true,  "Triangles on the confirming candle (unlimited)", group = gV)
showZig   = input.bool(true,  "Zigzag between pivots (newest 500)", group = gV)
showLvls  = input.bool(true,  "Dotted line on the live SPH / SPL", group = gV)
colHi     = input.color(color.red,  "Highs", group = gV)
colLo     = input.color(color.teal, "Lows",  group = gV)

showSmall = lblMode == "All pivots"
showLarge = lblMode != "None"

// large-pivot tags sit just outside the candle so they never cover the small tag
offPx = nz(ta.atr(14), ta.tr(true)) * 0.6

// ==================== Bar history (index == bar_index) ==============
var hiA = array.new<float>()
var loA = array.new<float>()
var clA = array.new<float>()

// ============================ Pivot store ===========================
var pSide = array.new<int>()      // 1 = SPH, -1 = SPL
var pBar  = array.new<int>()
var pVal  = array.new<float>()

var int lastSph   = -1            // index of the most recent SPH / SPL
var int lastSpl   = -1
var int anchorIdx = 0             // first pivot eligible for the next large pivot
var int lastLarge = 0             // -1 = last large was LPL, 1 = LPH, 0 = none
var int lastFire  = -1

var line  sphLine = na            // only the LIVE levels keep a line — the old
var line  splLine = na            // ones are deleted so the budget goes to the zigzag
var bool  sphOpen = false
var bool  splOpen = false

// the live large pivot — it keeps following a better small pivot until the
// opposite large pivot locks it
var label lgLbl  = na
var int   lgSide = 0              // 1 = an LPH is live, -1 = an LPL is live
var float lgVal  = 0.0

bool sphNow = false
bool splNow = false
bool lplNow = false
bool lphNow = false

if barstate.isconfirmed
    array.push(hiA, high)
    array.push(loA, low)
    array.push(clA, close)

    int  nPiv    = array.size(pSide)
    bool seekSPH = nPiv == 0 or array.get(pSide, nPiv - 1) == -1

    // ---------------------- small pivots ----------------------------
    // trigger at t, bar1 at t+1 (consecutive), bar2 = this candle,
    // 1..win candles after bar1  →  k = 2 .. win+1
    int fireK = 0
    for k = 2 to win + 1
        int t = bar_index - k
        // t >= lastFire (not >): the candle that CONFIRMED the previous pivot is
        // allowed to be the next pattern's trigger candle — it usually is the
        // turning candle, and excluding it silently dropped valid setups
        if t >= lastFire and t >= 0
            float tHi = array.get(hiA, t)
            float tLo = array.get(loA, t)
            float tCl = array.get(clA, t)
            float b1H = array.get(hiA, t + 1)
            float b1L = array.get(loA, t + 1)
            float b1C = array.get(clA, t + 1)
            bool ok1 = seekSPH ? (b1C < tCl and b1L < tLo) : (b1C > tCl and b1H > tHi)
            bool ok2 = seekSPH ? (close < tCl and low < tLo) : (close > tCl and high > tHi)
            if ok1 and ok2
                fireK := k                    // largest k → earliest valid trigger

    if fireK > 0
        // the span starts the bar AFTER the previous pivot, so one candle can
        // never carry both an SPH and an SPL
        int fromIdx = nPiv > 0 ? math.min(array.get(pBar, nPiv - 1) + 1, bar_index) : bar_index - fireK
        float bestV = seekSPH ? array.get(hiA, fromIdx) : array.get(loA, fromIdx)
        int   bestB = fromIdx
        for j = fromIdx to bar_index
            float x = seekSPH ? array.get(hiA, j) : array.get(loA, j)
            if seekSPH ? x > bestV : x < bestV
                bestV := x
                bestB := j
        if showZig and nPiv > 0
            line.new(array.get(pBar, nPiv - 1), array.get(pVal, nPiv - 1), bestB, bestV, color = color.new(color.gray, 25), width = 1)
        array.push(pSide, seekSPH ? 1 : -1)
        array.push(pBar, bestB)
        array.push(pVal, bestV)
        if showSmall
            if seekSPH
                label.new(bestB, bestV, "SPH", style = label.style_label_down, color = color.new(colHi, 35), textcolor = color.white, size = size.small)
            else
                label.new(bestB, bestV, "SPL", style = label.style_label_up, color = color.new(colLo, 35), textcolor = color.white, size = size.small)
        if seekSPH
            lastSph := array.size(pSide) - 1
            sphOpen := true
            sphNow  := true
            if showLvls
                if not na(sphLine)
                    line.delete(sphLine)      // keep only the live level line
                sphLine := line.new(bestB, bestV, bar_index, bestV, color = colHi, style = line.style_dotted)
        else
            lastSpl := array.size(pSide) - 1
            splOpen := true
            splNow  := true
            if showLvls
                if not na(splLine)
                    line.delete(splLine)
                splLine := line.new(bestB, bestV, bar_index, bestV, color = colLo, style = line.style_dotted)
        lastFire := bar_index
        // ---- the live large pivot migrates to this better small pivot ----
        // An LPH must end on the HIGHEST SPH of its leg. At break time the leg's
        // top SPH may not have confirmed yet (its bar2 lands later), so when a
        // higher SPH does confirm, the LPH moves onto it. Mirror for LPL.
        if lgSide == 1 and seekSPH and bestV > lgVal
            lgVal     := bestV
            anchorIdx := array.size(pSide)
            if not na(lgLbl)
                label.set_xy(lgLbl, bestB, bestV + offPx)
        if lgSide == -1 and not seekSPH and bestV < lgVal
            lgVal     := bestV
            anchorIdx := array.size(pSide)
            if not na(lgLbl)
                label.set_xy(lgLbl, bestB, bestV - offPx)

    // ---------------------- large pivots ----------------------------
    // close above the most recent SPH → LPL = the LOWEST SPL since the last LPH
    if lastSph >= 0 and lastLarge != -1 and close > array.get(pVal, lastSph)
        int best = -1
        if anchorIdx <= array.size(pSide) - 1
            for j = anchorIdx to array.size(pSide) - 1
                if array.get(pSide, j) == -1
                    if best < 0 or array.get(pVal, j) < array.get(pVal, best)
                        best := j
        if best >= 0
            if showLarge
                lgLbl := label.new(array.get(pBar, best), array.get(pVal, best) - offPx, "LPL", style = label.style_label_up, color = colLo, textcolor = color.white, size = size.normal)
            lastLarge := -1
            anchorIdx := best + 1
            lgSide    := -1                    // this LPL is now live and can migrate
            lgVal     := array.get(pVal, best)
            lplNow    := true
        sphOpen := false

    // close below the most recent SPL → LPH = the HIGHEST SPH since the last LPL
    if lastSpl >= 0 and lastLarge != 1 and close < array.get(pVal, lastSpl)
        int best2 = -1
        if anchorIdx <= array.size(pSide) - 1
            for j = anchorIdx to array.size(pSide) - 1
                if array.get(pSide, j) == 1
                    if best2 < 0 or array.get(pVal, j) > array.get(pVal, best2)
                        best2 := j
        if best2 >= 0
            if showLarge
                lgLbl := label.new(array.get(pBar, best2), array.get(pVal, best2) + offPx, "LPH", style = label.style_label_down, color = colHi, textcolor = color.white, size = size.normal)
            lastLarge := 1
            anchorIdx := best2 + 1
            lgSide    := 1                     // this LPH is now live and can migrate
            lgVal     := array.get(pVal, best2)
            lphNow    := true
        splOpen := false

    // ------------- keep the live level lines growing -----------------
    if sphOpen and not na(sphLine)
        line.set_x2(sphLine, bar_index)
    if splOpen and not na(splLine)
        line.set_x2(splLine, bar_index)

// ===== Unlimited audit trail: every signal, all history, on its confirm bar ===
plotchar(showMarks and sphNow, "SPH fired", "▾", location.abovebar, colHi, size = size.tiny)
plotchar(showMarks and splNow, "SPL fired", "▴", location.belowbar, colLo, size = size.tiny)
plotchar(showMarks and lplNow, "LPL fired", "▲", location.belowbar, colLo, size = size.tiny)
plotchar(showMarks and lphNow, "LPH fired", "▼", location.abovebar, colHi, size = size.tiny)

// ============================ Alerts ================================
alertcondition(sphNow, "New SPH", "Small Pivot High")
alertcondition(splNow, "New SPL", "Small Pivot Low")
alertcondition(lplNow, "New LPL", "Large Pivot Low")
alertcondition(lphNow, "New LPH", "Large Pivot High")`
