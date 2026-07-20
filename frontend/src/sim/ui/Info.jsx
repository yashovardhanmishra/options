// Reusable inline "ⓘ" hint: hover or keyboard-focus reveals a small theme-aware popover with
// a plain-language explainer (copy from strategy/explainers.js). The popover is rendered in a
// PORTAL at <body> (position: fixed) so it escapes panel clipping (overflow-auto) AND the
// cosmic frosted-glass stacking context — a backdrop-filter ancestor would otherwise trap an
// absolutely-positioned tooltip behind neighbouring panels. The native `title` attribute stays
// as the guaranteed fallback (touch / no-JS).
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { explainer } from '../strategy/explainers.js'

// side → where the popover sits relative to the trigger's viewport rect (fixed coords + transform)
function place(r, side) {
  const gap = 6
  switch (side) {
    case 'top':
      return { top: r.top - gap, left: r.left + r.width / 2, transform: 'translate(-50%,-100%)' }
    case 'right':
      return { top: r.top + r.height / 2, left: r.right + gap, transform: 'translate(0,-50%)' }
    case 'left':
      return { top: r.top + r.height / 2, left: r.left - gap, transform: 'translate(-100%,-50%)' }
    default:
      return { top: r.bottom + gap, left: r.left + r.width / 2, transform: 'translate(-50%,0)' }
  }
}

export default function Info({ k, side = 'bottom', title, body }) {
  const e = k ? explainer(k) : null
  const head = title ?? e?.t
  const text = body ?? e?.d
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  const open = useCallback(() => {
    const el = ref.current
    if (el) setPos(place(el.getBoundingClientRect(), side))
  }, [side])
  const close = useCallback(() => setPos(null), [])

  // Fixed coords go stale on scroll/resize — the popover is transient, so just close it.
  useEffect(() => {
    if (!pos) return
    const onMove = () => setPos(null)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [pos])

  if (!text) return null

  return (
    <span className="inline-flex align-middle">
      <span
        ref={ref}
        tabIndex={0}
        role="button"
        aria-label={head ? `${head}: ${text}` : text}
        title={head ? `${head} — ${text}` : text}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        className="inline-flex h-3.5 w-3.5 cursor-help select-none items-center justify-center rounded-full border border-edge text-[8px] font-bold normal-case leading-none text-slate-500 outline-none transition-colors hover:border-sky-500 hover:text-sky-400 focus:border-sky-500 focus:text-sky-400"
      >
        i
      </span>
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ position: 'fixed', top: pos.top, left: pos.left, transform: pos.transform, zIndex: 9999 }}
            className="pointer-events-none w-56 rounded-md border border-edge bg-panel2 px-2.5 py-1.5 text-left normal-case tracking-normal shadow-xl"
          >
            {head && (
              <span className="mb-0.5 block text-[11px] font-semibold text-slate-100">{head}</span>
            )}
            <span className="block text-[10.5px] font-normal leading-snug text-slate-400">{text}</span>
          </span>,
          document.body,
        )}
    </span>
  )
}
