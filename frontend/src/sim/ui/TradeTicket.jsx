// Buy/sell ticket shown when a chain LTP is clicked. It only COLLECTS side + lots and
// emits placeEntry; the fill price is the LTP at the current clock (captured in the hook).
import { useState } from 'react'
import { money } from './fmt.js'

export default function TradeTicket({ pick, chainSnap, lotSize, onPlace, onClose }) {
  const [side, setSide] = useState(1) // +1 buy, -1 sell
  const [lots, setLots] = useState(1)
  if (!pick) return null

  const row = chainSnap?.chain?.find((r) => r.strike === pick.strike)
  const ltp = pick.type === 'CE' ? row?.ce?.ltp : row?.pe?.ltp
  const ok = ltp != null && lots > 0

  const place = () => { if (ok) { onPlace({ strike: pick.strike, type: pick.type, side, lots: Number(lots) }); onClose() } }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[300px] rounded-lg border border-edge bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">
            {pick.strike} <span className={pick.type === 'CE' ? 'text-sky-400' : 'text-orange-400'}>{pick.type}</span>
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
        </div>

        <div className="mb-3 flex items-center justify-between rounded bg-panel2 px-3 py-2 text-xs">
          <span className="text-slate-500">LTP</span>
          <span className="font-mono font-semibold text-slate-100">{ltp != null ? ltp.toFixed(2) : '—'}</span>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => setSide(1)}
            className={`rounded py-2 text-sm font-semibold ${side === 1 ? 'bg-emerald-600 text-white' : 'border border-edge bg-panel2 text-slate-300'}`}
          >
            Buy
          </button>
          <button
            onClick={() => setSide(-1)}
            className={`rounded py-2 text-sm font-semibold ${side === -1 ? 'bg-red-600 text-white' : 'border border-edge bg-panel2 text-slate-300'}`}
          >
            Sell
          </button>
        </div>

        <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
          <span>Lots</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setLots((l) => Math.max(1, l - 1))}
              className="flex h-7 w-7 items-center justify-center rounded border border-edge bg-panel2 text-lg font-bold leading-none text-slate-300 hover:bg-edge hover:text-white"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              value={lots}
              onChange={(e) => setLots(Math.max(1, Number(e.target.value) | 0))}
              className="w-14 rounded border border-edge bg-panel2 px-1 py-1 text-center font-mono text-slate-100 outline-none focus:border-sky-600"
            />
            <button
              type="button"
              onClick={() => setLots((l) => l + 1)}
              className="flex h-7 w-7 items-center justify-center rounded border border-edge bg-panel2 text-lg font-bold leading-none text-slate-300 hover:bg-edge hover:text-white"
            >
              +
            </button>
          </div>
        </div>

        {lotSize != null && (
          <div className="mb-3 flex items-center justify-between text-[11px] text-slate-500">
            <span>Quantity</span>
            <span className="font-mono text-slate-300">
              {(lots * lotSize).toLocaleString('en-IN')}{' '}
              <span className="text-slate-600">
                ({lots} × {lotSize})
              </span>
            </span>
          </div>
        )}

        <div className="mb-3 flex items-center justify-between text-[11px] text-slate-500">
          <span>Premium ({side === 1 ? 'pay' : 'collect'})</span>
          <span className="font-mono">
            {ltp != null
              ? `≈ ${money(lots * (lotSize || 1) * ltp)}`
              : '—'}
          </span>
        </div>

        <button
          onClick={place}
          disabled={!ok}
          className={`w-full rounded py-2 text-sm font-bold disabled:opacity-40 ${side === 1 ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'} text-white`}
        >
          {side === 1 ? 'Buy' : 'Sell'} {pick.strike} {pick.type}
        </button>
      </div>
    </div>
  )
}
