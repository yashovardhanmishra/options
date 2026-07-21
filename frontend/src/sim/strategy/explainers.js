// Plain-language explainers for every Greek, payoff stat, and margin/sizing term the sim
// shows. Keyed so the same copy is reused by GreeksTable / StrategyStats / SizingPanel and is
// unit-testable. NIFTY context where it helps a first-timer. PURE DATA — no JSX, no imports.
// Each entry is { t: short title, d: 1–2 sentence beginner copy }.

export const EXPLAINERS = {
  // ── Greeks: ₹ framing (portfolio "Total ₹" row — position-scaled by lots × lotSize × side)
  delta: {
    t: 'Delta (₹)',
    d: 'How much your position’s value moves, in rupees, for a 1-point move in NIFTY spot. Positive means you gain when NIFTY rises; negative means you gain when it falls.',
  },
  gamma: {
    t: 'Gamma (₹)',
    d: 'How fast your Delta itself changes per 1-point NIFTY move. High gamma means your directional exposure swings quickly — small for sellers, large near expiry and at-the-money.',
  },
  theta: {
    t: 'Theta / day (₹)',
    d: 'The rupees the position gains or loses each day purely from time passing, if spot and IV stay put. Sellers usually see positive theta (decay helps them); buyers see negative.',
  },
  vega: {
    t: 'Vega (₹)',
    d: 'How many rupees you make or lose if implied volatility (IV) rises 1 percentage point. Long options are positive vega (gain when IV jumps before events); short options negative.',
  },

  // ── Greeks: points framing (lot-normalised "Total pts" row — ₹ greek ÷ lot size, summed)
  pts: {
    t: 'Points view',
    d: 'The same Greeks quoted per single option in premium points instead of rupees — the form traders speak in. Lot-size-independent, so you can compare strikes directly.',
  },
  totalRupee: {
    t: 'Portfolio Greeks (₹)',
    d: 'Each leg’s Greek scaled by its lot size, lots and direction, then summed — your actual rupee exposure across the whole position.',
  },
  iv: {
    t: 'Implied Volatility',
    d: 'The annualised volatility the market is pricing into this option — effectively its “expensiveness.” Higher IV = pricier premium; IV usually spikes before events and collapses after.',
  },

  // ── StrategyStats / payoff terms (field names from strategySummary in payoff.js)
  pnl: {
    t: 'P&L (MTM)',
    d: 'Your live mark-to-market profit/loss on open positions — (current mark - entry) × quantity. It updates every tick as the replay clock scrubs.',
  },
  maxProfit: {
    t: 'Max Profit',
    d: 'The most this strategy can make if held to expiry, read off the payoff curve. “Unlimited” means a leg has no upside cap (e.g. a naked long call).',
  },
  maxLoss: {
    t: 'Max Loss',
    d: 'The worst this strategy can lose if held to expiry. “Unlimited” flags a naked short — losses can run far past the premium, so size and stops matter.',
  },
  pop: {
    t: 'POP — Probability of Profit',
    d: 'Model estimate of the chance the trade ends profitable at expiry, from a lognormal spot distribution using ATM IV. A guide, not a guarantee — high-POP trades often pair small max profit with large max loss.',
  },
  netCredit: {
    t: 'Net Credit',
    d: 'Net premium you collect up front (sold premium exceeds bought). This credit is your initial cushion and, for many sold strategies, the max profit.',
  },
  netDebit: {
    t: 'Net Debit',
    d: 'Net premium you pay up front (bought premium exceeds sold). This debit is your cost and usually the most you can lose on a defined-risk buy.',
  },
  breakevens: {
    t: 'Breakeven(s)',
    d: 'The NIFTY level(s) at expiry where the trade exactly breaks even — the zero-crossings of the payoff curve. The % shows how far each sits from current spot.',
  },
  atmIv: {
    t: 'ATM IV',
    d: 'Implied volatility of the at-the-money strike — the headline “fear gauge” for the expiry. It drives the expected move, the ±1σ/±2σ bands and the POP estimate.',
  },

  // ── Margin + sizing (SizingPanel — engine/margin.js)
  marginTotal: {
    t: 'Estimated margin',
    d: 'Approximate funds your broker blocks to hold this position: SPAN + exposure for short legs, premium for long legs. Real SPAN is scenario-based and revised intraday, so treat this as an estimate.',
  },
  spanMargin: {
    t: 'SPAN margin',
    d: 'The exchange’s worst-case risk margin on your short options — ~4.5% of underlying value at the money, higher for ITM strikes and lower for OTM (floored at a ~3% minimum, so even a near-worthless deep-OTM short still costs plenty), netted across offsetting call/put sides. It’s the bulk of what selling an option costs you.',
  },
  exposureMargin: {
    t: 'Exposure margin',
    d: 'An extra 2% of contract value the exchange charges on short index positions, on top of SPAN, as a buffer against extreme moves.',
  },
  marginUtil: {
    t: 'Margin utilisation',
    d: 'How much of your account capital this position’s margin uses. Keeping this well below 100% leaves room for adverse moves and margin spikes (especially on expiry day).',
  },
  riskBudget: {
    t: 'Risk budget',
    d: 'Capital × risk-per-trade %. The most you’re willing to lose on one trade — sizing keeps your max loss within this.',
  },
  suggestedSize: {
    t: 'Suggested size',
    d: 'How many copies of the current position fit under BOTH your risk budget (max-loss based) and your capital (margin based) — whichever is tighter wins.',
  },
}

/** Entry for a key, or null so the Info component degrades gracefully on an unknown key. */
export const explainer = (key) => EXPLAINERS[key] || null

export default EXPLAINERS
