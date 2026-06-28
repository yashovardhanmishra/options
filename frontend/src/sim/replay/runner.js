// The assembled sim: play a session start -> end. On EVERY evaluated bar (every bar, all
// speeds — step 3) it runs, in order: expiry settlement (intrinsic, takes precedence at the
// expiry bar) then risk auto-liquidation (market), each appending normal stamped actions to
// the one log. Afterwards it samples the equity curve from the final log. Deterministic
// across speed and reversible under scrub, because state = fold(actions <= t) throughout.
import { ReplayClock } from './clock.js'
import { Transport } from './transport.js'
import { portfolioAt } from '../portfolio/book.js'
import { evaluateRisk } from '../risk/engine.js'
import { evaluateExpiry } from '../risk/expiry.js'
import { equityCurve } from './equity.js'

export function runSession({ timeline, snapshotAt, ctxAt, expiry, initialLog = [], limits = {}, speed = 'max' }) {
  const clock = new ReplayClock(timeline, 0)
  const log = [...initialLog]
  const expiryBarUnix = timeline.sessions.find((s) => s.date === expiry)?.endUnix ?? null
  const bookAt = (l, u) => portfolioAt({ actions: l, t: u, snapshot: snapshotAt(u), ctx: ctxAt(u) })

  const evalBar = (index) => {
    const t = timeline.times[index]
    const snap = snapshotAt(t)
    // 1) expiry settlement (intrinsic) first — at the expiry bar it closes everything,
    //    so the risk pass below sees a flat book and no-ops.
    for (const a of evaluateExpiry({ actions: log, t, expiry, expiryBarUnix, spot: snap.S, lotSizeFor: ctxAt(t).lotSizeFor }).actions) log.push(a)
    // 2) risk auto-liquidation (market) on whatever remains open.
    for (const a of evaluateRisk({ actions: log, t, limits, bookAt }).actions) log.push(a)
  }

  evalBar(0) // evaluate the starting bar too
  const transport = new Transport(clock, { onEvaluate: evalBar }).setSpeed(speed)
  while (!clock.atEnd()) transport.frame()

  return { log, clock, curve: equityCurve({ actions: log, timeline, snapshotAt, ctxAt }) }
}
