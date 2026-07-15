// One-click strategy catalog. Each entry describes a named structure as ATM-RELATIVE leg
// specs: { type:'CE'|'PE', side:+1 long/-1 short, k:strikeOffsetInSteps, lots }. The k is in
// units of the chain's strike step (e.g. 50 for NIFTY), scaled by the user's "width" w so the
// same template can be placed tight/normal/wide. Resolution to real strikes + fill prices is
// done against the live chain (see resolveLegs). PURE — no ids, no I/O, no prices here.
//
// Anchors: k=0 is ATM; +k is a higher strike (OTM call / ITM put), -k is a lower strike
// (ITM call / OTM put). `w` is the near-OTM distance in steps (default 2).

const CE = 'CE'
const PE = 'PE'
const L = (type, side, k, lots) => ({ type, side, k, lots })

// outlook drives the colored badge: bull / bear / neutral / vol
export const STRATEGIES = [
  // ───────────────────────── Neutral / Range (theta) ─────────────────────────
  {
    id: 'short_straddle', name: 'Short Straddle', cat: 'Neutral', outlook: 'neutral',
    desc: 'Sell ATM call + put. Max premium, profits if price stays pinned to ATM. Naked — unlimited risk both sides.',
    build: ({ lots, w }) => [L(CE, -1, 0, lots), L(PE, -1, 0, lots)],
  },
  {
    id: 'short_strangle', name: 'Short Strangle', cat: 'Neutral', outlook: 'neutral',
    desc: 'Sell OTM call + OTM put. Wider profit zone than a straddle, less premium. Naked wings.',
    build: ({ lots, w }) => [L(CE, -1, w, lots), L(PE, -1, -w, lots)],
  },
  {
    id: 'iron_condor', name: 'Iron Condor', cat: 'Neutral', outlook: 'neutral',
    desc: 'Short OTM strangle + long further-OTM wings. Defined-risk range play — the workhorse income trade.',
    build: ({ lots, w }) => [L(PE, 1, -2 * w, lots), L(PE, -1, -w, lots), L(CE, -1, w, lots), L(CE, 1, 2 * w, lots)],
  },
  {
    id: 'iron_butterfly', name: 'Iron Butterfly', cat: 'Neutral', outlook: 'neutral',
    desc: 'Short ATM straddle + long OTM wings. More premium than a condor, narrower profit zone, defined risk.',
    build: ({ lots, w }) => [L(PE, 1, -w, lots), L(PE, -1, 0, lots), L(CE, -1, 0, lots), L(CE, 1, w, lots)],
  },
  {
    id: 'call_butterfly', name: 'Call Butterfly', cat: 'Neutral', outlook: 'neutral',
    desc: 'Long 1 / short 2 / long 1 calls. Cheap, defined-risk bet that price lands at the middle strike.',
    build: ({ lots, w }) => [L(CE, 1, -w, lots), L(CE, -1, 0, 2 * lots), L(CE, 1, w, lots)],
  },
  {
    id: 'put_butterfly', name: 'Put Butterfly', cat: 'Neutral', outlook: 'neutral',
    desc: 'Long 1 / short 2 / long 1 puts centred at ATM. Defined-risk pin bet built from puts.',
    build: ({ lots, w }) => [L(PE, 1, w, lots), L(PE, -1, 0, 2 * lots), L(PE, 1, -w, lots)],
  },
  {
    id: 'call_condor', name: 'Call Condor', cat: 'Neutral', outlook: 'neutral',
    desc: 'Long/short/short/long calls — a butterfly with a flat top. Wider profit zone than a fly.',
    build: ({ lots, w }) => [L(CE, 1, -2 * w, lots), L(CE, -1, -w, lots), L(CE, -1, w, lots), L(CE, 1, 2 * w, lots)],
  },
  {
    id: 'put_condor', name: 'Put Condor', cat: 'Neutral', outlook: 'neutral',
    desc: 'Long/short/short/long puts — flat-topped range bet built from puts.',
    build: ({ lots, w }) => [L(PE, 1, 2 * w, lots), L(PE, -1, w, lots), L(PE, -1, -w, lots), L(PE, 1, -2 * w, lots)],
  },
  {
    id: 'call_ratio_spread', name: 'Call Ratio Spread', cat: 'Neutral', outlook: 'neutral',
    desc: 'Buy 1 ATM call, sell 2 OTM calls. Credit, profits in a drift up to the short strikes. Risk above.',
    build: ({ lots, w }) => [L(CE, 1, 0, lots), L(CE, -1, w, 2 * lots)],
  },
  {
    id: 'put_ratio_spread', name: 'Put Ratio Spread', cat: 'Neutral', outlook: 'neutral',
    desc: 'Buy 1 ATM put, sell 2 OTM puts. Credit, profits in a drift down to the short strikes. Risk below.',
    build: ({ lots, w }) => [L(PE, 1, 0, lots), L(PE, -1, -w, 2 * lots)],
  },

  // ───────────────────────────── Bullish ─────────────────────────────
  {
    id: 'long_call', name: 'Long Call', cat: 'Bullish', outlook: 'bull',
    desc: 'Buy an ATM call. Simple leveraged long — defined risk (premium), unlimited upside.',
    build: ({ lots }) => [L(CE, 1, 0, lots)],
  },
  {
    id: 'bull_call_spread', name: 'Bull Call Spread', cat: 'Bullish', outlook: 'bull',
    desc: 'Long ATM call, short OTM call. Defined-risk debit play for a measured move up.',
    build: ({ lots, w }) => [L(CE, 1, 0, lots), L(CE, -1, w, lots)],
  },
  {
    id: 'bull_put_spread', name: 'Bull Put Spread', cat: 'Bullish', outlook: 'bull',
    desc: 'Short OTM put, long further-OTM put. Credit spread that profits if price holds above the short put.',
    build: ({ lots, w }) => [L(PE, -1, -w, lots), L(PE, 1, -2 * w, lots)],
  },
  {
    id: 'call_ratio_backspread', name: 'Call Ratio Backspread', cat: 'Bullish', outlook: 'vol',
    desc: 'Sell 1 ATM call, buy 2 OTM calls. Long-vega bullish — profits on a strong rally, small credit if flat.',
    build: ({ lots, w }) => [L(CE, -1, 0, lots), L(CE, 1, w, 2 * lots)],
  },
  {
    id: 'synthetic_long', name: 'Synthetic Long', cat: 'Bullish', outlook: 'bull',
    desc: 'Long ATM call + short ATM put. Mimics long futures — full upside and downside, near-zero cost.',
    build: ({ lots }) => [L(CE, 1, 0, lots), L(PE, -1, 0, lots)],
  },
  {
    id: 'risk_reversal_bull', name: 'Bull Risk Reversal', cat: 'Bullish', outlook: 'bull',
    desc: 'Short OTM put funds a long OTM call. Strongly bullish, often near-zero cost. Downside risk below the put.',
    build: ({ lots, w }) => [L(PE, -1, -w, lots), L(CE, 1, w, lots)],
  },
  {
    id: 'strap', name: 'Strap', cat: 'Bullish', outlook: 'vol',
    desc: 'Long 2 ATM calls + 1 ATM put. Bullish volatility — wins on a big move, bigger payoff to the upside.',
    build: ({ lots }) => [L(CE, 1, 0, 2 * lots), L(PE, 1, 0, lots)],
  },
  {
    id: 'big_lizard', name: 'Big Lizard', cat: 'Bullish', outlook: 'neutral',
    desc: 'Short ATM straddle + long OTM call. Removes upside risk; profits in a range with a bullish tilt.',
    build: ({ lots, w }) => [L(CE, -1, 0, lots), L(PE, -1, 0, lots), L(CE, 1, w, lots)],
  },
  {
    id: 'jade_lizard', name: 'Jade Lizard', cat: 'Bullish', outlook: 'neutral',
    desc: 'Short OTM put + short OTM call spread. Credit with no upside risk if credit ≥ call-spread width.',
    build: ({ lots, w }) => [L(PE, -1, -w, lots), L(CE, -1, w, lots), L(CE, 1, 2 * w, lots)],
  },
  {
    id: 'broken_wing_call_fly', name: 'Broken-Wing Call Fly', cat: 'Bullish', outlook: 'neutral',
    desc: 'Call butterfly with a wider upper wing — skews payoff bullish, often opens for a credit (no downside risk).',
    build: ({ lots, w }) => [L(CE, 1, -w, lots), L(CE, -1, 0, 2 * lots), L(CE, 1, 2 * w, lots)],
  },

  // ───────────────────────────── Bearish ─────────────────────────────
  {
    id: 'long_put', name: 'Long Put', cat: 'Bearish', outlook: 'bear',
    desc: 'Buy an ATM put. Leveraged short — defined risk (premium), large payoff on a fall.',
    build: ({ lots }) => [L(PE, 1, 0, lots)],
  },
  {
    id: 'bear_put_spread', name: 'Bear Put Spread', cat: 'Bearish', outlook: 'bear',
    desc: 'Long ATM put, short OTM put. Defined-risk debit play for a measured move down.',
    build: ({ lots, w }) => [L(PE, 1, 0, lots), L(PE, -1, -w, lots)],
  },
  {
    id: 'bear_call_spread', name: 'Bear Call Spread', cat: 'Bearish', outlook: 'bear',
    desc: 'Short OTM call, long further-OTM call. Credit spread that profits if price holds below the short call.',
    build: ({ lots, w }) => [L(CE, -1, w, lots), L(CE, 1, 2 * w, lots)],
  },
  {
    id: 'put_ratio_backspread', name: 'Put Ratio Backspread', cat: 'Bearish', outlook: 'vol',
    desc: 'Sell 1 ATM put, buy 2 OTM puts. Long-vega bearish — profits on a sharp drop, small credit if flat.',
    build: ({ lots, w }) => [L(PE, -1, 0, lots), L(PE, 1, -w, 2 * lots)],
  },
  {
    id: 'synthetic_short', name: 'Synthetic Short', cat: 'Bearish', outlook: 'bear',
    desc: 'Short ATM call + long ATM put. Mimics short futures — full downside and upside risk, near-zero cost.',
    build: ({ lots }) => [L(CE, -1, 0, lots), L(PE, 1, 0, lots)],
  },
  {
    id: 'risk_reversal_bear', name: 'Bear Risk Reversal', cat: 'Bearish', outlook: 'bear',
    desc: 'Short OTM call funds a long OTM put. Strongly bearish, often near-zero cost. Upside risk above the call.',
    build: ({ lots, w }) => [L(CE, -1, w, lots), L(PE, 1, -w, lots)],
  },
  {
    id: 'strip', name: 'Strip', cat: 'Bearish', outlook: 'vol',
    desc: 'Long 2 ATM puts + 1 ATM call. Bearish volatility — wins on a big move, bigger payoff to the downside.',
    build: ({ lots }) => [L(PE, 1, 0, 2 * lots), L(CE, 1, 0, lots)],
  },

  // ───────────────────────────── Volatility ─────────────────────────────
  {
    id: 'long_straddle', name: 'Long Straddle', cat: 'Volatility', outlook: 'vol',
    desc: 'Buy ATM call + put. Profits on a big move either way; loses to theta if price stalls. Defined risk.',
    build: ({ lots }) => [L(CE, 1, 0, lots), L(PE, 1, 0, lots)],
  },
  {
    id: 'long_strangle', name: 'Long Strangle', cat: 'Volatility', outlook: 'vol',
    desc: 'Buy OTM call + OTM put. Cheaper than a straddle, needs a bigger move to pay off.',
    build: ({ lots, w }) => [L(CE, 1, w, lots), L(PE, 1, -w, lots)],
  },
  {
    id: 'long_guts', name: 'Long Guts', cat: 'Volatility', outlook: 'vol',
    desc: 'Buy ITM call + ITM put. Like a strangle but built from in-the-money options — high intrinsic, low time decay.',
    build: ({ lots, w }) => [L(CE, 1, -w, lots), L(PE, 1, w, lots)],
  },
  {
    id: 'reverse_call_butterfly', name: 'Reverse Call Fly', cat: 'Volatility', outlook: 'vol',
    desc: 'Short 1 / long 2 / short 1 calls. Inverted butterfly — small credit, profits when price leaves the middle.',
    build: ({ lots, w }) => [L(CE, -1, -w, lots), L(CE, 1, 0, 2 * lots), L(CE, -1, w, lots)],
  },
  {
    id: 'reverse_iron_condor', name: 'Reverse Iron Condor', cat: 'Volatility', outlook: 'vol',
    desc: 'Long inner strangle + short further-OTM wings. Defined-risk breakout play — profits on a move out of the range.',
    build: ({ lots, w }) => [L(PE, -1, -2 * w, lots), L(PE, 1, -w, lots), L(CE, 1, w, lots), L(CE, -1, 2 * w, lots)],
  },
]

export const CATEGORIES = ['Neutral', 'Bullish', 'Bearish', 'Volatility']
export const STRATEGY_BY_ID = Object.fromEntries(STRATEGIES.map((s) => [s.id, s]))

// ─────────────────────────── pure chain resolvers ───────────────────────────

/** Most common gap between adjacent strikes in the chain (robust to missing strikes). */
export function inferStep(chain) {
  if (!chain || chain.length < 2) return 50
  const ks = [...new Set(chain.map((r) => r.strike))].sort((a, b) => a - b)
  const counts = new Map()
  for (let i = 1; i < ks.length; i++) {
    const d = ks[i] - ks[i - 1]
    if (d > 0) counts.set(d, (counts.get(d) || 0) + 1)
  }
  let best = 50, bc = 0
  for (const [d, c] of counts) if (c > bc) { bc = c; best = d }
  return best
}

/** ATM strike: the strike where |CE−PE| is smallest (put-call parity). Falls back to the
 *  strike nearest spot S, then to the mid of the strike range. */
export function atmStrikeOf(chain, S) {
  if (!chain || chain.length === 0) return null
  let atm = null, bd = Infinity
  for (const r of chain) {
    if (r.ce?.ltp != null && r.pe?.ltp != null) {
      const d = Math.abs(r.ce.ltp - r.pe.ltp)
      if (d < bd) { bd = d; atm = r.strike }
    }
  }
  if (atm != null) return atm
  if (S != null) {
    let best = null, db = Infinity
    for (const r of chain) { const d = Math.abs(r.strike - S); if (d < db) { db = d; best = r.strike } }
    return best
  }
  const ks = chain.map((r) => r.strike)
  const mid = (Math.min(...ks) + Math.max(...ks)) / 2
  let best = ks[0]
  for (const k of ks) if (Math.abs(k - mid) < Math.abs(best - mid)) best = k
  return best
}

/** Nearest strike to `target` that actually has a tradable LTP for `type`. */
export function nearestStrikeWith(chain, target, type) {
  let best = null, bd = Infinity
  for (const r of chain) {
    const px = type === 'CE' ? r.ce?.ltp : r.pe?.ltp
    if (px == null) continue
    const d = Math.abs(r.strike - target)
    if (d < bd) { bd = d; best = r.strike }
  }
  return best
}

/**
 * Resolve a template's ATM-relative legs against the live chain at the clock.
 * @returns {{ id, name, atm, step, specs:Array, missing:Array, net:number }}
 *   specs   = priced, real-strike legs ({ type, side, lots, strike, price })
 *   missing = legs whose strike/price couldn't be resolved (chain doesn't reach)
 *   net     = ₹ premium: >0 credit received, <0 debit paid (per lotSize)
 */
export function resolveStrategy(id, { chain, S, lots = 1, w = 2, priceFor, lotSize = 1 } = {}) {
  const tpl = STRATEGY_BY_ID[id]
  if (!tpl || !chain || chain.length === 0) return null
  const atm = atmStrikeOf(chain, S)
  const step = inferStep(chain)
  if (atm == null || !step) return null
  const ww = Math.max(1, w | 0)
  const ll = Math.max(1, lots | 0)
  const legs = tpl.build({ lots: ll, w: ww })

  const specs = []
  const missing = []
  const resolvedAt = new Map() // "TYPE:strike" -> target it was aimed at
  for (const lg of legs) {
    const target = atm + lg.k * step
    const strike = nearestStrikeWith(chain, target, lg.type)
    const price = strike != null && priceFor ? priceFor({ strike, type: lg.type }) : null
    if (strike == null || price == null) { missing.push(lg); continue }
    // Chain doesn't reach this target if the leg collapsed onto a same-type leg aimed at a
    // different strike (e.g. a condor wing landing on its short leg — that would silently
    // turn defined risk into a naked position). Treat it as missing instead.
    const key = `${lg.type}:${strike}`
    if (resolvedAt.has(key) && resolvedAt.get(key) !== target) { missing.push(lg); continue }
    resolvedAt.set(key, target)
    specs.push({ type: lg.type, side: lg.side, lots: lg.lots, strike, price })
  }
  const net = specs.reduce((s, x) => s - x.side * x.price * x.lots * lotSize, 0)
  return { id, name: tpl.name, atm, step, specs, missing, net }
}
