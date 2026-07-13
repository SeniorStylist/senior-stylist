'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Calendar } from 'lucide-react'
import type { Resident, Service, SignupSheetEntryWithRelations, Stylist } from '@/types'
import { PageHeader } from '@/components/ui/page-header'
import { useToast } from '@/components/ui/toast'
import { queueableFetch, isQueued } from '@/lib/offline-queue'
import { formatDateInTz } from '@/lib/time'

interface Props {
  facilityId: string
  facilityTimezone: string
  residents: Resident[]
  services: Service[]
  stylists: Stylist[]
  role: string
}

function formatDateChip(dateStr: string, tz: string) {
  try {
    return formatDateInTz(new Date(dateStr + 'T12:00:00'), tz, { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

export function SignupSheetPageClient({ facilityId, facilityTimezone, residents, services, stylists, role }: Props) {
  const router = useRouter()
  const { toast } = useToast()

  // ── Pending entries ────────────────────────────────────────────────
  const [entries, setEntries] = useState<SignupSheetEntryWithRelations[]>([])
  const [loadingEntries, setLoadingEntries] = useState(true)

  const fetchEntries = () => {
    setLoadingEntries(true)
    fetch('/api/signup-sheet?scope=all')
      .then((r) => r.json())
      .then((j) => { if (Array.isArray(j.data)) setEntries(j.data) })
      .catch(() => {})
      .finally(() => setLoadingEntries(false))
  }

  useEffect(() => { fetchEntries() }, [])

  const handleCancel = async (id: string) => {
    // Offline-created entries have no server id yet — their queued POST still
    // creates them on sync; cancel after they appear.
    if (id.startsWith('offline-')) {
      toast.info("This request syncs when you're back online — cancel it after it appears")
      return
    }
    try {
      // P28 — cancellation queues offline too (optimistic removal kept)
      const res = await queueableFetch('Cancel sign-up request', `/api/signup-sheet/${id}`, {
        method: 'PATCH',
        body: { status: 'cancelled' },
      })
      if (isQueued(res)) {
        setEntries((prev) => prev.filter((e) => e.id !== id))
        toast.success("Saved offline — will sync when you're back online")
        return
      }
      if (!res.ok) {
        const j = await res.json()
        toast.error(typeof j.error === 'string' ? j.error : 'Failed to cancel')
        return
      }
      setEntries((prev) => prev.filter((e) => e.id !== id))
      toast.success('Request cancelled')
    } catch {
      toast.error('Network error')
    }
  }

  // ── Form state ─────────────────────────────────────────────────────
  const [residentSearch, setResidentSearch] = useState('')
  const [selectedResidentId, setSelectedResidentId] = useState('')
  const [residentDropdownOpen, setResidentDropdownOpen] = useState(false)
  const [createResidentOpen, setCreateResidentOpen] = useState(false)
  const [createResidentName, setCreateResidentName] = useState('')
  const [createResidentRoom, setCreateResidentRoom] = useState('')
  const [creatingResident, setCreatingResident] = useState(false)
  const [createResidentError, setCreateResidentError] = useState<string | null>(null)
  const [localNewResidents, setLocalNewResidents] = useState<Resident[]>([])

  const [serviceSearch, setServiceSearch] = useState('')
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [serviceDropdownOpen, setServiceDropdownOpen] = useState(false)

  const [preferredDate, setPreferredDate] = useState('')
  const [assignedStylistId, setAssignedStylistId] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const formRef = useRef<HTMLDivElement>(null)

  const allResidents = useMemo(() => [...residents, ...localNewResidents], [residents, localNewResidents])

  const selectedResident = useMemo(
    () => allResidents.find((r) => r.id === selectedResidentId) ?? null,
    [allResidents, selectedResidentId],
  )

  const filteredResidents = useMemo(() => {
    const q = residentSearch.trim().toLowerCase()
    if (!q) return allResidents.filter((r) => r.active).slice(0, 30)
    return allResidents
      .filter((r) => r.active && (r.name.toLowerCase().includes(q) || (r.roomNumber && r.roomNumber.toLowerCase().includes(q))))
      .slice(0, 30)
  }, [allResidents, residentSearch])

  const activeServices = useMemo(() => services.filter((s) => s.active && s.pricingType !== 'addon'), [services])

  const filteredServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase()
    if (!q) return activeServices.slice(0, 30)
    return activeServices.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 30)
  }, [activeServices, serviceSearch])

  const selectedService = useMemo(
    () => activeServices.find((s) => s.id === selectedServiceId) ?? null,
    [activeServices, selectedServiceId],
  )

  const handleSelectResident = (r: Resident) => {
    setSelectedResidentId(r.id)
    setResidentSearch(r.name)
    setResidentDropdownOpen(false)
  }

  const handleCreateResident = async () => {
    if (!createResidentName.trim()) return
    setCreatingResident(true)
    setCreateResidentError(null)
    try {
      const res = await fetch('/api/residents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createResidentName.trim(),
          roomNumber: createResidentRoom.trim() || undefined,
          facilityId,
        }),
      })
      const j = await res.json()
      if (!res.ok) {
        setCreateResidentError(j.error ?? 'Failed to create resident')
        return
      }
      const newR = j.data as Resident
      setLocalNewResidents((prev) => [...prev, newR])
      setSelectedResidentId(newR.id)
      setResidentSearch(newR.name)
      setCreateResidentOpen(false)
      setResidentDropdownOpen(false)
      setCreateResidentName('')
      setCreateResidentRoom('')
    } catch {
      // P28 offline — local pending resident; the queued POST sends the name
      const pending = {
        id: `offline-new-${Date.now()}`,
        name: createResidentName.trim(),
        roomNumber: createResidentRoom.trim() || null,
      } as unknown as Resident
      setLocalNewResidents((prev) => [...prev, pending])
      setSelectedResidentId(pending.id)
      setResidentSearch(pending.name)
      setCreateResidentOpen(false)
      setResidentDropdownOpen(false)
      setCreateResidentName('')
      setCreateResidentRoom('')
      toast.info("Offline — resident will be created when you're back online")
    } finally {
      setCreatingResident(false)
    }
  }

  const resetForm = () => {
    setResidentSearch('')
    setSelectedResidentId('')
    setResidentDropdownOpen(false)
    setCreateResidentOpen(false)
    setCreateResidentName('')
    setCreateResidentRoom('')
    setCreateResidentError(null)
    setServiceSearch('')
    setSelectedServiceId('')
    setServiceDropdownOpen(false)
    setPreferredDate('')
    setAssignedStylistId('')
    setNotes('')
  }

  const handleSubmit = async () => {
    if (!selectedResidentId && !residentSearch.trim()) return
    setSubmitting(true)
    try {
      const body = {
        facilityId,
        // Schema takes nullable (NOT optional) ids — `undefined` gets dropped
        // by JSON.stringify and 422'd; send explicit nulls (P28 fix).
        residentId: selectedResidentId && !selectedResidentId.startsWith('offline-new-') ? selectedResidentId : null,
        residentName: selectedResident?.name ?? residentSearch.trim(),
        roomNumber: selectedResident?.roomNumber ?? null,
        serviceId: selectedServiceId || null,
        serviceName: (selectedService?.name ?? serviceSearch.trim()) || '',
        preferredDate: preferredDate || null,
        assignedToStylistId: assignedStylistId || null,
        notes: notes.trim() || null,
        requestedDate: new Date().toISOString().slice(0, 10),
      }
      // P28 — queued offline on network failure (F6 pattern)
      const res = await queueableFetch('Sign-up request', '/api/signup-sheet', {
        method: 'POST',
        body,
      })
      if (isQueued(res)) {
        setEntries((prev) => [{
          id: `offline-${Date.now()}`,
          residentId: body.residentId,
          residentName: body.residentName,
          roomNumber: body.roomNumber,
          serviceId: body.serviceId,
          serviceName: body.serviceName,
          requestedTime: null,
          requestedDate: body.requestedDate,
          preferredDate: body.preferredDate,
          notes: body.notes,
          assignedToStylistId: body.assignedToStylistId,
          status: 'pending',
        } as (typeof entries)[number], ...prev])
        toast.success("Saved offline — will sync when you're back online")
        resetForm()
        return
      }
      const j = await res.json()
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : 'Failed to add request')
        return
      }
      toast.success('Request added')
      resetForm()
      fetchEntries()
    } catch {
      toast.error('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = !!(selectedResidentId || residentSearch.trim()) && !submitting

  return (
    <div className="page-enter max-w-3xl mx-auto px-4 py-8 space-y-6" data-tour="signup-sheet-page">
      <PageHeader
        icon={ClipboardList}
        title="Sign-Up Sheet"
        subtitle="Manage appointment requests from residents"
      />

      {/* ── Pending Requests ─────────────────────────────────────── */}
      <div className="rounded-2xl border border-stone-100 bg-white shadow-[var(--shadow-sm)]">
        <div className="px-5 pt-5 pb-4 border-b border-stone-100 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Pending Requests</p>
            {!loadingEntries && (
              <p className="text-xs text-stone-400 mt-0.5">
                {entries.length === 0 ? 'No pending requests' : `${entries.length} request${entries.length === 1 ? '' : 's'} waiting`}
              </p>
            )}
          </div>
        </div>
        <div className="divide-y divide-stone-50">
          {loadingEntries ? (
            <div className="px-5 py-4 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex-1 space-y-1.5">
                    <div className="skeleton h-4 w-36 rounded-full" />
                    <div className="skeleton h-3 w-24 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <ClipboardList size={28} className="mx-auto text-stone-200 mb-2" />
              <p className="text-sm text-stone-400">No pending requests right now</p>
            </div>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="px-5 py-3.5 flex items-start justify-between gap-4 hover:bg-stone-50/50 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-stone-900">{entry.residentName}</span>
                    {entry.roomNumber && (
                      <span className="text-xs text-stone-400">Rm {entry.roomNumber}</span>
                    )}
                  </div>
                  <p className="text-[12.5px] text-stone-600 mt-0.5">{entry.serviceName}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {entry.preferredDate && (
                      <span className="inline-flex items-center gap-1 text-[11px] bg-stone-100 text-stone-600 rounded-full px-2 py-0.5">
                        <Calendar size={11} />
                        {formatDateChip(entry.preferredDate, facilityTimezone)}
                      </span>
                    )}
                    {entry.assignedStylist && (
                      <span className="text-[11px] text-stone-400">→ {entry.assignedStylist.name}</span>
                    )}
                    {entry.notes && (
                      <span className="text-[11px] text-stone-500 italic truncate max-w-[180px]">{entry.notes}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={`/dashboard?convertEntry=${entry.id}`}
                    className="text-xs font-medium text-[#8B2E4A] hover:underline whitespace-nowrap"
                  >
                    Pick time →
                  </a>
                  <button
                    type="button"
                    onClick={() => handleCancel(entry.id)}
                    aria-label="Cancel request"
                    className="w-7 h-7 flex items-center justify-center text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Add Request Form ──────────────────────────────────────── */}
      <div ref={formRef} className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)] space-y-4" data-tour="signup-sheet-form">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Add Request</p>

        {/* Resident */}
        <div className="relative">
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">
            Resident <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={residentSearch}
            onChange={(e) => {
              setResidentSearch(e.target.value)
              setResidentDropdownOpen(true)
              if (selectedResidentId) {
                const r = allResidents.find((r) => r.id === selectedResidentId)
                if (r && r.name !== e.target.value) setSelectedResidentId('')
              }
            }}
            onFocus={() => setResidentDropdownOpen(true)}
            onBlur={(e) => {
              const related = e.relatedTarget as HTMLElement | null
              const container = e.currentTarget.closest('.relative')
              if (container && related && container.contains(related)) return
              setTimeout(() => setResidentDropdownOpen(false), 150)
            }}
            placeholder="Search by name or room…"
            data-tour="signup-sheet-resident"
            className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A] transition-all"
          />
          {selectedResident?.roomNumber && (
            <p className="text-xs text-stone-400 mt-1">Room {selectedResident.roomNumber}</p>
          )}
          {residentDropdownOpen && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-stone-200 rounded-xl shadow-lg z-50 max-h-52 overflow-y-auto">
              {createResidentOpen ? (
                <div className="p-3 space-y-2">
                  <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">New Resident</p>
                  {createResidentError && <p className="text-xs text-red-600">{createResidentError}</p>}
                  <input
                    autoFocus
                    value={createResidentName}
                    onChange={(e) => setCreateResidentName(e.target.value)}
                    placeholder="Full name *"
                    className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
                  />
                  <input
                    value={createResidentRoom}
                    onChange={(e) => setCreateResidentRoom(e.target.value)}
                    placeholder="Room number (optional)"
                    className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
                  />
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onMouseDown={() => { setCreateResidentOpen(false); setCreateResidentError(null) }}
                      className="flex-1 py-2 text-sm text-stone-600 border border-stone-200 rounded-xl hover:bg-stone-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!createResidentName.trim() || creatingResident}
                      onMouseDown={handleCreateResident}
                      className="flex-1 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-50"
                      style={{ backgroundColor: '#8B2E4A' }}
                    >
                      {creatingResident ? 'Creating…' : 'Create & Select'}
                    </button>
                  </div>
                </div>
              ) : filteredResidents.length > 0 ? (
                <>
                  {filteredResidents.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      data-tour="signup-sheet-resident-option"
                      onMouseDown={() => handleSelectResident(r)}
                      className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-stone-50 border-b border-stone-50 last:border-0"
                    >
                      <span className="font-medium text-stone-900">{r.name}</span>
                      {r.roomNumber && <span className="text-stone-400 ml-2 text-xs">Room {r.roomNumber}</span>}
                    </button>
                  ))}
                  {residentSearch.trim().length >= 3 && (
                    <button
                      type="button"
                      onMouseDown={() => {
                        setCreateResidentName(residentSearch.trim())
                        setCreateResidentRoom('')
                        setCreateResidentError(null)
                        setCreateResidentOpen(true)
                      }}
                      className="w-full text-left px-3.5 py-2.5 text-sm font-medium text-[#8B2E4A] border-t border-stone-100 hover:bg-rose-50 flex items-center gap-2"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      Add &quot;{residentSearch.trim()}&quot; as new resident
                    </button>
                  )}
                </>
              ) : residentSearch.trim().length >= 3 ? (
                <button
                  type="button"
                  onMouseDown={() => {
                    setCreateResidentName(residentSearch.trim())
                    setCreateResidentRoom('')
                    setCreateResidentError(null)
                    setCreateResidentOpen(true)
                  }}
                  className="w-full text-left px-3.5 py-2.5 text-sm font-medium text-[#8B2E4A] hover:bg-rose-50 flex items-center gap-2"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Add &quot;{residentSearch.trim()}&quot; as new resident
                </button>
              ) : (
                <div className="px-3.5 py-3">
                  <p className="text-sm text-stone-400">Start typing to search…</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Service */}
        <div className="relative">
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Service</label>
          <input
            type="text"
            value={serviceSearch}
            onChange={(e) => {
              setServiceSearch(e.target.value)
              setServiceDropdownOpen(true)
              if (selectedServiceId) {
                const s = activeServices.find((s) => s.id === selectedServiceId)
                if (s && s.name !== e.target.value) setSelectedServiceId('')
              }
            }}
            onFocus={() => setServiceDropdownOpen(true)}
            onBlur={(e) => {
              const related = e.relatedTarget as HTMLElement | null
              const container = e.currentTarget.closest('.relative')
              if (container && related && container.contains(related)) return
              setTimeout(() => setServiceDropdownOpen(false), 150)
            }}
            placeholder="Search services…"
            data-tour="signup-sheet-service"
            className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A] transition-all"
          />
          {serviceDropdownOpen && filteredServices.length > 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-stone-200 rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
              {filteredServices.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-tour="signup-sheet-service-option"
                  onMouseDown={() => {
                    setSelectedServiceId(s.id)
                    setServiceSearch(s.name)
                    setServiceDropdownOpen(false)
                  }}
                  className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-stone-50 border-b border-stone-50 last:border-0"
                >
                  <span className="font-medium text-stone-900">{s.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Preferred Date */}
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Preferred Date</label>
          <input
            type="date"
            value={preferredDate}
            onChange={(e) => setPreferredDate(e.target.value)}
            data-tour="signup-sheet-preferred-date"
            className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A] transition-all"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Any special requests or notes…"
            data-tour="signup-sheet-notes"
            className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A] transition-all resize-none"
          />
        </div>

        {/* Stylist Override */}
        {stylists.length > 0 && (
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Assign to Stylist (optional)</label>
            <select
              value={assignedStylistId}
              onChange={(e) => setAssignedStylistId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A] transition-all"
            >
              <option value="">Auto-assign</option>
              {stylists.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-tour="signup-sheet-submit"
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:-translate-y-px hover:shadow-[0_4px_10px_rgba(139,46,74,0.28)] disabled:shadow-none disabled:translate-y-0"
            style={{ backgroundColor: '#8B2E4A' }}
          >
            {submitting ? 'Adding…' : 'Add Request'}
          </button>
        </div>
      </div>
    </div>
  )
}
