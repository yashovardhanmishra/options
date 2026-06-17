import { useEffect, useState } from 'react'

// Full-screen overlay that shows an item's Pine Script with a copy button.
export default function CodeModal({ title, subtitle, code, onClose }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[82vh] w-full max-w-2xl flex-col rounded-lg border border-edge bg-panel shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-100">{title}</div>
            <div className="truncate text-[11px] text-slate-500">
              {subtitle ? `${subtitle} · ` : ''}Pine Script v5
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={copy}
              className="rounded-md border border-edge bg-panel2 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-edge hover:text-white"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            <button
              onClick={onClose}
              title="Close"
              className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-edge hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre p-4 font-mono text-[12px] leading-relaxed text-slate-200">
          {code || '// Pine Script not available for this item.'}
        </pre>
      </div>
    </div>
  )
}
