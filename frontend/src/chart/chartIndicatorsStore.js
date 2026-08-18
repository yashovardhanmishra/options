// Per-instrument APPLIED-INDICATOR persistence for the options viewer — localStorage, so the
// indicators/patterns a user adds to a chart survive a refresh (mirrors the drawing store). Scoped
// by the SAME instrument `key` the drawings use ('spot' or `<expiry>_<strike><CE|PE>`). Best-effort:
// a storage failure just means it doesn't persist; never throws into the chart UI.

const PREFIX = 'optind:'

/** Load saved applied-indicator state for an instrument → Promise<{ indicators, patterns, patternCode }
 *  | null>. Returns a RESOLVED promise (localStorage is sync) so the caller can arm its save-gate in
 *  the `.then` microtask — that defers the gate past React StrictMode's synchronous double-invoke of
 *  the save effect, which would otherwise flush the stale empty state over the saved set (same reason
 *  chartDrawingsStore.loadDrawings is async). */
export function loadIndicators(key) {
  if (!key) return Promise.resolve(null)
  try {
    const raw = localStorage.getItem(PREFIX + key)
    const o = raw ? JSON.parse(raw) : null
    return Promise.resolve(o && typeof o === 'object' ? o : null)
  } catch {
    return Promise.resolve(null)
  }
}

/** Persist the applied-indicator state for an instrument (overwrites its entry). Best-effort. */
export function saveIndicators(key, data) {
  if (!key) return
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(data))
  } catch {
    /* storage unavailable — applies for the session only */
  }
}
