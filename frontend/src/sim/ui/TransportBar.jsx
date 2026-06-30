// Transport: play/pause, speed, step, and the intraday scrubber over the whole timeline
// (it crosses session/day boundaries because the timeline is the concatenated union of
// real bar minutes — step 3). Pure controls: every button just moves the clock index or
// flips playing/speed in the hook. The readout is derived from the clock unix.
import { hhmm, dateLabel, dow } from './fmt.js'

// Playback cadence: advance N candles every M seconds (explicit, not an abstract speed).
const CANDLE_OPTS = [1, 2, 3, 5, 10]
const INTERVAL_OPTS = [1, 2, 5, 10, 30]

export default function TransportBar({ sim }) {
  const {
    clockIndex, len, t, timeline, playing, setPlaying,
    candlesPerStep, setCandlesPerStep, intervalSec, setIntervalSec,
    seek, stepBy, book, chainSnap,
  } = sim
  const atEnd = clockIndex >= len - 1
  const atStart = clockIndex <= 0
  const session = timeline?.sessions.find((s) => clockIndex >= s.startIndex && clockIndex <= s.endIndex)

  const Btn = ({ onClick, disabled, title, children, active }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-7 min-w-7 items-center justify-center rounded px-2 text-xs font-medium transition-colors disabled:opacity-30 ${
        active ? 'bg-sky-600 text-white' : 'border border-edge bg-panel2 text-slate-300 hover:bg-edge hover:text-white'
      }`}
    >
      {children}
    </button>
  )

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge bg-panel px-3 py-2">
      <div className="flex items-center gap-1">
        <Btn onClick={() => seek(0)} disabled={atStart} title="To start">⏮</Btn>
        <Btn onClick={() => stepBy(-1)} disabled={atStart} title="Step back one bar">◀</Btn>
        <Btn onClick={() => setPlaying((p) => !p)} disabled={atEnd} title={playing ? 'Pause' : 'Play'} active={playing}>
          {playing ? '⏸' : '▶'}
        </Btn>
        <Btn onClick={() => stepBy(1)} disabled={atEnd} title="Step forward one bar">▶|</Btn>
        <Btn onClick={() => seek(len - 1)} disabled={atEnd} title="To end">⏭</Btn>
      </div>

      {/* Playback speed: N candles every M seconds (explicit, watchable). */}
      <div className="flex items-center gap-1.5" title="Auto-play advances this many candles per tick">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">Step</span>
        <div className="flex items-center gap-0.5">
          {CANDLE_OPTS.map((n) => (
            <Btn key={n} onClick={() => setCandlesPerStep(n)} active={candlesPerStep === n} title={`Advance ${n} candle${n > 1 ? 's' : ''} per tick`}>
              {n}
            </Btn>
          ))}
        </div>
        <span className="text-[10px] text-slate-500">candle{candlesPerStep > 1 ? 's' : ''} every</span>
        <div className="flex items-center gap-0.5" title="Real seconds between ticks">
          {INTERVAL_OPTS.map((s) => (
            <Btn key={s} onClick={() => setIntervalSec(s)} active={intervalSec === s} title={`One tick every ${s}s`}>
              {s}s
            </Btn>
          ))}
        </div>
      </div>

      {/* scrubber across the whole timeline */}
      <div className="flex min-w-[220px] flex-1 items-center gap-2">
        <input
          type="range"
          min={0}
          max={Math.max(0, len - 1)}
          value={clockIndex}
          onChange={(e) => seek(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-edge accent-sky-500"
          title="Scrub the replay clock"
        />
        <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-slate-500">
          {clockIndex + 1}/{len}
        </span>
      </div>

      {/* clock + market readout, all derived from the clock unix */}
      <div className="flex items-center gap-3 font-mono text-xs tabular-nums">
        <span className="text-slate-400" title={session?.date}>
          {dateLabel(t)} <span className="text-slate-600">{dow(t)}</span>
        </span>
        <span className="rounded bg-panel2 px-2 py-0.5 font-semibold text-sky-300">{hhmm(t)}</span>
        <span className="text-slate-400">
          Spot <span className="font-semibold text-slate-100">{chainSnap?.S != null ? chainSnap.S.toFixed(1) : '—'}</span>
        </span>
        {book && (
          <span className="text-slate-400">
            Δ <span className="font-semibold text-slate-200">{Math.round(book.greeks.delta)}</span>
          </span>
        )}
      </div>
    </div>
  )
}
