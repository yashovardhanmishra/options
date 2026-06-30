// Reusable inline "ⓘ" hint: hover or keyboard-focus reveals a small theme-aware popover with
// a plain-language explainer (copy from strategy/explainers.js). Pure CSS — Tailwind named
// group-hover / group-focus-within, no deps, no JS state. The native `title` attribute is the
// guaranteed fallback when the popover is clipped (inside overflow-auto) or on touch.
import { explainer } from '../strategy/explainers.js'

const SIDE = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
}

export default function Info({ k, side = 'bottom', title, body }) {
  const e = k ? explainer(k) : null
  const head = title ?? e?.t
  const text = body ?? e?.d
  if (!text) return null

  return (
    <span className="group/info relative inline-flex align-middle">
      <span
        tabIndex={0}
        role="button"
        aria-label={head ? `${head}: ${text}` : text}
        title={head ? `${head} — ${text}` : text}
        className="inline-flex h-3.5 w-3.5 cursor-help select-none items-center justify-center rounded-full border border-edge text-[8px] font-bold normal-case leading-none text-slate-500 outline-none transition-colors hover:border-sky-500 hover:text-sky-400 focus:border-sky-500 focus:text-sky-400"
      >
        i
      </span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 hidden w-56 rounded-md border border-edge bg-panel2 px-2.5 py-1.5 text-left normal-case tracking-normal shadow-xl group-hover/info:block group-focus-within/info:block ${SIDE[side] || SIDE.bottom}`}
      >
        {head && <span className="mb-0.5 block text-[11px] font-semibold text-slate-100">{head}</span>}
        <span className="block text-[10.5px] font-normal leading-snug text-slate-400">{text}</span>
      </span>
    </span>
  )
}
