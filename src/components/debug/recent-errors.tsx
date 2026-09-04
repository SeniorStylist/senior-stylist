'use client'

// P63 — the last server render errors, with the facility each happened at.
//
// Pairs with the error card's "ref": that number is Next's digest, and the same
// digest appears here next to the actual message. Loads on demand — a
// diagnostic should cost nothing when nothing is wrong.

import { useState } from 'react'

interface ErrorRow {
  id: string
  digest: string | null
  message: string | null
  path: string | null
  at: string | null
  facility: string | null
}

export function RecentErrors() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<ErrorRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/debug/errors')
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof j?.error === 'string' ? j.error : 'Could not read recent errors')
        return
      }
      setRows(j.data?.errors ?? [])
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
        <p className="text-sm font-semibold text-stone-900">Recent errors</p>
        <p className="text-xs text-stone-500 mt-1 leading-relaxed">
          What actually failed, and at which community. When a page shows &ldquo;Something went
          wrong&rdquo; with a <span className="font-mono">ref</span>, that same number appears here
          next to the cause.
        </p>
        <button
          onClick={() => {
            setOpen(true)
            void load()
          }}
          className="mt-3 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-900 text-white hover:bg-stone-700 transition-colors"
        >
          Show recent errors
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-900">Recent errors</p>
        <div className="flex items-center gap-3">
          <button onClick={() => void load()} className="text-xs text-stone-500 hover:text-stone-800">
            Refresh
          </button>
          <button onClick={() => setOpen(false)} className="text-xs text-stone-400 hover:text-stone-600">
            Hide
          </button>
        </div>
      </div>

      {loading && <p className="text-xs text-stone-500 mt-3">Reading…</p>}
      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

      {rows && rows.length === 0 && !loading && (
        <p className="text-xs text-emerald-700 mt-3">
          Nothing in the last 14 days — no page has failed to render.
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-3 space-y-2 max-h-96 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg bg-stone-50 border border-stone-100 p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[11px] font-semibold text-stone-800 break-all">
                  {r.path || '—'}
                  {r.facility && <span className="text-stone-500 font-normal"> · {r.facility}</span>}
                </p>
                <span className="text-[10px] text-stone-400 font-mono shrink-0">
                  {r.digest ? `ref ${r.digest}` : ''}
                </span>
              </div>
              <p className="text-[11px] text-red-700 font-mono mt-1 break-all leading-relaxed">
                {r.message}
              </p>
              {r.at && (
                <p className="text-[10px] text-stone-400 mt-1">{new Date(r.at).toLocaleString()}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
