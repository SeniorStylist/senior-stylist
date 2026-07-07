'use client'

// Phase 15 F4 — pending-waitlist panel for the admin dashboard right panel.
// Lists residents waiting for an earlier/open slot; "Book →" opens the booking
// modal prefilled (parent handles it via onBook, mirroring the signup-sheet flow).

import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@/components/ui/toast'

export interface WaitlistEntry {
  id: string
  residentId: string | null
  residentName: string
  roomNumber: string | null
  serviceId: string | null
  serviceName: string | null
  earliestDate: string
  latestDate: string | null
  notes: string | null
  status: string
}

function dateLabel(d: string): string {
  return new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function WaitlistPanel({
  onBook,
  onAdd,
  reloadKey = 0,
}: {
  onBook: (entry: WaitlistEntry) => void
  onAdd: () => void
  reloadKey?: number
}) {
  const { toast } = useToast()
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/waitlist')
      if (!res.ok) return
      const j = await res.json()
      setEntries(j.data ?? [])
    } catch {
      // best-effort — panel just stays hidden
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const remove = useCallback(async (entry: WaitlistEntry) => {
    const snapshot = entries
    setEntries((prev) => prev.filter((e) => e.id !== entry.id))
    try {
      const res = await fetch(`/api/waitlist/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (!res.ok) {
        setEntries(snapshot)
        toast.error('Could not remove from waitlist')
      }
    } catch {
      setEntries(snapshot)
      toast.error('Network error')
    }
  }, [entries, toast])

  if (!loaded) return null

  return (
    <div data-tour="waitlist-panel" className="shrink-0 bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-stone-100 flex items-center justify-between">
        <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">
          Waitlist{entries.length > 0 ? ` · ${entries.length}` : ''}
        </p>
        <button
          onClick={onAdd}
          data-tour="waitlist-add"
          className="text-[11px] font-semibold text-[#8B2E4A] hover:underline"
        >
          + Add
        </button>
      </div>
      {entries.length === 0 && (
        <p className="px-4 py-2.5 text-[11px] text-stone-400 italic">
          No one waiting — add residents who want an earlier slot.
        </p>
      )}
      <div className="divide-y divide-stone-50 max-h-[180px] overflow-y-auto">
        {entries.map((e) => (
          <div key={e.id} className="flex items-center gap-2 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-stone-800 truncate">
                {e.residentName}
                {e.roomNumber && <span className="text-stone-400 font-normal"> · Rm {e.roomNumber}</span>}
              </p>
              <p className="text-[11px] text-stone-400 truncate">
                {e.serviceName ?? 'Any service'} · from {dateLabel(e.earliestDate)}
                {e.latestDate ? ` to ${dateLabel(e.latestDate)}` : ''}
                {e.notes ? ` · ${e.notes}` : ''}
              </p>
            </div>
            <button
              onClick={() => onBook(e)}
              className="shrink-0 text-[11px] font-semibold text-[#8B2E4A] bg-rose-50 hover:bg-[#8B2E4A] hover:text-white px-2.5 py-1 rounded-full transition-colors"
            >
              Book →
            </button>
            <button
              onClick={() => remove(e)}
              aria-label={`Remove ${e.residentName} from waitlist`}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-stone-300 hover:text-stone-500 hover:bg-stone-100 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
