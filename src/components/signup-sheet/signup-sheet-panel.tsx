'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Calendar } from 'lucide-react'
import type { Resident, Service, SignupSheetEntryWithRelations, Stylist } from '@/types'
import { useToast } from '@/components/ui/toast'
import { formatDateInTz } from '@/lib/time'

interface SignupSheetPanelProps {
  open: boolean
  onClose: () => void
  facilityId: string
  facilityTimezone: string
  residents: Resident[]
  services: Service[]
  stylists: Stylist[]
  /** ISO date 'YYYY-MM-DD' in facility tz */
  todayDate: string
  /** Role of the current user — drives the admin "Pending requests" section visibility */
  role: string
  onResidentCreated?: (resident: Resident) => void
}

export function SignupSheetPanel({
  open,
  onClose,
  facilityId,
  facilityTimezone,
  residents,
  services,
  stylists,
  todayDate,
  role,
  onResidentCreated,
}: SignupSheetPanelProps) {
  const { toast } = useToast()

  // Form state
  const [residentSearch, setResidentSearch] = useState('')
  const [selectedResidentId, setSelectedResidentId] = useState<string>('')
  const [residentDropdownOpen, setResidentDropdownOpen] = useState(false)
  const [createResidentOpen, setCreateResidentOpen] = useState(false)
  const [createResidentName, setCreateResidentName] = useState('')
  const [createResidentRoom, setCreateResidentRoom] = useState('')
  const [creatingResident, setCreatingResident] = useState(false)
  const [createResidentError, setCreateResidentError] = useState<string | null>(null)
  const [localNewResidents, setLocalNewResidents] = useState<Resident[]>([])

  const [roomOverride, setRoomOverride] = useState('')

  const [serviceSearch, setServiceSearch] = useState('')
  const [selectedServiceId, setSelectedServiceId] = useState<string>('')
  const [serviceDropdownOpen, setServiceDropdownOpen] = useState(false)

  const [requestedTime, setRequestedTime] = useState('')
  const [preferredDate, setPreferredDate] = useState('')
  const [assignedStylistId, setAssignedStylistId] = useState('')
  const [notes, setNotes] = useState('')

  const [submitting, setSubmitting] = useState(false)

  // Queue
  const [entries, setEntries] = useState<SignupSheetEntryWithRelations[]>([])
  const [loadingEntries, setLoadingEntries] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)

  // Load entries when panel opens
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingEntries(true)
    fetch(`/api/signup-sheet?date=${todayDate}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (Array.isArray(json.data)) setEntries(json.data)
      })
      .catch((e) => console.error('Failed to load signup sheet:', e))
      .finally(() => { if (!cancelled) setLoadingEntries(false) })
    return () => { cancelled = true }
  }, [open, todayDate])

  // Reset form when panel closes
  useEffect(() => {
    if (open) return
    setResidentSearch('')
    setSelectedResidentId('')
    setResidentDropdownOpen(false)
    setCreateResidentOpen(false)
    setCreateResidentName('')
    setCreateResidentRoom('')
    setCreateResidentError(null)
    setRoomOverride('')
    setServiceSearch('')
    setSelectedServiceId('')
    setServiceDropdownOpen(false)
    setRequestedTime('')
    setPreferredDate('')
    setAssignedStylistId('')
    setNotes('')
  }, [open])

  const allResidents = useMemo(() => [...residents, ...localNewResidents], [residents, localNewResidents])

  const selectedResident = useMemo(
    () => allResidents.find((r) => r.id === selectedResidentId) ?? null,
    [allResidents, selectedResidentId],
  )

  const filteredResidents = useMemo(() => {
    const q = residentSearch.trim().toLowerCase()
    if (!q) return allResidents.filter((r) => r.active).slice(0, 30)
    return allResidents.filter((r) =>
      r.active && (
        r.name.toLowerCase().includes(q) ||
        (r.roomNumber && r.roomNumber.toLowerCase().includes(q))
      )
    ).slice(0, 30)
  }, [allResidents, residentSearch])

  const activeServices = useMemo(
    () => services.filter((s) => s.active && s.pricingType !== 'addon'),
    [services],
  )

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
    setRoomOverride('')
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
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setCreateResidentError(
          res.status === 409
            ? 'A resident with this name already exists'
            : (json.error ?? 'Failed to create resident')
        )
        return
      }
      const newResident: Resident = json.data
      setLocalNewResidents((prev) => [...prev, newResident])
      onResidentCreated?.(newResident)
      setSelectedResidentId(newResident.id)
      setResidentSearch(newResident.name)
      setResidentDropdownOpen(false)
      setCreateResidentOpen(false)
      setCreateResidentName('')
      setCreateResidentRoom('')
    } finally {
      setCreatingResident(false)
    }
  }

  const handleSelectService = (s: Service) => {
    setSelectedServiceId(s.id)
    setServiceSearch(s.name)
    setServiceDropdownOpen(false)
  }

  const canSubmit = !!selectedResidentId && !!selectedServiceId && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    const resident = selectedResident
    const service = selectedService
    if (!resident || !service) return

    setSubmitting(true)
    try {
      const roomNumber = roomOverride.trim() || resident.roomNumber || undefined
      const res = await fetch('/api/signup-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          residentId: resident.id,
          residentName: resident.name,
          roomNumber,
          serviceId: service.id,
          serviceName: service.name,
          requestedTime: requestedTime || null,
          requestedDate: todayDate,
          preferredDate: preferredDate || null,
          notes: notes.trim() || null,
          assignedToStylistId: assignedStylistId || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(typeof json.error === 'string' ? json.error : 'Failed to add entry')
        return
      }
      setEntries((prev) => [...prev, json.data])
      // Reset form (except selections that might be reused — clear everything)
      setResidentSearch('')
      setSelectedResidentId('')
      setRoomOverride('')
      setServiceSearch('')
      setSelectedServiceId('')
      setRequestedTime('')
      setPreferredDate('')
      setAssignedStylistId('')
      setNotes('')
      toast.success('Added to sign-up sheet')
    } catch (e) {
      console.error(e)
      toast.error('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancelEntry = async (id: string) => {
    try {
      const res = await fetch(`/api/signup-sheet/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (!res.ok) {
        const json = await res.json()
        toast.error(typeof json.error === 'string' ? json.error : 'Failed to cancel')
        return
      }
      setEntries((prev) => prev.filter((e) => e.id !== id))
    } catch (e) {
      console.error(e)
      toast.error('Network error.')
    }
  }

  // Group entries by stylist (or Unassigned)
  const grouped = useMemo(() => {
    const map = new Map<string, { stylist: Stylist | null; entries: SignupSheetEntryWithRelations[] }>()
    for (const entry of entries) {
      const key = entry.assignedToStylistId ?? '__unassigned__'
      const stylist = entry.assignedStylist ?? stylists.find((s) => s.id === entry.assignedToStylistId) ?? null
      if (!map.has(key)) map.set(key, { stylist, entries: [] })
      map.get(key)!.entries.push(entry)
    }
    return Array.from(map.entries())
  }, [entries, stylists])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end md:items-stretch md:justify-end md:py-6 md:pr-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        ref={containerRef}
        data-tour="signup-sheet-panel"
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-3xl md:rounded-2xl w-full md:max-w-lg flex flex-col shadow-2xl"
        style={{ maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-stone-900" style={{ fontFamily: "'DM Serif Display', serif" }}>
              Today&apos;s Sign-Up Sheet
            </h2>
            <p className="text-xs text-stone-500">Log residents who want appointments — stylists will schedule them.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center text-stone-400 hover:text-stone-600"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scroll body: form + queue */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
          {/* Admin "Pending requests" section (cross-stylist view) */}
          {(role === 'admin' || role === 'super_admin' || role === 'facility_staff') && (
            <AdminPendingSection facilityTimezone={facilityTimezone} />
          )}

          {/* Form */}
          <div data-tour="signup-sheet-form" className="space-y-3">
            {/* Resident */}
            <div className="flex flex-col gap-1.5 relative">
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
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
                  const dropdown = e.currentTarget.closest('.relative')
                  if (dropdown && related && dropdown.contains(related)) return
                  setTimeout(() => setResidentDropdownOpen(false), 150)
                }}
                placeholder="Search by name or room…"
                className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
              />
              {selectedResident?.roomNumber && (
                <p className="text-sm text-stone-500 -mt-0.5">Room {selectedResident.roomNumber}</p>
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
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
                      />
                      <input
                        value={createResidentRoom}
                        onChange={(e) => setCreateResidentRoom(e.target.value)}
                        placeholder="Room number (optional)"
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
                      />
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onMouseDown={() => { setCreateResidentOpen(false); setCreateResidentError(null) }}
                          className="flex-1 min-h-[44px] text-sm text-stone-600 border border-stone-200 rounded-xl hover:bg-stone-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={!createResidentName.trim() || creatingResident}
                          onMouseDown={handleCreateResident}
                          className="flex-1 min-h-[44px] text-sm font-semibold bg-[#8B2E4A] text-white rounded-xl hover:bg-[#72253C] disabled:opacity-50"
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
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
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
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      Add &quot;{residentSearch.trim()}&quot; as new resident
                    </button>
                  ) : residentSearch ? (
                    <div className="px-3.5 py-3">
                      <p className="text-sm text-stone-400">No residents found</p>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Room override (visible if no resident selected yet, or resident has no room) */}
            {(!selectedResident || !selectedResident.roomNumber) && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                  Room {selectedResident?.roomNumber && <span className="text-stone-400">(from resident)</span>}
                </label>
                <input
                  type="text"
                  value={roomOverride}
                  onChange={(e) => setRoomOverride(e.target.value)}
                  placeholder="Room number (optional)"
                  className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
                />
              </div>
            )}

            {/* Service */}
            <div className="flex flex-col gap-1.5 relative">
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Service <span className="text-red-400">*</span>
              </label>
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
                  const dropdown = e.currentTarget.closest('.relative')
                  if (dropdown && related && dropdown.contains(related)) return
                  setTimeout(() => setServiceDropdownOpen(false), 150)
                }}
                placeholder="Search services…"
                className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
              />
              {serviceDropdownOpen && (
                <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-stone-200 rounded-xl shadow-lg z-50 max-h-52 overflow-y-auto">
                  {filteredServices.length === 0 ? (
                    <p className="px-3.5 py-3 text-sm text-stone-400">No services found</p>
                  ) : filteredServices.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseDown={() => handleSelectService(s)}
                      className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-stone-50 border-b border-stone-50 last:border-0"
                    >
                      <span className="font-medium text-stone-900">{s.name}</span>
                      {s.priceCents > 0 && <span className="text-stone-400 ml-2 text-xs">${(s.priceCents / 100).toFixed(2)}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Preferred date (Phase 12S — drives auto-assignment) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Preferred date (optional)</label>
              <input
                type="date"
                data-tour="signup-sheet-preferred-date"
                value={preferredDate}
                min={todayDate}
                onChange={(e) => setPreferredDate(e.target.value)}
                className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
              />
            </div>

            {/* Time + Stylist */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Preferred time</label>
                <input
                  type="time"
                  value={requestedTime}
                  onChange={(e) => setRequestedTime(e.target.value)}
                  className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Stylist</label>
                <select
                  value={assignedStylistId}
                  onChange={(e) => setAssignedStylistId(e.target.value)}
                  className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
                >
                  <option value="">Unassigned</option>
                  {stylists.filter((s) => s.active).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Notes (Phase 12S — textarea with placeholder copy) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Notes for stylist (optional)</label>
              <textarea
                data-tour="signup-sheet-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. prefers morning, needs extra time"
                maxLength={300}
                className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
              />
            </div>

            {/* Submit */}
            <button
              type="button"
              data-tour="signup-sheet-submit"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="w-full min-h-[48px] bg-[#8B2E4A] text-white rounded-xl text-sm font-semibold shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Adding…' : 'Add to Sheet'}
            </button>
          </div>

          {/* Queue */}
          <div className="pt-2 border-t border-stone-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Today&apos;s Queue ({entries.length})
              </h3>
            </div>

            {loadingEntries ? (
              <p className="text-sm text-stone-400 py-4 text-center">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-stone-400 py-4 text-center">
                No sign-up sheet entries for today. Use the form above to add residents.
              </p>
            ) : (
              <div className="space-y-4">
                {grouped.map(([key, group]) => (
                  <div key={key}>
                    <div className="flex items-center gap-2 mb-2">
                      {group.stylist && (
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: group.stylist.color }}
                        />
                      )}
                      <p className="text-xs font-semibold text-stone-600">
                        {group.stylist ? group.stylist.name : 'Unassigned'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      {group.entries.map((entry) => (
                        <div
                          key={entry.id}
                          className="rounded-xl border border-stone-100 bg-white p-3 flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-stone-900 leading-snug">
                              {entry.residentName}
                              {entry.roomNumber && <span className="text-stone-400 ml-2 text-xs font-normal">Rm {entry.roomNumber}</span>}
                            </p>
                            <p className="text-[12.5px] text-stone-600 leading-snug mt-0.5">
                              {entry.serviceName}
                              {entry.requestedTime && <span className="text-stone-500 ml-2">@ {formatHm(entry.requestedTime)}</span>}
                            </p>
                            {entry.notes && <p className="text-[11.5px] text-stone-500 mt-1">{entry.notes}</p>}
                            <span className="inline-block mt-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              Pending
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCancelEntry(entry.id)}
                            aria-label="Cancel"
                            className="shrink-0 w-7 h-7 flex items-center justify-center text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                              <line x1="6" y1="6" x2="18" y2="18" />
                              <line x1="18" y1="6" x2="6" y2="18" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// "HH:MM" → "h:mm a"
function formatHm(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return hhmm
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')}${period}`
}

// "YYYY-MM-DD" → "Mon Jun 3" in the facility tz
function formatDateChip(yyyymmdd: string, tz: string): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  if (!y || !m || !d) return yyyymmdd
  // Anchor at noon UTC of that date so tz conversion doesn't shift the weekday
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  return formatDateInTz(anchor, tz)
}

/**
 * Phase 12S — admin/facility_staff cross-stylist view.
 * Fetches all pending entries for the facility via ?scope=all.
 */
function AdminPendingSection({ facilityTimezone }: { facilityTimezone: string }) {
  const { toast } = useToast()
  const [entries, setEntries] = useState<SignupSheetEntryWithRelations[]>([])
  const [loaded, setLoaded] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/signup-sheet?scope=all')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        if (Array.isArray(j.data)) setEntries(j.data)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const handleCancel = async (id: string) => {
    try {
      const res = await fetch(`/api/signup-sheet/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (!res.ok) {
        const j = await res.json()
        toast.error(typeof j.error === 'string' ? j.error : 'Failed to cancel')
        return
      }
      setEntries((prev) => prev.filter((e) => e.id !== id))
    } catch {
      toast.error('Network error.')
    }
  }

  if (!loaded) return null

  const visible = showAll ? entries : entries.slice(0, 5)

  return (
    <div className="border-b border-stone-100 pb-4">
      <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">
        Pending requests ({entries.length})
      </h3>
      {entries.length === 0 ? (
        <p className="text-sm text-stone-400">No pending requests.</p>
      ) : (
        <>
          <div className="space-y-2">
            {visible.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-stone-100 bg-white p-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-stone-900 leading-snug">
                    {entry.residentName}
                    {entry.roomNumber && (
                      <span className="text-stone-400 ml-2 text-xs font-normal">Rm {entry.roomNumber}</span>
                    )}
                  </p>
                  <p className="text-[12.5px] text-stone-600 leading-snug mt-0.5">{entry.serviceName}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {entry.preferredDate && (
                      <span className="inline-flex items-center gap-1 text-xs bg-stone-100 text-stone-600 rounded-full px-2 py-0.5">
                        <Calendar size={12} />
                        {formatDateChip(entry.preferredDate, facilityTimezone)}
                      </span>
                    )}
                    {entry.assignedStylist && (
                      <span className="text-[11px] text-stone-400">→ {entry.assignedStylist.name}</span>
                    )}
                  </div>
                  {entry.notes && (
                    <p className="text-[11.5px] text-stone-500 italic mt-1 truncate">{entry.notes}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleCancel(entry.id)}
                  aria-label="Cancel"
                  className="shrink-0 w-7 h-7 flex items-center justify-center text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <line x1="6" y1="6" x2="18" y2="18" />
                    <line x1="18" y1="6" x2="6" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          {entries.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 text-xs font-medium text-[#8B2E4A] hover:underline"
            >
              {showAll ? 'Show fewer' : `Show all (${entries.length})`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
