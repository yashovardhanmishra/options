// Template themes for the Nifty Options app. Deliberately mirrors StratosAI's
// registry (same ids + same localStorage key) so a theme picked in either app
// carries across the whole site (both are served from the same origin).

export const THEME_STORAGE_KEY = 'stratos-theme'
export const DEFAULT_THEME = 'cosmic'

export const THEMES = [
  { id: 'cosmic', name: 'Stratos Classic', mode: 'dark' },
  { id: 'neumorphic', name: 'Neumorphic Soft', mode: 'light' },
  { id: 'bento', name: 'Bento Modular', mode: 'dark' },
  { id: 'swiss', name: 'Swiss Grid', mode: 'light' },
  { id: 'glass', name: 'Liquid Glass', mode: 'light' },
  { id: 'mesh', name: 'Gradient Mesh', mode: 'light' },
  { id: 'y2k', name: 'Y2K Vapor Chrome', mode: 'light' },
  { id: 'japanese', name: 'Japanese Minimal', mode: 'light' },
]

export const MODE_STORAGE_KEY = 'stratos-mode'

const MODES = Object.fromEntries(THEMES.map((t) => [t.id, t.mode]))
const IDS = new Set(THEMES.map((t) => t.id))

export function isThemeId(v) {
  return typeof v === 'string' && IDS.has(v)
}

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeId(v) ? v : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

// ── Light / dark MODE (orthogonal to the template; shared with StratosAI) ──
export function naturalMode(id) {
  return MODES[isThemeId(id) ? id : DEFAULT_THEME]
}

export function getStoredMode() {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

export function effectiveMode(id) {
  return getStoredMode() ?? naturalMode(id)
}

export function applyTheme(id) {
  const theme = isThemeId(id) ? id : DEFAULT_THEME
  const mode = effectiveMode(theme)
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.setAttribute('data-mode', mode)
  root.style.colorScheme = mode
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* storage unavailable — applies for the session only */
  }
}

/** Set the global light/dark mode and apply it. */
export function applyMode(mode) {
  const m = mode === 'light' || mode === 'dark' ? mode : 'dark'
  const root = document.documentElement
  root.setAttribute('data-mode', m)
  root.style.colorScheme = m
  try {
    localStorage.setItem(MODE_STORAGE_KEY, m)
  } catch {
    /* storage unavailable */
  }
}

// ── Chart theming ──────────────────────────────────────────────────────────
// lightweight-charts needs concrete color strings (it can't read CSS vars), so
// resolve the active theme's `--opt-*` tokens at runtime and feed them in. The
// canvas charts then follow the theme instead of being permanently dark.

/** Read a CSS custom property off <html>, trimmed; falls back when unset/SSR. */
export function cssVar(name, fallback = '') {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Partial lightweight-charts options (colors only) for the active theme.
 *  Safe to pass to chart.applyOptions() — it deep-merges, so structural options
 *  (formatters, fontFamily, …) set at creation are preserved. */
export function chartThemeOptions() {
  const ink = cssVar('--opt-ink', '#0a0e14')
  const text = cssVar('--opt-muted', '#8b9bb0')
  const edge = cssVar('--opt-edge', 'rgba(40,54,74,0.35)')
  return {
    layout: { background: { color: ink }, textColor: text },
    grid: { vertLines: { color: edge }, horzLines: { color: edge } },
    rightPriceScale: { borderColor: edge },
    timeScale: { borderColor: edge },
  }
}

/** Run `cb` whenever the active theme OR the light/dark mode changes (both are
 *  attributes on <html>). Returns an unsubscribe fn. No-op on the server.
 *  NOTE: must watch `data-mode` too — else toggling light/dark while a canvas
 *  chart is open wouldn't re-skin it until a refresh. */
export function onThemeChange(cb) {
  if (typeof MutationObserver === 'undefined') return () => {}
  const obs = new MutationObserver(() => cb())
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-mode'] })
  return () => obs.disconnect()
}
