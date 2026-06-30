import { useEffect, useState } from 'react'

// Pine-Script viewer. For patterns it's editable: tweak the code and click Apply
// to re-run detection and update the chart markers. For indicators it's read-only.
export default function CodeModal({ title, subtitle, code, defaultCode, editable, onApply, onReset, onClose }) {
  const [text, setText] = useState(code)
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState(null) // { type: 'ok' | 'err', msg }

  // reset editor when a different item is opened
  useEffect(() => {
    setText(code)
    setStatus(null)
  }, [code])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(editable ? text : code || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked */
    }
  }
  const apply = () => {
    const err = onApply(text)
    setStatus(err ? { type: 'err', msg: err } : { type: 'ok', msg: 'Applied — chart markers updated' })
  }
  const reset = () => {
    setText(defaultCode)
    setStatus(null)
    onReset()
  }
  const dirty = editable && text !== code

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-edge bg-panel shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-100">{title}</div>
            <div className="truncate text-[11px] text-slate-500">
              {subtitle ? `${subtitle} · ` : ''}Pine Script v5{editable ? ' · editable' : ''}
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

        {editable ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="code-mono min-h-0 flex-1 resize-none whitespace-pre bg-ink/40 p-4 text-[12px] leading-relaxed text-slate-200 outline-none"
          />
        ) : (
          <pre className="code-mono min-h-0 flex-1 overflow-auto whitespace-pre p-4 text-[12px] leading-relaxed text-slate-200">
            {code || '// Pine Script not available for this item.'}
          </pre>
        )}

        {editable && (
          <div className="flex items-center justify-between gap-3 border-t border-edge px-4 py-2.5">
            <div className="min-w-0 text-[11px]">
              {status ? (
                <span className={status.type === 'err' ? 'text-red-400' : 'text-green-400'}>
                  {status.type === 'err' ? '⚠ ' : '✓ '}
                  {status.msg}
                </span>
              ) : (
                <span className="text-slate-500">
                  Edit the script and Apply to redraw markers. Supports OHLC, <code className="text-slate-400">[n]</code>,
                  math.*, ta.*, and/or/not, plotshape().
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={reset}
                className="rounded-md border border-edge bg-panel2 px-2.5 py-1 text-xs text-slate-300 hover:bg-edge hover:text-white"
              >
                Reset
              </button>
              <button
                onClick={apply}
                className={`rounded-md px-3 py-1 text-xs font-semibold bg-sky-600 text-white hover:bg-sky-500 ${
                  dirty ? '' : 'opacity-60'
                }`}
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
