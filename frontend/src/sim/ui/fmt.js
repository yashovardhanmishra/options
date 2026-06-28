// Display helpers. `unix` is the IST wall clock encoded as UTC seconds (project
// convention), so we format with UTC getters to show the real market clock.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n) => String(n).padStart(2, '0')

export const hhmm = (u) => {
  if (u == null) return '—'
  const d = new Date(u * 1000)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
export const dateLabel = (u) => {
  if (u == null) return '—'
  const d = new Date(u * 1000)
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
export const dow = (u) => {
  if (u == null) return ''
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(u * 1000).getUTCDay()]
}

const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const inr1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })
export const money = (n) => (n == null || Number.isNaN(n) ? '—' : `${n < 0 ? '−' : ''}₹${inr0.format(Math.abs(n))}`)
export const num = (n, d = 0) => (n == null || Number.isNaN(n) ? '—' : (d ? inr1 : inr0).format(n))
export const signed = (n, d = 0) => (n == null || Number.isNaN(n) ? '—' : (n > 0 ? '+' : '') + (d ? n.toFixed(d) : Math.round(n)))
export const pnlCls = (n) => (n == null || n === 0 ? 'text-slate-300' : n > 0 ? 'text-emerald-400' : 'text-red-400')
