import { useEffect, useState } from 'react'
import { format, parse } from 'date-fns'
import { getExpiries, getDates, getTimes, getChain } from './api'
import OptionChain from './components/OptionChain'
import ChartPanel from './components/ChartPanel'
import SearchBar from './components/SearchBar'

const fmtDate = (iso) => {
  try {
    return format(parse(iso, 'yyyy-MM-dd', new Date()), 'dd MMM yyyy (EEE)')
  } catch {
    return iso
  }
}

export default function App() {
  const [expiries, setExpiries] = useState([])
  const [expiry, setExpiry] = useState('')
  const [dates, setDates] = useState([])
  const [date, setDate] = useState('')
  const [times, setTimes] = useState([])
  const [time, setTime] = useState('') // '' = end-of-day (last row)
  const [chain, setChain] = useState([])
  const [chainLoading, setChainLoading] = useState(false)
  const [selection, setSelection] = useState(null) // { expiry, strike, type }
  const [chainOpen, setChainOpen] = useState(true) // left panel visible?

  // expiries on mount
  useEffect(() => {
    getExpiries()
      .then((list) => {
        setExpiries(list)
        if (list.length) setExpiry(list[0])
      })
      .catch(() => setExpiries([]))
  }, [])

  // dates when expiry changes -> default to latest date
  useEffect(() => {
    if (!expiry) return
    let cancelled = false
    getDates(expiry)
      .then((list) => {
        if (cancelled) return
        setDates(list)
        setDate(list.length ? list[list.length - 1] : '')
      })
      .catch(() => {
        if (!cancelled) {
          setDates([])
          setDate('')
        }
      })
    return () => {
      cancelled = true
    }
  }, [expiry])

  // intraday times when expiry + date set -> default to latest time
  useEffect(() => {
    if (!expiry || !date) {
      setTimes([])
      setTime('')
      return
    }
    let cancelled = false
    getTimes(expiry, date)
      .then((list) => {
        if (cancelled) return
        setTimes(list)
        setTime(list.length ? list[list.length - 1] : '')
      })
      .catch(() => {
        if (!cancelled) {
          setTimes([])
          setTime('')
        }
      })
    return () => {
      cancelled = true
    }
  }, [expiry, date])

  // chain when expiry + date (+ time) set
  useEffect(() => {
    if (!expiry || !date) {
      setChain([])
      return
    }
    let cancelled = false
    setChainLoading(true)
    getChain(expiry, date, time)
      .then((rows) => !cancelled && setChain(rows))
      .catch(() => !cancelled && setChain([]))
      .finally(() => !cancelled && setChainLoading(false))
    return () => {
      cancelled = true
    }
  }, [expiry, date, time])

  const handleChainSelect = (strike, type) =>
    setSelection({ expiry, strike, type })

  const handleSearchSelect = (r) => {
    setExpiry(r.expiry) // re-points the chain to the matching expiry
    setSelection({ expiry: r.expiry, strike: r.strike, type: r.type })
  }

  // Closing the chart drops the selection and always brings the chain back, so
  // there's never a blank screen. Closing the chain just hides the left panel.
  const closeChart = () => {
    setSelection(null)
    setChainOpen(true)
  }
  const closeChain = () => setChainOpen(false)
  const openChain = () => setChainOpen(true)

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink text-slate-200">
      {/* Top app bar */}
      <header className="flex items-center gap-4 border-b border-edge bg-panel px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-5 w-1.5 rounded-full bg-gradient-to-b from-sky-400 to-orange-400" />
          <h1 className="text-sm font-bold tracking-wide text-slate-100">
            NIFTY OPTIONS <span className="text-slate-500">— chain &amp; chart</span>
          </h1>
        </div>
        {!chainOpen && (
          <button
            onClick={openChain}
            title="Show the option chain"
            className="flex items-center gap-1.5 rounded-md border border-sky-700/60 bg-sky-600/15 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-600/30"
          >
            <span className="text-sm leading-none">▤</span> Option Chain
          </button>
        )}

        <div className="ml-auto">
          <SearchBar onSelect={handleSearchSelect} />
        </div>
      </header>

      {/* Body — chain (left) + chart (right); closing one expands the other */}
      <main className="flex min-h-0 flex-1 flex-row">
        {/* LEFT — option chain */}
        {chainOpen && (
          <section className="flex min-h-0 flex-1 flex-col border-r border-edge">
            {/* chain controls */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge bg-panel2 px-3 py-2 text-sm">
              <label className="flex items-center gap-1.5">
                <span className="text-xs uppercase tracking-wide text-slate-500">Expiry</span>
                <select
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  className="rounded border border-edge bg-panel px-2 py-1 text-slate-200 outline-none focus:border-sky-600"
                >
                  {expiries.map((e) => (
                    <option key={e} value={e}>
                      {format(parse(e, 'yyyy-MM-dd', new Date()), 'dd MMM yyyy')}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-1.5">
                <span className="text-xs uppercase tracking-wide text-slate-500">Date</span>
                <select
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded border border-edge bg-panel px-2 py-1 text-slate-200 outline-none focus:border-sky-600"
                >
                  {dates.map((d) => (
                    <option key={d} value={d}>
                      {fmtDate(d)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-1.5">
                <span className="text-xs uppercase tracking-wide text-slate-500">Time</span>
                <select
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  disabled={times.length === 0}
                  title="Chain snapshot as of this time"
                  className="rounded border border-edge bg-panel px-2 py-1 font-mono tabular-nums text-slate-200 outline-none focus:border-sky-600 disabled:opacity-40"
                >
                  {times.length === 0 && <option value="">—</option>}
                  {times.map((t, i) => (
                    <option key={t} value={t}>
                      {t}
                      {i === times.length - 1 ? '  (EOD)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
                {chainLoading ? (
                  <span className="text-sky-400">Loading chain…</span>
                ) : (
                  <span>{chain.length} strikes</span>
                )}
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-amber-400/70" /> ATM
                </span>
                {selection && (
                  <button
                    onClick={closeChain}
                    title="Close chain (maximize chart)"
                    className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-edge hover:text-white"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <OptionChain
                chain={chain}
                loading={chainLoading || (!!expiry && !date)}
                onSelect={handleChainSelect}
                selected={
                  selection && selection.expiry === expiry
                    ? { strike: selection.strike, type: selection.type }
                    : null
                }
              />
            </div>
          </section>
        )}

        {/* RIGHT — chart */}
        {selection && (
          <section className="flex min-h-0 flex-1 flex-col">
            <ChartPanel selection={selection} onClose={closeChart} />
          </section>
        )}

        {/* Fallback: both hidden (rare) */}
        {!chainOpen && !selection && (
          <div className="flex flex-1 items-center justify-center">
            <button
              onClick={openChain}
              className="rounded-md border border-edge bg-panel2 px-4 py-2 text-sm text-slate-300 hover:bg-edge"
            >
              Show Option Chain
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
