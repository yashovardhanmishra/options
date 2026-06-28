// Implied-vol inversion by BISECTION. BS price is strictly increasing in σ, so
// bisection is robust (no derivative needed, can't diverge). PURE.
import { bsPrice } from './bs.js'

/**
 * Solve σ ∈ [lo, hi] such that BS(S,K,T,r,σ,type) = price.
 * Returns { sigma, degenerate }.
 *   degenerate=true when price has no time value (≤ the σ→0 price floor): σ≈0 and
 *   the caller should treat Greeks as intrinsic (gamma/vega/theta → 0).
 */
export function impliedVol({ S, K, T, r, price, type, lo = 1e-4, hi = 5, iters = 100, tol = 1e-8 }) {
  if (T <= 0) return { sigma: 0, degenerate: true }
  const floor = bsPrice({ S, K, T, r, sigma: lo, type }) // ≈ discounted intrinsic
  const ceil = bsPrice({ S, K, T, r, sigma: hi, type })
  if (price <= floor + tol) return { sigma: lo, degenerate: true } // no time value
  if (price >= ceil) return { sigma: hi, degenerate: false } // clamp at the ceiling IV

  let a = lo
  let b = hi
  for (let i = 0; i < iters; i++) {
    const m = 0.5 * (a + b)
    const diff = bsPrice({ S, K, T, r, sigma: m, type }) - price
    if (Math.abs(diff) < tol) return { sigma: m, degenerate: false }
    if (diff < 0) a = m // price still above model → need higher σ
    else b = m
  }
  return { sigma: 0.5 * (a + b), degenerate: false }
}
