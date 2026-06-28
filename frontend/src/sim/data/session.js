// Loads a chosen expiry across multiple trading days and stitches them into one
// instrument set + a concatenated timeline. (Multi-EXPIRY stitching is deferred.)
import { loadDay } from './client.js'
import { buildTimeline } from '../replay/timeline.js'
import { buildSession } from './snapshot.js'

/** Sorted union of a chain_day response's bar minutes (the day's trading minutes). */
export function dayMinutes(day) {
  const set = new Set()
  for (const it of day.instruments) for (const b of it.bars) set.add(b[0]) // b[0] = unix
  return [...set].sort((a, b) => a - b)
}

/** Merge per-day chain_day responses -> one instrument list, bars concatenated by key. */
export function mergeInstruments(days) {
  const byKey = new Map()
  for (const day of days) {
    for (const it of day.instruments) {
      const k = `${it.strike}${it.type}`
      const cur = byKey.get(k)
      if (cur) cur.bars.push(...it.bars)
      else byKey.set(k, { strike: it.strike, type: it.type, bars: [...it.bars] })
    }
  }
  return [...byKey.values()]
}

/**
 * Load the replay for one expiry over `dates`. Returns the stitched instruments and the
 * timeline; pass spot bars + expiries to also build the snapshot session (for Greeks).
 */
export async function loadReplay({ base, expiry, dates, token, spotBars, expiries }) {
  const loaded = await Promise.all(dates.map((d) => loadDay(base, expiry, d, token).then((day) => ({ date: d, day }))))
  loaded.sort((a, b) => (a.date < b.date ? -1 : 1))
  const instruments = mergeInstruments(loaded.map((x) => x.day))
  const timeline = buildTimeline(loaded.map((x) => ({ date: x.date, minutes: dayMinutes(x.day) })))
  const session = spotBars ? buildSession({ expiry, expiries, spotBars, instruments }) : null
  return { expiry, dates, instruments, timeline, session }
}
