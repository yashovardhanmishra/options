import { useState } from 'react'
import { THEMES, getStoredTheme, applyTheme, effectiveMode, applyMode } from '../theme'

const SunIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)
const MoonIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
)

/**
 * Compact template-theme picker + light/dark toggle for the header. Writes the
 * shared `stratos-theme` / `stratos-mode` localStorage keys, so the choice also
 * applies to StratosAI.
 */
export default function ThemeSwitcher() {
  const [theme, setTheme] = useState(getStoredTheme())
  const [mode, setMode] = useState(effectiveMode(getStoredTheme()))

  const onThemeChange = (e) => {
    const id = e.target.value
    setTheme(id)
    applyTheme(id)
    setMode(effectiveMode(id)) // effective mode can change with the theme
  }

  const toggleMode = () => {
    const next = mode === 'dark' ? 'light' : 'dark'
    applyMode(next)
    setMode(next)
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={toggleMode}
        title={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`}
        aria-label="Toggle light/dark mode"
        className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-edge bg-panel2 text-slate-300 hover:bg-edge hover:text-slate-100"
      >
        {mode === 'dark' ? <MoonIcon /> : <SunIcon />}
      </button>
      <label
        className="flex items-center gap-1.5 rounded-md border border-edge bg-panel2 px-2 py-1 text-xs text-slate-300"
        title="Switch the app theme (shared with StratosAI)"
      >
        <select
          value={theme}
          onChange={onThemeChange}
          className="cursor-pointer bg-transparent text-xs text-slate-300 outline-none"
          aria-label="Theme"
        >
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
