// Zero-dependency shareable PNG card for the replay sim. Builds the card as an SVG string,
// rasterises it through an offscreen <canvas> (Image → drawImage → toBlob), then downloads
// it and/or copies it to the clipboard. No html2canvas, no deps. Browser-only.
import { money } from './fmt.js'

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const W = 640
const H = 400

const legLine = (l) => `${l.side > 0 ? 'B' : 'S'} ${l.lots} ${l.strike}${l.type} @ ${l.entry?.toFixed ? l.entry.toFixed(2) : l.entry}`

export function buildCardSVG(d = {}) {
  const pnl = d.pnl ?? 0
  const pnlColor = pnl > 0 ? '#34d399' : pnl < 0 ? '#f87171' : '#cbd5e1'
  const credit = (d.netCredit ?? 0) >= 0
  const legs = (d.legs ?? []).slice(0, 6)
  const moreLegs = (d.legs?.length ?? 0) - legs.length

  const stat = (x, y, label, value, color) => `
    <text x="${x}" y="${y}" font-size="11" fill="#94a3b8" letter-spacing="0.5">${esc(label)}</text>
    <text x="${x}" y="${y + 22}" font-size="17" font-weight="700" fill="${color}" font-family="ui-monospace,Menlo,monospace">${esc(value)}</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0e16"/><stop offset="1" stop-color="#0f1422"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#38bdf8"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="18" fill="url(#bg)"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="17" fill="none" stroke="#243049" stroke-width="1"/>
  <rect x="28" y="30" width="5" height="26" rx="2.5" fill="url(#accent)"/>
  <text x="44" y="44" font-size="20" font-weight="800" fill="#f1f5f9" letter-spacing="1">STRATOS</text>
  <text x="44" y="60" font-size="11" fill="#64748b" letter-spacing="2">REPLAY SIM · PAPER TRADE</text>
  <text x="${W - 28}" y="44" text-anchor="end" font-size="12" fill="#94a3b8" font-family="ui-monospace,monospace">${esc(d.clock ?? '')}</text>

  <text x="28" y="104" font-size="12" fill="#94a3b8" letter-spacing="0.5">MTM P&amp;L</text>
  <text x="28" y="146" font-size="44" font-weight="800" fill="${pnlColor}" font-family="ui-monospace,Menlo,monospace">${esc(money(pnl))}</text>

  ${stat(28, 196, 'MAX PROFIT', d.maxProfit === Infinity ? 'Unlimited' : money(d.maxProfit ?? 0), '#34d399')}
  ${stat(196, 196, 'MAX LOSS', d.maxLoss === -Infinity ? 'Unlimited' : money(d.maxLoss ?? 0), '#f87171')}
  ${stat(360, 196, 'POP', d.pop != null ? `${(d.pop * 100).toFixed(1)}%` : '—', '#e2e8f0')}
  ${stat(470, 196, credit ? 'NET CREDIT' : 'NET DEBIT', money(Math.abs(d.netCredit ?? 0)), credit ? '#34d399' : '#fbbf24')}

  <line x1="28" y1="244" x2="${W - 28}" y2="244" stroke="#243049" stroke-width="1"/>
  <text x="28" y="266" font-size="11" fill="#64748b" letter-spacing="1">POSITION</text>
  ${legs.map((l, i) => `<text x="28" y="${288 + i * 18}" font-size="13" fill="${l.side > 0 ? '#86efac' : '#fca5a5'}" font-family="ui-monospace,Menlo,monospace">${esc(legLine(l))}</text>`).join('')}
  ${moreLegs > 0 ? `<text x="28" y="${288 + legs.length * 18}" font-size="12" fill="#64748b">+${moreLegs} more…</text>` : ''}
  ${legs.length === 0 ? `<text x="28" y="288" font-size="13" fill="#64748b">No open position.</text>` : ''}

  <text x="28" y="${H - 22}" font-size="11" fill="#94a3b8">NIFTY · spot ${esc(d.spot != null ? d.spot.toFixed(1) : '—')} · exp ${esc(d.expiry ?? '')}</text>
  <text x="${W - 28}" y="${H - 22}" text-anchor="end" font-size="11" fill="#475569">65.20.82.79</text>
</svg>`
}

function svgToPngBlob(svg, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = W * scale
      canvas.height = H * scale
      const ctx = canvas.getContext('2d')
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
    }
    img.onerror = () => reject(new Error('SVG render failed'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })
}

/** Build + rasterise the card and download it as a PNG. Returns the blob. */
export async function downloadCard(data, stamp) {
  const blob = await svgToPngBlob(buildCardSVG(data))
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `stratos-sim-${stamp ?? 'card'}.png`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return blob
}

/** Best-effort copy of the card PNG to the clipboard. Resolves false when unsupported. */
export async function copyCard(data) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false
  try {
    const blob = await svgToPngBlob(buildCardSVG(data))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}
