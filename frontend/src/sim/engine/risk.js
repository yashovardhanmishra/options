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
