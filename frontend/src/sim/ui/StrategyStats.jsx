// The StockMock summary strip: Max Profit / Max Loss (with Unlimited detection), POP,
// Net Credit/Debit, Breakevens (with %), and current P&L. Pure render of the payoff summary.
import { money, pnlCls } from './fmt.js'
import Info from './Info.jsx'

const Cell = ({ label, infoKey, children }) => (
  <div className="px-3 py-1.5">
    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500">
      {label}
      {infoKey && <Info k={infoKey} side="bottom" />}
    </div>
    <div className="font-mono text-xs tabular-nums">{children}</div>
  </div>
)

export default function StrategyStats({ payoff, book, spot }) {
  const pnl = book?.total ?? 0
  const credit = payoff?.netCredit ?? 0
  const fmtBig = (v) => (v === Infinity ? 'Unlimited' : v === -Infinity ? 'Unlimited' : money(v))

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-0 border-b border-edge bg-panel">
      <Cell label="P&L" infoKey="pnl"><span className={pnlCls(pnl)}>{money(pnl)}</span></Cell>
      <Cell label="Max Profit" infoKey="maxProfit">
        <span className="text-emerald-400">{payoff ? fmtBig(payoff.maxProfit) : '—'}</span>
      </Cell>
      <Cell label="Max Loss" infoKey="maxLoss">
        <span className="text-red-400">{payoff ? (payoff.maxLoss === -Infinity ? 'Unlimited' : money(payoff.maxLoss)) : '—'}</span>
      </Cell>
      <Cell label="POP" infoKey="pop">
        <span className="text-slate-200">{payoff?.pop != null ? `${(payoff.pop * 100).toFixed(1)}%` : '—'}</span>
      </Cell>
      <Cell label={credit >= 0 ? 'Net Credit' : 'Net Debit'} infoKey={credit >= 0 ? 'netCredit' : 'netDebit'}>
        <span className={credit >= 0 ? 'text-emerald-400' : 'text-amber-400'}>{money(Math.abs(credit))}</span>
      </Cell>
      <Cell label="Breakevens" infoKey="breakevens">
        {payoff?.breakevens?.length ? (
          <span className="text-slate-200">
            {payoff.breakevens.map((be, i) => (
              <span key={i}>
                {i > 0 && <span className="text-slate-600"> – </span>}
                {Math.round(be)}
                {spot != null && <span className="text-slate-500"> ({(((be - spot) / spot) * 100).toFixed(1)}%)</span>}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </Cell>
      {payoff?.atmIv != null && (
        <Cell label="ATM IV" infoKey="atmIv"><span className="text-slate-300">{(payoff.atmIv * 100).toFixed(1)}%</span></Cell>
      )}
    </div>
  )
}
