'use client'

// Phase 15 F4 — add a resident to the cancellation waitlist. Opened from the
// waitlist panel's "+ Add" and from the booking modal's cancel-confirm state
// (prefilled with that booking's resident/service).

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useToast } from '@/components/ui/toast'
import { queueableFetch, isQueued } from '@/lib/offline-queue'

interface ResidentOption { id: string; name: string; roomNumber?: string | null }
interface ServiceOption { id: string; name: string; category?: string | null }

interface AddToWaitlistModalProps {
  open: boolean
  onClose: () => void
  residents: ResidentOption[]
  services: ServiceOption[]
  prefillResidentId?: string | null
  prefillServiceId?: string | null
  onAdded?: () => void
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function AddToWaitlistModal({
  open,
  onClose,
  residents,
  services,
  prefillResidentId = null,
  prefillServiceId = null,
  onAdded,
}: AddToWaitlistModalProps) {
  const isMobile = useIsMobile()
  const { toast } = useToast()
  const [residentId, setResidentId] = useState('')
  const [residentQuery, setResidentQuery] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [earliestDate, setEarliestDate] = useState(todayStr())
  const [latestDate, setLatestDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setResidentId(prefillResidentId ?? '')
      setResidentQuery('')
      setServiceId(prefillServiceId ?? '')
      setEarliestDate(todayStr())
      setLatestDate('')
      setNotes('')
      setError(null)
    }
  }, [open, prefillResidentId, prefillServiceId])

  const selectedResident = useMemo(
    () => residents.find((r) => r.id === residentId) ?? null,
    [residents, residentId],
  )

  // P26 Hick's law — the resident list can run 100+ entries; a filter box
  // narrows the select instead of forcing a scroll through everyone.
  const filteredResidents = useMemo(() => {
    const q = residentQuery.trim().toLowerCase()
    if (!q) return residents
    return residents.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.roomNumber ?? '').toLowerCase().includes(q),
    )
  }, [residents, residentQuery])

  // Services grouped by category (matches every other service picker)
  const groupedServices = useMemo(() => {
    const map = new Map<string, ServiceOption[]>()
    for (const s of services) {
      const cat = s.category?.trim() || 'Other'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(s)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [services])

  const submit = async () => {
    if (!selectedResident) { setError('Pick a resident'); return }
    setSaving(true)
    setError(null)
    try {
      // P28 — queued offline on network failure (F6 pattern)
      const res = await queueableFetch('Waitlist entry', '/api/waitlist', {
        method: 'POST',
        body: {
          residentId: selectedResident.id,
          residentName: selectedResident.name,
          roomNumber: selectedResident.roomNumber ?? null,
          serviceId: serviceId || null,
          earliestDate,
          latestDate: latestDate || null,
          notes: notes.trim() || null,
        },
      })
      if (isQueued(res)) {
        toast.success(`Saved offline — ${selectedResident.name} will join the waitlist when you're back online`)
        onAdded?.()
        onClose()
        return
      }
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(`${selectedResident.name} added to the waitlist`)
        onAdded?.()
        onClose()
      } else {
        setError(typeof j.error === 'string' ? j.error : 'Could not add to waitlist')
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all'
  const labelCls = 'text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1'

  const form = (
    <div className="px-6 pb-6 pt-2 space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">{error}</div>
      )}
      <div>
        <label className={labelCls}>Resident *</label>
        {residents.length > 8 && (
          <input
            type="text"
            value={residentQuery}
            onChange={(e) => setResidentQuery(e.target.value)}
            placeholder="Search name or room…"
            aria-label="Filter residents"
            className={`${inputCls} mb-1.5`}
          />
        )}
        <select value={residentId} onChange={(e) => setResidentId(e.target.value)} className={inputCls}>
          <option value="">Select a resident…</option>
          {/* keep the picked resident visible even when the filter excludes them */}
          {selectedResident && !filteredResidents.some((r) => r.id === selectedResident.id) && (
            <option value={selectedResident.id}>
              {selectedResident.name}{selectedResident.roomNumber ? ` · Rm ${selectedResident.roomNumber}` : ''}
            </option>
          )}
          {filteredResidents.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}{r.roomNumber ? ` · Rm ${r.roomNumber}` : ''}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelCls}>Service (optional)</label>
        <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={inputCls}>
          <option value="">Any service</option>
          {groupedServices.map(([cat, list]) => (
            <optgroup key={cat} label={cat}>
              {list.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>From</label>
          <input type="date" value={earliestDate} onChange={(e) => setEarliestDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Until (optional)</label>
          <input type="date" value={latestDate} min={earliestDate} onChange={(e) => setLatestDate(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inputCls} resize-none`} placeholder="Prefers mornings, any stylist…" />
      </div>
      <Button onClick={submit} loading={saving} disabled={!residentId} className="w-full">
        Add to waitlist
      </Button>
    </div>
  )

  if (isMobile) {
    return (
      <BottomSheet isOpen={open} onClose={onClose} title="Add to Waitlist">
        {form}
      </BottomSheet>
    )
  }
  return (
    <Modal open={open} onClose={onClose} title="Add to Waitlist">
      {form}
    </Modal>
  )
}
