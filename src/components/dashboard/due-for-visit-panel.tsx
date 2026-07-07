'use client'

// Phase 16 G2 — "Due for a visit" panel: residents whose own visit cadence says
// they're overdue and who have nothing scheduled. Mirrors WaitlistPanel
// (self-fetching, reloadKey). "Book →" opens the booking modal prefilled.

import { useCallback, useEffect, useState } from 'react'

export interface DueResident {
  residentId: string
  name: string
  roomNumber: string | null
  lastVisit: string
  usualCadenceDays: number
  daysSinceLastVisit: number
  suggestedServiceId: string | null
}

export function DueForVisitPanel({
  onBook,
  reloadKey = 0,
}: {
  onBook: (r: DueResident) => void
  reloadKey?: number
}) {
  const [rows, setRows] = useState<DueResident[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/residents/due-for-visit')
      if (!res.ok) return
      const j = await res.json()
      setRows(j.data ?? [])
    } catch {
      // best-effort — the panel just stays hidden
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  if (!loaded || rows.length === 0) return null

  return (
    <div data-tour="due-for-visit" className="shrink-0 bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-stone-100">
        <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">
          Due for a Visit · {rows.length}
        </p>
      </div>
      <div className="divide-y divide-stone-50 max-h-[180px] overflow-y-auto">
        {rows.map((r) => (
          <div key={r.residentId} className="flex items-center gap-2 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-stone-800 truncate">
                {r.name}
                {r.roomNumber && <span className="text-stone-400 font-normal"> · Rm {r.roomNumber}</span>}
              </p>
              <p className="text-[11px] text-stone-400 truncate">
                Last visit {r.daysSinceLastVisit}d ago · usually every ~{r.usualCadenceDays}d
              </p>
            </div>
            <button
              onClick={() => onBook(r)}
              className="shrink-0 text-[11px] font-semibold text-[#8B2E4A] bg-rose-50 hover:bg-[#8B2E4A] hover:text-white px-2.5 py-1 rounded-full transition-colors"
            >
              Book →
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
