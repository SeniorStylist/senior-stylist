'use client'

// P61 — the repair surface for stylists that belong to no facility.
//
// Renders NOTHING when there are none, so it is silent on a healthy network and
// unmissable when something has gone wrong. Mirrors <NeedsReviewBadge />: a
// self-fetching client component, so the Master Admin page pays no extra query
// on every render.

import { useEffect, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { useToast } from '@/components/ui/toast'

interface Orphan {
  id: string
  name: string
  stylistCode: string | null
  color: string | null
}

interface Props {
  facilities: { id: string; name: string; facilityCode: string | null }[]
}

export function UnassignedStylists({ facilities }: Props) {
  const { toast } = useToast()
  const [orphans, setOrphans] = useState<Orphan[] | null>(null)
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/super-admin/unassigned-stylists')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setOrphans(j?.data?.stylists ?? [])
      })
      .catch(() => {
        if (!cancelled) setOrphans([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!orphans || orphans.length === 0) return null

  const assign = async (stylist: Orphan) => {
    const facilityId = picked[stylist.id]
    if (!facilityId) {
      toast.error('Pick a facility first')
      return
    }
    setBusy(stylist.id)
    try {
      const res = await fetch(`/api/facilities/${facilityId}/stylists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No `days`: seeding availability is the facility's own decision, and
        // a wrong guess here would silently change who the sign-up sheet
        // auto-assigns to. Assign first; hours are set on the stylist's page.
        body: JSON.stringify({ assignments: [{ stylistId: stylist.id }] }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof json?.error === 'string' ? json.error : 'Could not assign that stylist')
        return
      }
      const facility = facilities.find((f) => f.id === facilityId)
      toast.success(`${stylist.name} now works at ${facility?.name ?? 'that facility'}`)
      setOrphans((prev) => (prev ?? []).filter((o) => o.id !== stylist.id))
    } catch {
      toast.error('Network error — nothing was changed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-[var(--shadow-sm)] mb-6">
      <p className="text-sm font-semibold text-amber-900">
        {orphans.length} {orphans.length === 1 ? 'stylist belongs' : 'stylists belong'} to no facility
      </p>
      <p className="text-xs text-amber-800/80 mt-1 leading-relaxed">
        They were created without a facility, so they don&apos;t appear on any roster, in the Day
        Log, or in a facility&apos;s stylist count. Pick where each one works to put them back.
      </p>

      <div className="mt-4 space-y-2">
        {orphans.map((s) => (
          <div
            key={s.id}
            className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white rounded-xl border border-amber-100 px-3 py-2.5"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Avatar name={s.name} size="md" color={s.color ?? undefined} />
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-stone-900 leading-snug truncate">{s.name}</p>
                {s.stylistCode && (
                  <p className="text-[11.5px] text-stone-500 leading-snug mt-0.5 font-mono">{s.stylistCode}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={picked[s.id] ?? ''}
                onChange={(e) => setPicked((p) => ({ ...p, [s.id]: e.target.value }))}
                className="text-sm border border-stone-200 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50 max-w-[200px]"
              >
                <option value="">Select facility…</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.facilityCode ? `${f.facilityCode} · ` : ''}
                    {f.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => assign(s)}
                disabled={busy === s.id || !picked[s.id]}
                className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-[#8B2E4A] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#7a2841] transition-colors"
              >
                {busy === s.id ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
