// Per-instrument chart-drawing persistence for the options viewer — localStorage replacement
// for StratosAI's Supabase-backed chart-drawings-store. Same interface the ChartDrawingLayer
// imports (loadDrawings / saveDrawings), scoped by the instrument `key`. Best-effort: never
// throws into the chart UI (a storage failure just means drawings don't persist).
//
// `loadDrawings` returns a resolved Promise so the layer's existing `.then(...)` load flow works
// unchanged; `saveDrawings` is fire-and-forget (the layer calls it with `void`).

const PREFIX = "optdraw:";

/** Load saved drawings for an instrument. [] when none / bad JSON / storage unavailable. */
export function loadDrawings(key) {
  if (!key) return Promise.resolve([]);
  try {
    const raw = localStorage.getItem(PREFIX + key);
    const arr = raw ? JSON.parse(raw) : [];
    return Promise.resolve(Array.isArray(arr) ? arr : []);
  } catch {
    return Promise.resolve([]);
  }
}

/** Persist the drawings for an instrument (overwrites its row). Best-effort. */
export function saveDrawings(key, drawings) {
  if (!key) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(drawings));
  } catch {
    /* storage unavailable — applies for the session only */
  }
}
