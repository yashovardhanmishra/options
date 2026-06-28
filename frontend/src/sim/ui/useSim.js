// The ONE state container for the replay simulator. State is exactly three things:
//   clockIndex  — the single source of truth (step 3)
//   userActions — the append-only log of trades the user placed (entries + exits)
//   limits      — the risk limits
// EVERYTHING else is DERIVED, purely, from those + the loaded session:
//   - fullRun  = runSession(...) folds userActions + auto-actions (risk + expiry) over the
//                WHOLE timeline ONCE (recomputed only when userActions/limits change). The
//                clock just controls what's VISIBLE (fold <= t), so playback speed and
//                scrub-back never change it — determinism + reversibility come for free.
//   - book     = portfolioAt(fullRun.log, t)      (positions, Greeks, totals)
//   - curve    = fullRun.curve.slice(0..clock)    (equity, redrawn identically on scrub)
//   - chainSnap= snapshotAt(t)                     (the option chain for display)
// The React layer renders these and emits actions. It computes no P&L / Greeks / fold.
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { loadReplay } from '../data/session.js'
import { loadSpot, loadExpiries, loadDates } from '../data/client.js'
import { snapshotAt, makeContext } from '../data/snapshot.js'
import { portfolioAt } from '../portfolio/book.js'
import { runSession } from '../replay/runner.js'
import { entry, exitLeg, exitGroup, exitPortfolio } from '../portfolio/actions.js'
import { speedToBarsPerFrame } from '../replay/transport.js'
import * as TL from '../replay/timeline.js'
import { checkLimits } from '../engine/risk.js'
import { yearsToExpiry } from '../engine/time.js'
import { impliedVol } from '../engine/iv.js'
import { strategySummary } from '../engine/payoff.js'

// ATM implied vol at the clock: invert the option closest to spot (CE, then PE). Falls back
// to null so callers can substitute an average leg IV.
function computeAtmIv(chainSnap, S, T, r = 0.065) {
  if (!chainSnap?.chain || S == null || !(T > 0)) return null
  let best = null
  for (const row of chainSnap.chain) if (best == null || Math.abs(row.strike - S) < Math.abs(best.strike - S)) best = row
  for (const type of ['CE', 'PE']) {
    const px = type === 'CE' ? best?.ce?.ltp : best?.pe?.ltp
    if (px == null) continue
    const { sigma, degenerate } = impliedVol({ S, K: best.strike, T, r, price: px, type })
    if (!degenerate && sigma > 0) return sigma
  }
  return null
}

const TICK_MS = 60 // play tick; speed = bars advanced per tick (render cadence only)

export function useSim({ base = '', token, ready = true } = {}) {
  // ---- inputs / selection ----
  const [expiries, setExpiries] = useState([])
  const [expiry, setExpiry] = useState('')
  const [allDates, setAllDates] = useState([])
  const [fromDate, setFromDate] = useState('')
  const [loaded, setLoaded] = useState(null) // { session, timeline, expiry }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // ---- THE state ----
  const [clockIndex, setClockIndex] = useState(0)
  const [userActions, setUserActions] = useState([])
  const [limits, setLimitsState] = useState({ portfolio: {}, groups: {} })

  // ---- transport + analysis ----
  const [speed, setSpeed] = useState('5x')
  const [playing, setPlaying] = useState(false)
  const [multiplier, setMultiplier] = useState(1)

  const idRef = useRef(0) // leg-id counter
  const spotRef = useRef(null) // cached spot bars

  // expiries on mount (wait until auth is ready so the deployed backend doesn't 401)
  useEffect(() => {
    if (!ready) return
    loadExpiries(base, token)
      .then((l) => { setExpiries(l); if (l.length) setExpiry(l[0]) })
      .catch((e) => setError(String(e)))
  }, [base, token, ready])

  // dates when expiry changes -> default the load window to the last 2 trading days
  useEffect(() => {
    if (!expiry || !ready) return
    let cancel = false
    loadDates(base, expiry, token)
      .then((ds) => {
        if (cancel) return
        setAllDates(ds)
        setFromDate(ds.length ? ds[Math.max(0, ds.length - 2)] : '')
      })
      .catch((e) => !cancel && setError(String(e)))
    return () => { cancel = true }
  }, [expiry, base, token, ready])

  // load the replay (session + timeline) when expiry + window set
  useEffect(() => {
    if (!expiry || !fromDate || !ready) return
    let cancel = false
    setLoading(true); setError(null)
    const dates = allDates.filter((d) => d >= fromDate)
    ;(async () => {
      const spotBars = spotRef.current || (spotRef.current = await loadSpot(base, token))
      const { session, timeline } = await loadReplay({ base, expiry, dates, token, spotBars, expiries })
      if (cancel) return
      setLoaded({ session, timeline, expiry })
      setClockIndex(0); setUserActions([]); idRef.current = 0; setPlaying(false)
      setLoading(false)
    })().catch((e) => { if (!cancel) { setError(String(e)); setLoading(false) } })
    return () => { cancel = true }
  }, [expiry, fromDate, allDates, base, token, expiries, ready])

  const timeline = loaded?.timeline
  const len = timeline?.times.length ?? 0
  const t = timeline ? timeline.times[Math.min(clockIndex, len - 1)] : null

  // ---- snapshot accessors (lite = engine path, full = chain display) ----
  const snapAtLite = useCallback((u) => snapshotAt(loaded.session, u, { chain: false }), [loaded])
  const snapAtFull = useCallback((u) => snapshotAt(loaded.session, u), [loaded])
  const ctxAt = useCallback((u) => makeContext(loaded.session, snapAtLite(u)), [loaded, snapAtLite])

  // ---- the one heavy derive: full effective log + full curve (recomputed only on
  //      userActions / limits / session change — NOT on clock change) ----
  const fullRun = useMemo(() => {
    if (!loaded) return null
    return runSession({ timeline, snapshotAt: snapAtLite, ctxAt, expiry: loaded.expiry, initialLog: userActions, limits, speed: 'max' })
  }, [loaded, timeline, snapAtLite, ctxAt, userActions, limits])

  // ---- everything shown is a pure function of the clock + fullRun ----
  const book = useMemo(
    () => (loaded ? portfolioAt({ actions: fullRun.log, t, snapshot: snapAtLite(t), ctx: ctxAt(t) }) : null),
    [loaded, fullRun, t, snapAtLite, ctxAt],
  )
  const chainSnap = useMemo(() => (loaded ? snapAtFull(t) : null), [loaded, t, snapAtFull])
  const curve = useMemo(() => (fullRun ? fullRun.curve.slice(0, clockIndex + 1) : []), [fullRun, clockIndex])
  const breaches = useMemo(() => (fullRun ? fullRun.log.filter((a) => a.reason && a.t <= t) : []), [fullRun, t])
  const warnings = useMemo(
    () => (book ? checkLimits(book.greeks, limits.portfolio, 0.8).warnings : []),
    [book, limits],
  )

  // ---- strategy payoff analytics (StockMock-style), recomputed at the clock ----
  const Texp = useMemo(() => (loaded ? Math.max(0, yearsToExpiry(t, loaded.expiry)) : 0), [loaded, t])
  const spot = chainSnap?.S ?? null
  const atmIv = useMemo(() => computeAtmIv(chainSnap, spot, Texp), [chainSnap, spot, Texp])
  const payoff = useMemo(() => {
    if (!book || !book.openLegs.length || spot == null) return null
    const fallback = atmIv || 0.15
    const legs = book.openLegs.map((s) => ({
      strike: s.leg.strike, type: s.leg.type, side: s.leg.side, lots: s.leg.lots,
      lotSize: s.lotSize, entryPrice: s.leg.entryPrice, sigma: s.degenerate || !(s.iv > 0) ? fallback : s.iv,
    }))
    return strategySummary(legs, { S0: spot, Tnow: Texp, Texp, atmIv: fallback, mult: multiplier })
  }, [book, spot, Texp, atmIv, multiplier])

  // ---- transport ----
  const seek = useCallback((i) => setClockIndex(() => Math.max(0, Math.min(len - 1, i | 0))), [len])
  const stepBy = useCallback((n) => setClockIndex((c) => Math.max(0, Math.min(len - 1, c + n))), [len])

  // ---- time navigation (StockMock-style): jump to a date+time, step ±minutes (clamped to
  //      the trading day), SOD/EOD, prev/next day ----
  const sessionDates = useMemo(() => timeline?.sessions.map((s) => s.date) ?? [], [timeline])
  const ci = Math.min(clockIndex, Math.max(0, len - 1))
  const currentSession = useMemo(() => (timeline && len ? TL.sessionOf(timeline, ci) : null), [timeline, ci, len])
  const seekToDateTime = useCallback((date, hh, mm) => { if (timeline) seek(TL.indexOfDateTime(timeline, date, hh, mm)) }, [timeline, seek])
  const stepMinutes = useCallback((n) => {
    if (!timeline || !len) return
    const s = TL.sessionOf(timeline, ci)
    const target = timeline.times[ci] + n * 60
    let idx
    if (n >= 0) { idx = TL.indexAtOrAfter(timeline, target); if (idx >= len || idx > s.endIndex) idx = s.endIndex }
    else { idx = TL.indexAtOrBefore(timeline, target); if (idx < s.startIndex) idx = s.startIndex }
    seek(idx)
  }, [timeline, ci, len, seek])
  const toSOD = useCallback(() => currentSession && seek(currentSession.startIndex), [currentSession, seek])
  const toEOD = useCallback(() => currentSession && seek(currentSession.endIndex), [currentSession, seek])
  const dayStep = useCallback((dir) => {
    if (!timeline || !len) return
    const ss = timeline.sessions
    const i = ss.findIndex((s) => ci >= s.startIndex && ci <= s.endIndex)
    seek(ss[Math.max(0, Math.min(ss.length - 1, (i < 0 ? 0 : i) + dir))].startIndex)
  }, [timeline, ci, len, seek])

  // play loop: advance `barsPerFrame` per tick; render only the landed bar (every
  // intervening bar was already evaluated in fullRun, so nothing is skipped).
  useEffect(() => {
    if (!playing || !loaded) return
    const bpf = speedToBarsPerFrame(speed)
    const id = setInterval(() => {
      setClockIndex((c) => (c >= len - 1 ? c : Math.min(len - 1, c + (bpf === Infinity ? len : bpf))))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [playing, loaded, speed, len])
  useEffect(() => { if (loaded && clockIndex >= len - 1) setPlaying(false) }, [clockIndex, loaded, len])

  // ---- action emitters (the ONLY way the UI mutates state besides the clock) ----
  const nextId = () => `L${++idRef.current}`
  const placeEntry = useCallback(({ strike, type, side, lots }) => {
    if (!loaded) return
    const price = snapAtFull(t).priceFor({ strike, type })
    if (price == null) return
    setUserActions((log) => [...log, entry({ t, legId: nextId(), expiry: loaded.expiry, strike, type, side, lots, price })])
  }, [loaded, t, snapAtFull])

  const squareOffLeg = useCallback((legId) => {
    const st = book?.openLegs.find((s) => s.leg.id === legId)
    if (!st) return
    const price = snapAtLite(t).priceFor(st.leg)
    if (price == null) return
    setUserActions((log) => [...log, exitLeg({ t, legId, price })])
  }, [book, t, snapAtLite])

  const pricesFor = (states) => {
    const snap = snapAtLite(t)
    return Object.fromEntries(states.map((s) => [s.leg.id, snap.priceFor(s.leg)]).filter(([, p]) => p != null))
  }
  const squareOffGroup = useCallback((groupId) => {
    const g = book?.groups.find((x) => x.groupId === groupId)
    if (!g) return
    setUserActions((log) => [...log, exitGroup({ t, groupId, prices: pricesFor(g.legs) })])
  }, [book, t, snapAtLite])
  const squareOffAll = useCallback(() => {
    if (!book?.openLegs.length) return
    setUserActions((log) => [...log, exitPortfolio({ t, prices: pricesFor(book.openLegs) })])
  }, [book, t, snapAtLite])

  const resetTrades = useCallback(() => { setUserActions([]); idRef.current = 0 }, [])
  const setLimits = useCallback((updater) => setLimitsState(updater), [])

  return {
    // selection
    expiries, expiry, setExpiry, allDates, fromDate, setFromDate, loading, error,
    // engine outputs (read-only)
    loaded, timeline, len, clockIndex, t, book, chainSnap, curve, breaches, warnings, limits, userActions, fullRun,
    // strategy analytics
    spot, Texp, atmIv, payoff, multiplier, setMultiplier,
    // transport + time navigation
    speed, setSpeed, playing, setPlaying, seek, stepBy,
    sessionDates, currentSession, seekToDateTime, stepMinutes, toSOD, toEOD, dayStep,
    // emitters
    placeEntry, squareOffLeg, squareOffGroup, squareOffAll, resetTrades, setLimits,
  }
}
