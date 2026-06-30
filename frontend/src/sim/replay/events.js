// Notable-moment detection over the replay timeline, powering the "Jump to" chips:
// biggest spot moves (abs / up / down), the equity-curve max-drawdown trough, MTM peak /
// low, and the expiry-day open. PURE single-pass — fed an aligned spot-closes array
// (index ↔ timeline.times) and the FULL equity curve. Curve-derived events are hidden until
// the user has trades; overnight (session-boundary) deltas are skipped for spot moves.

/**
 * @param {object} a
 * @param {Array<number|null>} a.spots   spot close per timeline index (null before first bar / on holes)
 * @param {Array|null} a.curve           fullRun.curve = [{ index, t, realized, unrealized, equity }] (FULL, not clock-sliced)
 * @param {Array} a.sessions             timeline.sessions = [{ date, startIndex, endIndex, ... }]
 * @param {string|null} a.expiry         loaded expiry 'YYYY-MM-DD'
 * @returns {Array<{ key, label, index, detail }>} display-ordered
 */
export function detectEvents({ spots = [], curve = null, sessions = [], expiry = null } = {}) {
  const out = []
  const starts = new Set(sessions.map((s) => s.startIndex))

  // 1) biggest spot moves — skip session-start indices (overnight gaps) and missing bars.
  let idxAbs = -1,
    dAbs = 0,
    idxUp = -1,
    dUp = 0,
    idxDown = -1,
    dDown = 0
  for (let i = 1; i < spots.length; i++) {
    if (starts.has(i)) continue
    const a = spots[i - 1]
    const b = spots[i]
    if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) continue
    const d = b - a
    if (Math.abs(d) > dAbs) {
      dAbs = Math.abs(d)
      idxAbs = i
    }
    if (d > dUp) {
      dUp = d
      idxUp = i
    }
    if (d < dDown) {
      dDown = d
      idxDown = i
    }
  }
  if (idxAbs >= 0) {
    const delta = spots[idxAbs] - spots[idxAbs - 1]
    out.push({ key: 'spot_move', label: 'Biggest move', index: idxAbs, detail: { delta, pct: (delta / spots[idxAbs - 1]) * 100 } })
  }
  if (idxUp >= 0 && dUp > 0 && idxUp !== idxAbs) out.push({ key: 'spot_up', label: 'Biggest up', index: idxUp, detail: { delta: dUp } })
  if (idxDown >= 0 && dDown < 0 && idxDown !== idxAbs) out.push({ key: 'spot_down', label: 'Biggest down', index: idxDown, detail: { delta: dDown } })

  // 2)+3) equity-curve events — only meaningful once the user has trades.
  const hasTrades = Array.isArray(curve) && curve.some((p) => p.realized !== 0 || p.unrealized !== 0)
  if (hasTrades) {
    let peak = -Infinity,
      peakIdx = 0,
      worstDrop = 0,
      troughIdx = -1,
      ddPeakIdx = 0,
      maxEq = -Infinity,
      idxMaxEq = -1,
      minEq = Infinity,
      idxMinEq = -1
    for (const p of curve) {
      if (p.equity > peak) {
        peak = p.equity
        peakIdx = p.index
      }
      const drop = peak - p.equity
      if (drop > worstDrop) {
        worstDrop = drop
        troughIdx = p.index
        ddPeakIdx = peakIdx
      }
      if (p.equity > maxEq) {
        maxEq = p.equity
        idxMaxEq = p.index
      }
      if (p.equity < minEq) {
        minEq = p.equity
        idxMinEq = p.index
      }
    }
    if (worstDrop > 0 && troughIdx >= 0) out.push({ key: 'dd_trough', label: 'Max drawdown', index: troughIdx, detail: { drawdown: -worstDrop, peakIndex: ddPeakIdx } })
    if (maxEq > 0 && idxMaxEq >= 0) out.push({ key: 'mtm_peak', label: 'Peak MTM', index: idxMaxEq, detail: { equity: maxEq } })
    if (minEq < 0 && idxMinEq >= 0) out.push({ key: 'mtm_low', label: 'Worst MTM', index: idxMinEq, detail: { equity: minEq } })
  }

  // 4) expiry-day open — only when more than one day is loaded (else the whole replay IS it).
  if (expiry && sessions.length > 1) {
    const s = sessions.find((x) => x.date === expiry)
    if (s) out.push({ key: 'expiry_start', label: 'Expiry day', index: s.startIndex, detail: { date: expiry } })
  }

  const ORDER = { spot_move: 0, spot_up: 1, spot_down: 2, dd_trough: 3, mtm_peak: 4, mtm_low: 5, expiry_start: 6 }
  return out.filter((e) => e.index >= 0).sort((a, b) => ORDER[a.key] - ORDER[b.key])
}
