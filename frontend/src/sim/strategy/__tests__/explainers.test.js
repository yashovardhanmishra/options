import { describe, it, expect } from 'vitest'
import { EXPLAINERS, explainer } from '../explainers.js'

// Keys actually consumed by GreeksTable / StrategyStats / SizingPanel. If a payoff/greek field
// is ever renamed, this guards against a tooltip silently vanishing.
const CONSUMED = [
  'delta', 'gamma', 'vega', 'theta', 'iv', 'pts', 'totalRupee',
  'pnl', 'maxProfit', 'maxLoss', 'pop', 'netCredit', 'netDebit', 'breakevens', 'atmIv',
  'marginTotal', 'spanMargin', 'exposureMargin', 'marginUtil', 'riskBudget', 'suggestedSize',
]

describe('explainers', () => {
  it('every consumed key resolves to a non-empty {t,d}', () => {
    for (const k of CONSUMED) {
      const e = explainer(k)
      expect(e, k).toBeTruthy()
      expect(e.t.length, k).toBeGreaterThan(0)
      expect(e.d.length, k).toBeGreaterThan(15)
    }
  })
  it('unknown key → null (graceful Info degrade)', () => {
    expect(explainer('nope')).toBeNull()
  })
  it('credit/debit keys both exist for the StrategyStats label flip', () => {
    expect(EXPLAINERS.netCredit).toBeTruthy()
    expect(EXPLAINERS.netDebit).toBeTruthy()
  })
})
