// EXACT money path. Uses STORED prices only — this file must NEVER import the
// Black-Scholes / Greeks model. Keeping the two paths in separate files is what
// guarantees P&L has no model drift while risk numbers stay model-derived.

/**
 * Realized/unrealized P&L of one leg, in rupees:
 *   (price_now − entry_price) × side × lot_size × lots
 * side = +1 long, −1 short. Exact to the input precision (no approximation).
 */
export function legPnl({ entryPrice, priceNow, side, lotSize, lots }) {
  return (priceNow - entryPrice) * side * lotSize * lots
}

/** Round to paisa (2 dp) for display / settlement reconciliation. */
export function roundPaisa(x) {
  return Math.round(x * 100) / 100
}
