// StockMock-style time navigation: jump to any date + time, or step the clock by fixed
// increments (±1m/5m/15m/30m/2h), SOD/EOD, prev/next day. Every control just moves the
// clock index in the hook (pure). Hour/minute selects let you start the replay at, say,
// 10:25 instead of always 09:15.
import { dow } from './fmt.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtD = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  const u = Math.floor(Date.UTC(+y, +m - 1, +d) / 1000)
  return `${dow(u)}, ${+d} ${MONTHS[+m - 1]} ${y}`
}
const BACK = [['-2h', -120], ['-30m', -30], ['-15m', -15], ['-5m', -5], ['-1m', -1]]
const FWD = [['1m', 1], ['5m', 5], ['15m', 15], ['30m', 30], ['2h', 120]]
const HOURS = [9, 10, 11, 12, 13, 14, 15]
const MINUTES = Array.from({ length: 60 }, (_, i) => i)
const pad = (n) => String(n).padStart(2, '0')

// One-line summary of a jump-to-event for its chip tooltip.
const fmtDetail = (ev) => {
  const d = ev.detail || {}
  switch (ev.key) {
    case 'spot_move':
    case 'spot_up':
    case 'spot_down':
      return `${d.delta > 0 ? '+' : ''}${d.delta?.toFixed(1)} pts`
    case 'dd_trough':
      return `₹${Math.round(d.drawdown)}`
    case 'mtm_peak':
    case 'mtm_low':
      return `₹${Math.round(d.equity)}`
    case 'expiry_start':
      return d.date
    default:
      return ''
  }
}

export default function TimeBar({ sim }) {
  const { t, currentSession, sessionDates, seekToDateTime, stepMinutes, toSOD, toEOD, dayStep, events, jumpTo, clockIndex } = sim
  if (t == null || !currentSession) return null
  const d = new Date(t * 1000)
  const hh = d.getUTCHours()
  const mm = d.getUTCMinutes()
  const date = currentSession.date
  const di = sessionDates.indexOf(date)

  const Btn = ({ onClick, disabled, children, title, active }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-30 ${
        active ? 'border-sky-600 bg-sky-600 text-white' : 'border-edge bg-panel text-slate-300 hover:bg-edge hover:text-white'
      }`}
    >
      {children}
    </button>
  )
  const Sel = ({ value, onChange, children, title }) => (
    <select value={value} onChange={onChange} title={title} className="rounded border border-edge bg-panel px-1.5 py-0.5 font-mono text-[11px] text-slate-200 outline-none focus:border-sky-600">
      {children}
    </select>
  )

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-edge bg-panel2 px-3 py-1">
      <Btn onClick={() => dayStep(-1)} disabled={di <= 0} title="Previous trading day">« Day</Btn>
      <Btn onClick={toSOD} title="Start of day (09:15)">SOD</Btn>
      {BACK.map(([l, n]) => <Btn key={l} onClick={() => stepMinutes(n)} title={`Back ${l.slice(1)}`}>{l}</Btn>)}

      <span className="mx-1 h-4 w-px bg-edge" />
      <Sel value={date} onChange={(e) => seekToDateTime(e.target.value, hh, mm)} title="Trading day">
        {sessionDates.map((dt) => <option key={dt} value={dt}>{fmtD(dt)}</option>)}
      </Sel>
      <Sel value={hh} onChange={(e) => seekToDateTime(date, +e.target.value, mm)} title="Hour">
        {HOURS.map((h) => <option key={h} value={h}>{pad(h)}</option>)}
      </Sel>
      <span className="text-slate-500">:</span>
      <Sel value={mm} onChange={(e) => seekToDateTime(date, hh, +e.target.value)} title="Minute">
        {MINUTES.map((m) => <option key={m} value={m}>{pad(m)}</option>)}
      </Sel>
      <span className="mx-1 h-4 w-px bg-edge" />

      {FWD.map(([l, n]) => <Btn key={l} onClick={() => stepMinutes(n)} title={`Forward ${l}`}>+{l}</Btn>)}
      <Btn onClick={toEOD} title="End of day (15:29)">EOD</Btn>
      <Btn onClick={() => dayStep(1)} disabled={di >= sessionDates.length - 1} title="Next trading day">Day »</Btn>

      {/* jump-to-event chips: seek the clock to notable moments (auto-detected, off the clock) */}
      {events?.length > 0 && (
        <div className="mt-1 flex w-full flex-wrap items-center gap-1 border-t border-edge/60 pt-1">
          <span className="mr-1 text-[10px] uppercase tracking-wide text-slate-500">Jump to</span>
          {events.map((ev) => (
            <Btn key={ev.key} onClick={() => jumpTo(ev.index)} active={ev.index === clockIndex} title={`${ev.label} — ${fmtDetail(ev)}`}>
              {ev.label}
            </Btn>
          ))}
        </div>
      )}
    </div>
  )
}
