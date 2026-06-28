// The replay timeline: the concatenated, in-order union of the ACTUAL bar minutes
// per trading day. The clock is an INDEX into `times` — overnight gaps, holidays and
// half-days are simply absent because we only include minutes that have bars, so the
// clock can never land on a dead minute. `sessions` mark where the calendar day
// changes, so stepping from a day's last bar lands on the next day's first bar with
// no interpolation across the gap. PURE — `unix` is treated as an opaque ordered int.
import { sessionUnix } from '../engine/time.js'

/**
 * @param {Array<{date:string, minutes:number[]}>} perDay  ascending by date; `minutes`
 *        is that day's sorted union of bar unix keys.
 * @returns {{ times:number[], sessions:Array<{date,startIndex,endIndex,startUnix,endUnix}> }}
 */
export function buildTimeline(perDay) {
  const times = []
  const sessions = []
  for (const { date, minutes } of perDay) {
    if (!minutes || !minutes.length) continue
    const startIndex = times.length
    for (const u of minutes) times.push(u)
    sessions.push({
      date,
      startIndex,
      endIndex: times.length - 1,
      startUnix: minutes[0],
      endUnix: minutes[minutes.length - 1],
    })
  }
  return { times, sessions }
}

export const clampIndex = (tl, i) => Math.max(0, Math.min(tl.times.length - 1, i | 0))
export const stepIndex = (tl, i, n = 1) => clampIndex(tl, i + n)

/** Nearest index whose time <= unix (scrub-to-time); -1 if before the first bar. */
export function indexAtOrBefore(tl, unix) {
  const t = tl.times
  let lo = 0
  let hi = t.length - 1
  let ans = -1
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (t[m] <= unix) { ans = m; lo = m + 1 } else hi = m - 1
  }
  return ans
}

/** Nearest index whose time >= unix; tl.times.length if after the last bar. */
export function indexAtOrAfter(tl, unix) {
  const t = tl.times
  let lo = 0
  let hi = t.length - 1
  let ans = t.length
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (t[m] >= unix) { ans = m; hi = m - 1 } else lo = m + 1
  }
  return ans
}

/** Session containing index i. Fails fast on an empty timeline (a no-data bug). */
export function sessionOf(tl, i) {
  const s = tl.sessions
  if (!s.length) throw new Error('sessionOf: timeline has no sessions (no bars loaded)')
  let lo = 0
  let hi = s.length - 1
  let ans = 0
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (s[m].startIndex <= i) { ans = m; lo = m + 1 } else hi = m - 1
  }
  return s[ans]
}

export const isSessionStart = (tl, i) => tl.sessions.some((s) => s.startIndex === i)
export const isSessionEnd = (tl, i) => tl.sessions.some((s) => s.endIndex === i)

/** Jump-to-date: index of the first bar of `date` (or the nearest later session). */
export function indexOfDateStart(tl, date) {
  const s = tl.sessions.find((x) => x.date === date)
  return s ? s.startIndex : clampIndex(tl, indexAtOrAfter(tl, sessionUnix(date, 0, 0)))
}

/** Jump to a specific minute (HH:MM) of a date — clamped within that session. */
export function indexOfDateTime(tl, date, hh = 9, mm = 15) {
  const s = tl.sessions.find((x) => x.date === date)
  if (!s) return clampIndex(tl, indexAtOrAfter(tl, sessionUnix(date, hh, mm)))
  let idx = indexAtOrBefore(tl, sessionUnix(date, hh, mm))
  if (idx < s.startIndex) idx = s.startIndex // before the day's first bar -> first bar
  else if (idx > s.endIndex) idx = s.endIndex // after the day's last bar -> last bar
  return idx
}
