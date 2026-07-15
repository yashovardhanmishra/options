import { useEffect, useRef, useState } from 'react'
import { format, parse } from 'date-fns'
import { search as apiSearch } from '../api'

function fmtExpiry(iso) {
  try {
    return format(parse(iso, 'yyyy-MM-dd', new Date()), 'dd MMM yyyy')
  } catch {
    return iso
  }
}

/**
 * Global instrument search. Type "22500CE", "22500 PE" or just "22500".
 * Selecting a result calls onSelect({ expiry, strike, type }).
 */
export default function SearchBar({ onSelect }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef(null)
  const timer = useRef(null)
  const reqId = useRef(0) // monotonically increasing token; stale responses are dropped

  // Debounced search
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const term = q.trim()
    if (term.length < 2) {
      reqId.current += 1 // invalidate any in-flight request
      setResults([])
      setOpen(false)
      setLoading(false)
      return
    }
    setLoading(true)
    timer.current = setTimeout(() => {
      const id = ++reqId.current
      apiSearch(term)
        .then((data) => {
          if (id !== reqId.current) return // a newer request superseded this one
          setResults(data)
          setActive(0)
          setOpen(true)
        })
        .catch(() => {
          if (id === reqId.current) setResults([])
        })
        .finally(() => {
          if (id === reqId.current) setLoading(false)
        })
    }, 200)
    return () => timer.current && clearTimeout(timer.current)
  }, [q])

  // Close on outside click
  useEffect(() => {
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (r) => {
    onSelect(r)
    setQ(`${r.strike}${r.type}`)
    setOpen(false)
  }

  const onKey = (e) => {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(results[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search 22500CE / 22500 PE …"
          className="w-full rounded-md border border-edge bg-panel2 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-600 focus:ring-1 focus:ring-sky-700/50"
          spellCheck={false}
          autoComplete="off"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">
            …
          </span>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-md border border-edge bg-panel2 py-1 shadow-2xl shadow-black/60">
          {results.map((r, i) => (
            <li
              key={`${r.expiry}-${r.strike}-${r.type}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(r)
              }}
              className={`flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm ${
                i === active ? 'bg-sky-900/40' : ''
              }`}
            >
              <span className="font-mono tabular-nums">
                <span className="text-slate-100">{r.strike}</span>{' '}
                <span
                  className={
                    r.type === 'CE' ? 'text-sky-400' : 'text-orange-400'
                  }
                >
                  {r.type}
                </span>
              </span>
              <span className="text-xs text-slate-400">{fmtExpiry(r.expiry)}</span>
            </li>
          ))}
        </ul>
      )}

      {open && !loading && results.length === 0 && q.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-edge bg-panel2 px-3 py-2 text-xs text-slate-500">
          No instrument matches “{q.trim()}”.
        </div>
      )}
    </div>
  )
}
