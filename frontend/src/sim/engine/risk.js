// Greeks-based limit evaluation. PURE — it only DECIDES; the orchestrator applies
// the auto-square-off action (built in a later step). Compares |aggregate greek|
// against each limit; a null/undefined limit means that metric is disabled.
const METRICS = ['delta', 'gamma', 'vega', 'theta']

/**
 * checkLimits(greeks, limits, warnPct) ->
 *   { breaches:[{metric,value,limit}], warnings:[{metric,value,limit,pct}], breached }
 * limits: { delta?, gamma?, vega?, theta? } each a positive max |value| (or null = off).
 */
export function checkLimits(greeks, limits = {}, warnPct = 0.8) {
  const breaches = []
  const warnings = []
  for (const m of METRICS) {
    const lim = limits[m]
    if (lim == null) continue
    const signed = greeks[m] ?? 0
    const val = Math.abs(signed)
    if (val > lim) breaches.push({ metric: m, value: signed, limit: lim })
    else if (val >= warnPct * lim) warnings.push({ metric: m, value: signed, limit: lim, pct: val / lim })
  }
  return { breaches, warnings, breached: breaches.length > 0 }
}

export { METRICS }

/**
 * P&L-based auto-exit decision (stop-loss / target / trailing) on the total book MTM.
 * PURE: given the current total P&L and the running peak, decide whether to square off.
 *   pnl: { maxLoss?, target?, trailing? } — all ₹ amounts; null/0 = that rule is off.
 *   - target:   exit when total >= target            (lock the profit)
 *   - maxLoss:  exit when total <= -maxLoss          (cap the loss)
 *   - trailing: arms once peak >= trailing, then exit when (peak - total) >= trailing
 * Returns { exit, reason } with reason 'target' | 'stop_loss' | 'trailing_stop'.
 */
export function checkPnlExit(total, peak, pnl = {}) {
  const { maxLoss, target, trailing } = pnl
  if (target != null && target > 0 && total >= target) return { exit: true, reason: 'target' }
  if (maxLoss != null && maxLoss > 0 && total <= -maxLoss) return { exit: true, reason: 'stop_loss' }
  if (trailing != null && trailing > 0 && peak >= trailing && peak - total >= trailing)
    return { exit: true, reason: 'trailing_stop' }
  return { exit: false, reason: null }
}
