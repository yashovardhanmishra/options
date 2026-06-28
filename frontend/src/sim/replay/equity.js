// The equity curve, SAMPLED (not accumulated): for each bar on the timeline,
//   equity(t) = realized(fold where action.t <= t) + unrealized(open legs priced at t),
// by sampling portfolioAt at that bar. Because it's a pure function of (actions, timeline,
// snapshots) it redraws identically when scrubbing back and is identical across playback
// speed (same evaluated bars). Anti-lookahead is enforced inside the snapshot (series.barAt
// only returns bars with u <= t), so no curve point can read a future bar.
import { portfolioAt } from '../portfolio/book.js'

export function equityCurve({ actions, timeline, snapshotAt, ctxAt }) {
  return timeline.times.map((t, index) => {
    const book = portfolioAt({ actions, t, snapshot: snapshotAt(t), ctx: ctxAt(t) })
    return { index, t, realized: book.realized, unrealized: book.unrealized, equity: book.total }
  })
}
