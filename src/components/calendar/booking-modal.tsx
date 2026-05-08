'use client'

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { Modal } from '@/components/ui/modal'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { formatCents } from '@/lib/utils'
import { resolvePrice, formatPricingLabel } from '@/lib/pricing'
import { computeTipCents } from '@/lib/tips'
import { toDateTimeLocalInTz, fromDateTimeLocalInTz, formatDateInTz, formatTimeInTz } from '@/lib/time'
import {
  buildCategoryPriority,
  sortCategoryGroups,
  sortServicesWithinCategory,
} from '@/lib/service-sort'
import { useIsMobile } from '@/hooks/use-is-mobile'
import type { Resident, Service } from '@/types'
import type { BookingWithRelations } from '@/app/(protected)/dashboard/dashboard-client'
import { useToast } from '@/components/ui/toast'

interface BookingModalProps {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  booking: BookingWithRelations | null
  defaultStart: Date | null
  defaultEnd: Date | null
  residents: Resident[]
  services: Service[]
  facilityId: string
  // Phase 12F: facility's IANA timezone — drives <input type="datetime-local">
  // population, error-message formatting, and submit-side UTC conversion.
  facilityTimezone: string
  onBookingChange: (booking: BookingWithRelations) => void
  onBookingDeleted: (bookingId: string) => void
  isAdmin?: boolean
  serviceCategoryOrder?: string[] | null
}

interface PickedStylist {
  id: string
  name: string
  color: string
}

// Phase 12F: facility-tz aware. Browser-tz version was the calendar/log
// display bug: a 9 a.m. EST booking populated the input as "16:00" (4 p.m.)
// when the viewer was in UTC+3.
function formatDateTimeLocal(date: Date | string, tz: string): string {
  return toDateTimeLocalInTz(date, tz)
}

export function BookingModal({
  open,
  onClose,
  mode,
  booking,
  defaultStart,
  defaultEnd,
  residents,
  services,
  facilityId,
  facilityTimezone,
  onBookingChange,
  onBookingDeleted,
  isAdmin,
  serviceCategoryOrder,
}: BookingModalProps) {
  const [residentSearch, setResidentSearch] = useState('')
  const [residentDropdownOpen, setResidentDropdownOpen] = useState(false)
  const [selectedResidentId, setSelectedResidentId] = useState('')
  // Multi-service: ordered list of primary service IDs. First = primary.
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [pickedStylist, setPickedStylist] = useState<PickedStylist | null>(null)
  const [availableCount, setAvailableCount] = useState<number | null>(null)
  const [loadingStylists, setLoadingStylists] = useState(false)
  const [startTime, setStartTime] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelReasonOther, setCancelReasonOther] = useState('')
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurringRule, setRecurringRule] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly')
  const [recurringEndDate, setRecurringEndDate] = useState('')
  const [addonChecked, setAddonChecked] = useState(false)
  const [selectedQuantity, setSelectedQuantity] = useState(1)
  const [selectedOptionName, setSelectedOptionName] = useState('')
  const [selectedAddonServiceIds, setSelectedAddonServiceIds] = useState<string[]>([])
  const [localNewResidents, setLocalNewResidents] = useState<Resident[]>([])
  const [createResidentOpen, setCreateResidentOpen] = useState(false)
  const [createResidentName, setCreateResidentName] = useState('')
  const [createResidentRoom, setCreateResidentRoom] = useState('')
  const [creatingResident, setCreatingResident] = useState(false)
  const [createResidentError, setCreateResidentError] = useState<string | null>(null)
  // Phase 12E — tip
  const [tipType, setTipType] = useState<'percentage' | 'fixed'>('percentage')
  const [tipValue, setTipValue] = useState<number | ''>('')
  // Once the user manually clears the tip we stop auto-filling from the resident default.
  const [tipCleared, setTipCleared] = useState(false)
  // Phase 12E — manual receipt send
  const [sendingReceipt, setSendingReceipt] = useState(false)

  const residentInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Synchronous mutex — prevents concurrent handleSubmit calls regardless of render batching
  const submittingRef = useRef(false)

  const isMobile = useIsMobile()
  const { toast } = useToast()

  // Split services: primaries (non-addon) pickable in the multi-service list; addons are a separate checklist
  const primaryServiceCandidates = services.filter((s) => s.pricingType !== 'addon')
  const addonServices = sortServicesWithinCategory(
    services.filter((s) => s.pricingType === 'addon' && !selectedServiceIds.includes(s.id))
  )

  const categoryPriority = buildCategoryPriority(serviceCategoryOrder)

  // Group services by `category`. "Other" (nullish) sorts last; otherwise follow per-facility
  // serviceCategoryOrder if present, else fall back to Z→A alphabetical.
  const groupByCategory = <T extends { category?: string | null }>(items: T[]): Array<[string, T[]]> => {
    const groups = new Map<string, T[]>()
    for (const s of items) {
      const key = s.category?.trim() || 'Other'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(s)
    }
    return sortCategoryGroups([...groups.entries()], categoryPriority)
  }

  // Selected primary services in order
  const selectedServices = selectedServiceIds
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is Service => !!s)
  const primaryService = selectedServices[0] ?? null
  const selectedServiceId = primaryService?.id ?? ''

  const allResidents = [...residents, ...localNewResidents]
  const filteredResidents = allResidents.filter(
    (r) =>
      r.name.toLowerCase().includes(residentSearch.toLowerCase()) ||
      (r.roomNumber && r.roomNumber.toLowerCase().includes(residentSearch.toLowerCase()))
  )

  // Pre-fill form when modal opens
  useEffect(() => {
    if (!open) return

    if (mode === 'edit' && booking) {
      setSelectedResidentId(booking.residentId)
      // Prefer booking.serviceIds (multi), fall back to single serviceId
      const existingIds =
        booking.serviceIds && booking.serviceIds.length > 0
          ? booking.serviceIds
          : booking.serviceId
            ? [booking.serviceId]
            : []
      setSelectedServiceIds(existingIds)
      setSelectedAddonServiceIds(booking.addonServiceIds ?? [])
      setStartTime(formatDateTimeLocal(booking.startTime, facilityTimezone))
      setNotes(booking.notes ?? '')
      setResidentSearch(booking.resident?.name ?? '')
      // Edit mode: surface the existing tip as a fixed amount (we lose the original
      // %/$ choice but the cents value is authoritative).
      if (booking.tipCents != null && booking.tipCents > 0) {
        setTipType('fixed')
        setTipValue(booking.tipCents)
        setTipCleared(false)
      } else {
        setTipType('percentage')
        setTipValue('')
        setTipCleared(true) // existing booking has no tip — don't auto-fill from resident default
      }
    } else {
      setSelectedResidentId('')
      setSelectedServiceIds([])
      setSelectedAddonServiceIds([])
      setStartTime(defaultStart ? formatDateTimeLocal(defaultStart, facilityTimezone) : '')
      setNotes('')
      setResidentSearch('')
      // Create mode: clear tip; resident-default useEffect below will populate it
      setTipType('percentage')
      setTipValue('')
      setTipCleared(false)
    }
    setPickedStylist(null)
    setAvailableCount(null)
    setLoadingStylists(false)
    setError(null)
    setConfirmCancel(false)
    setCancelReason('')
    setCancelReasonOther('')
    setResidentDropdownOpen(false)
    setIsRecurring(false)
    setRecurringRule('weekly')
    setAddonChecked(false)
    setSelectedQuantity(1)
    setSelectedOptionName('')
    setLocalNewResidents([])
    setCreateResidentOpen(false)
    setCreateResidentName('')
    setCreateResidentRoom('')
    setCreateResidentError(null)

    // Default recurring end date = 3 months from now
    const threeMonths = new Date()
    threeMonths.setMonth(threeMonths.getMonth() + 3)
    setRecurringEndDate(threeMonths.toISOString().split('T')[0])
  }, [open, mode, booking, defaultStart]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll content area back to top so the form always opens at Resident.
  // Runs on [open, isMobile] so the reset fires after the mobile-mode swap
  // (first render can be Modal before useIsMobile flips, then BottomSheet mounts).
  useLayoutEffect(() => {
    if (!open) return
    if (!scrollRef.current) return
    let el: HTMLElement | null = scrollRef.current
    while (el) {
      const { overflowY, overflow } = window.getComputedStyle(el)
      if (overflowY === 'auto' || overflowY === 'scroll' || overflow === 'auto' || overflow === 'scroll') {
        el.scrollTop = 0
        break
      }
      el = el.parentElement
    }
  }, [open, isMobile])

  // Reset pricing inputs when the PRIMARY service changes
  useEffect(() => {
    setAddonChecked(false)
    setSelectedQuantity(1)
    if (primaryService?.pricingType === 'multi_option' && primaryService.pricingOptions?.length) {
      setSelectedOptionName(primaryService.pricingOptions[0].name)
    } else {
      setSelectedOptionName('')
    }
  }, [selectedServiceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 12E — auto-fill tip from resident's saved default when a resident is picked
  // (create mode only; only when user hasn't manually cleared the tip)
  useEffect(() => {
    if (mode === 'edit') return
    if (tipCleared) return
    if (!selectedResidentId) return
    const r = allResidents.find((r) => r.id === selectedResidentId)
    if (!r) return
    if (r.defaultTipType === 'percentage' && r.defaultTipValue != null) {
      setTipType('percentage')
      setTipValue(r.defaultTipValue)
    } else if (r.defaultTipType === 'fixed' && r.defaultTipValue != null) {
      setTipType('fixed')
      setTipValue(r.defaultTipValue)
    } else {
      setTipType('percentage')
      setTipValue('')
    }
  }, [selectedResidentId]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Pricing totals ---
  const primaryResolved = primaryService
    ? resolvePrice(primaryService, {
        quantity: selectedQuantity,
        selectedOption: selectedOptionName,
        includeAddon: addonChecked,
      })
    : null
  const additionalPrimaryTotal = selectedServices
    .slice(1)
    .reduce((sum, s) => sum + resolvePrice(s).priceCents, 0)
  const multiAddonTotal = selectedAddonServiceIds.reduce((sum, id) => {
    const svc = services.find((s) => s.id === id)
    return sum + (svc?.addonAmountCents ?? svc?.priceCents ?? 0)
  }, 0)
  const displayPriceCents =
    (primaryResolved?.priceCents ?? primaryService?.priceCents ?? 0) +
    additionalPrimaryTotal +
    multiAddonTotal

  const totalDurationMinutes = selectedServices.reduce(
    (sum, s) => sum + s.durationMinutes,
    0
  )

  // Phase 12E — tip preview (cents). Drives the Total line + the POST body.
  const tipNumeric = typeof tipValue === 'number' ? tipValue : 0
  const tipCentsPreview = tipNumeric > 0 ? computeTipCents(displayPriceCents, tipType, tipNumeric) : 0

  const toggleAddonService = (id: string) =>
    setSelectedAddonServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )

  const setServiceAt = (index: number, id: string) =>
    setSelectedServiceIds((prev) => {
      const next = [...prev]
      next[index] = id
      return next
    })
  const removeServiceAt = (index: number) =>
    setSelectedServiceIds((prev) => prev.filter((_, i) => i !== index))
  const addAnotherService = () => {
    setSelectedServiceIds((prev) => [...prev, ''])
  }

  // Auto-assign stylist preview: fetch the candidate the server will pick once date + services
  // are both set. Skip in edit mode (existing stylist stays). Effect re-runs on date or service
  // changes; AbortController keeps the displayed name in sync with the latest selection.
  useEffect(() => {
    if (mode === 'edit') return
    if (!open) return
    if (!startTime) {
      setPickedStylist(null)
      setAvailableCount(null)
      return
    }
    const validServiceIds = selectedServiceIds.filter((id) => !!id)
    if (validServiceIds.length === 0) {
      setPickedStylist(null)
      setAvailableCount(null)
      return
    }
    const startDate = new Date(startTime)
    if (Number.isNaN(startDate.getTime())) return
    const duration = selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0)
    if (duration <= 0) return
    const endDate = new Date(startDate.getTime() + duration * 60000)

    const controller = new AbortController()
    setLoadingStylists(true)
    const url = `/api/stylists/available?facilityId=${encodeURIComponent(facilityId)}&startTime=${encodeURIComponent(
      startDate.toISOString(),
    )}&endTime=${encodeURIComponent(endDate.toISOString())}`
    fetch(url, { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        if (controller.signal.aborted) return
        const data = json?.data
        if (!data) {
          setPickedStylist(null)
          setAvailableCount(0)
          return
        }
        setPickedStylist(data.picked)
        setAvailableCount(Array.isArray(data.available) ? data.available.length : 0)
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setPickedStylist(null)
        setAvailableCount(0)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingStylists(false)
      })
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, startTime, selectedServiceIds.join(','), facilityId])

  // Cmd+Enter to submit
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit()
    }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedResidentId, selectedServiceIds, pickedStylist, startTime, notes])

  const handleSubmit = async () => {
    if (
      !selectedResidentId ||
      selectedServiceIds.length === 0 ||
      selectedServiceIds.some((id) => !id) ||
      !startTime
    ) {
      setError('Please fill in all required fields.')
      return
    }
    if (mode === 'create' && !pickedStylist) {
      setError('No stylist available for this date and time.')
      return
    }
    // Synchronous guard — setSubmitting(true) is async state and won't re-render before the
    // next tick, so rapid taps/Cmd+Enter can slip through. A ref check is immune to that.
    if (submittingRef.current) return
    submittingRef.current = true

    setSubmitting(true)
    setError(null)

    try {
      const isCreatingRecurring = mode === 'create' && isRecurring && isAdmin

      const pricingFields = {
        ...(primaryService?.pricingType === 'addon' ? { addonChecked } : {}),
        ...(primaryService?.pricingType === 'tiered' ? { selectedQuantity } : {}),
        ...(primaryService?.pricingType === 'multi_option' ? { selectedOption: selectedOptionName } : {}),
        ...(selectedAddonServiceIds.length > 0
          ? { addonServiceIds: selectedAddonServiceIds }
          : mode === 'edit'
            ? { addonServiceIds: [] } // explicitly clear
            : {}),
      }

      const basePayload = {
        residentId: selectedResidentId,
        serviceIds: selectedServiceIds,
        // Phase 12F — startTime is a "datetime-local" string in the FACILITY's tz.
        // Convert via fromDateTimeLocalInTz so a viewer in UTC+3 doesn't shift the
        // booking by their browser offset on save.
        startTime: fromDateTimeLocalInTz(startTime, facilityTimezone).toISOString(),
        notes: notes || undefined,
        // Phase 12E — null clears any existing tip on edit; > 0 sets it
        tipCents: tipCentsPreview > 0 ? tipCentsPreview : null,
        ...pricingFields,
      }

      const payload = isCreatingRecurring
        ? { ...basePayload, recurringRule, recurringEndDate }
        : basePayload

      const url = isCreatingRecurring
        ? '/api/bookings/recurring'
        : mode === 'create'
          ? '/api/bookings'
          : `/api/bookings/${booking!.id}`
      const method = mode === 'create' ? 'POST' : 'PUT'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const json = await res.json()

      if (res.status === 409) {
        setError('This stylist already has a booking at that time.')
        return
      }
      if (!res.ok) {
        setError(
          typeof json.error === 'string'
            ? json.error
            : json.error?.message ?? 'Something went wrong.'
        )
        return
      }

      if (mode === 'create' && isRecurring && isAdmin) {
        const skippedCount = Array.isArray(json.data.skipped) ? json.data.skipped.length : 0
        const msg = skippedCount > 0
          ? `${json.data.count} appointments booked. ${skippedCount} skipped (no stylist available).`
          : `${json.data.count} recurring appointments booked!`
        toast(msg, 'success')
        onClose()
      } else {
        onBookingChange(json.data)
        toast(mode === 'create' ? 'Appointment booked!' : 'Appointment updated', 'success')
        onClose()
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const handleCancelBooking = async () => {
    if (!confirmCancel) {
      setConfirmCancel(true)
      return
    }

    const effectiveReason =
      cancelReason === 'Other'
        ? cancelReasonOther.trim() || undefined
        : cancelReason || undefined

    setCancelling(true)
    try {
      const res = await fetch(`/api/bookings/${booking!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'cancelled',
          cancellationReason: effectiveReason,
        }),
      })
      if (res.ok) {
        onBookingDeleted(booking!.id)
        toast('Appointment cancelled', 'info')
        onClose()
      } else {
        const json = await res.json()
        setError(json.error ?? 'Failed to cancel.')
      }
    } catch {
      setError('Network error.')
    } finally {
      setCancelling(false)
    }
  }

  const formTitle = mode === 'create' ? 'New Appointment' : 'Edit Appointment'

  // Cancel reason selector — defined first so cancelSection can reference it
  const cancelReasonSelect = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
        Reason (optional)
      </label>
      <select
        value={cancelReason}
        onChange={(e) => setCancelReason(e.target.value)}
        className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A] transition-all"
      >
        <option value="">Select a reason</option>
        <option value="No show">No show</option>
        <option value="Resident request">Resident request</option>
        <option value="Stylist unavailable">Stylist unavailable</option>
        <option value="Facility closed">Facility closed</option>
        <option value="Other">Other</option>
      </select>
      {cancelReason === 'Other' && (
        <input
          type="text"
          value={cancelReasonOther}
          onChange={(e) => setCancelReasonOther(e.target.value)}
          placeholder="Describe the reason..."
          className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
        />
      )}
    </div>
  )

  // Cancel section — inside scroll area so it never blocks the footer
  const cancelSection = mode === 'edit' ? (
    <div className="px-6 pb-4 pt-2 border-t border-stone-100">
      {!confirmCancel ? (
        <Button
          variant="danger"
          size="sm"
          onClick={() => setConfirmCancel(true)}
          disabled={submitting || cancelling}
        >
          Cancel appointment
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-red-600">Cancel this appointment?</p>
          {cancelReasonSelect}
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              loading={cancelling}
              onClick={handleCancelBooking}
              disabled={submitting}
            >
              Yes, cancel
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setConfirmCancel(false); setCancelReason(''); setCancelReasonOther('') }}
              disabled={cancelling}
            >
              No
            </Button>
          </div>
        </div>
      )}
    </div>
  ) : null

  // Scrollable form content — all form fields + cancel section
  const formFields = (
    <>
      <div ref={scrollRef} className="px-6 py-4 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Resident — searchable combobox */}
        <div className="flex flex-col gap-1.5 relative">
          <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
            Resident <span className="text-red-400">*</span>
          </label>
          <input
            ref={residentInputRef}
            type="text"
            value={residentSearch}
            onChange={(e) => {
              setResidentSearch(e.target.value)
              setResidentDropdownOpen(true)
              if (selectedResidentId) {
                const r = residents.find((r) => r.id === selectedResidentId)
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
            placeholder="Search by name or room..."
            disabled={submitting}
            className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all duration-150 disabled:opacity-60"
          />
          {residentDropdownOpen && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-stone-200 rounded-xl shadow-lg z-50 max-h-52 overflow-y-auto">
              {createResidentOpen ? (
                <div className="p-3 space-y-2">
                  <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">New Resident</p>
                  {createResidentError && (
                    <p className="text-xs text-red-600">{createResidentError}</p>
                  )}
                  <input
                    autoFocus
                    tabIndex={0}
                    value={createResidentName}
                    onChange={(e) => setCreateResidentName(e.target.value)}
                    placeholder="Full name *"
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                  />
                  <input
                    tabIndex={0}
                    value={createResidentRoom}
                    onChange={(e) => setCreateResidentRoom(e.target.value)}
                    placeholder="Room number (optional)"
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                  />
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onMouseDown={() => { setCreateResidentOpen(false); setCreateResidentError(null) }}
                      className="flex-1 min-h-[44px] text-sm text-stone-600 border border-stone-200 rounded-xl hover:bg-stone-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!createResidentName.trim() || creatingResident}
                      onMouseDown={async () => {
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
                          setSelectedResidentId(newResident.id)
                          setResidentSearch(newResident.name)
                          setResidentDropdownOpen(false)
                          setCreateResidentOpen(false)
                          setCreateResidentName('')
                          setCreateResidentRoom('')
                        } finally {
                          setCreatingResident(false)
                        }
                      }}
                      className="flex-1 min-h-[44px] text-sm font-semibold bg-[#8B2E4A] text-white rounded-xl hover:bg-[#72253C] disabled:opacity-50 transition-colors"
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
                      onMouseDown={() => {
                        setSelectedResidentId(r.id)
                        setResidentSearch(r.name)
                        setResidentDropdownOpen(false)
                      }}
                      className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-stone-50 transition-colors border-b border-stone-50 last:border-0"
                    >
                      <span className="font-medium text-stone-900">{r.name}</span>
                      {r.roomNumber && (
                        <span className="text-stone-400 ml-2 text-xs">Room {r.roomNumber}</span>
                      )}
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
                      className="w-full text-left px-3.5 py-2.5 min-h-[44px] text-sm font-medium text-[#8B2E4A] border-t border-stone-100 hover:bg-rose-50 transition-colors flex items-center gap-2"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Create &quot;{residentSearch.trim()}&quot;
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
                  className="w-full text-left px-3.5 py-2.5 min-h-[44px] text-sm font-medium text-[#8B2E4A] hover:bg-rose-50 transition-colors flex items-center gap-2"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Create &quot;{residentSearch.trim()}&quot;
                </button>
              ) : residentSearch ? (
                <div className="px-3.5 py-3">
                  <p className="text-sm text-stone-400">No residents found</p>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Services — multi-service builder */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
            Services <span className="text-red-400">*</span>
          </label>
          {selectedServiceIds.map((svcId, idx) => {
            const availableOptions = sortServicesWithinCategory(
              primaryServiceCandidates.filter(
                (s) => s.id === svcId || !selectedServiceIds.includes(s.id)
              )
            )
            return (
              <div key={idx} className="flex items-center gap-2">
                <select
                  value={svcId}
                  onChange={(e) => setServiceAt(idx, e.target.value)}
                  disabled={submitting}
                  className="flex-1 w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-3 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all disabled:opacity-60 min-h-[48px]"
                >
                  <option value="">Select a service</option>
                  {(() => {
                    const groups = groupByCategory(availableOptions)
                    if (groups.length <= 1) {
                      return availableOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {`${s.name} · ${formatPricingLabel(s)}`}
                        </option>
                      ))
                    }
                    return groups.map(([category, list]) => (
                      <optgroup key={category} label={category}>
                        {list.map((s) => (
                          <option key={s.id} value={s.id}>
                            {`${s.name} · ${formatPricingLabel(s)}`}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  })()}
                </select>
                {selectedServiceIds.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeServiceAt(idx)}
                    disabled={submitting}
                    aria-label="Remove service"
                    className="shrink-0 h-11 w-11 rounded-xl border border-stone-200 bg-stone-50 text-stone-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors flex items-center justify-center"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                  </button>
                )}
              </div>
            )
          })}
          {primaryServiceCandidates.some((s) => !selectedServiceIds.includes(s.id)) && (
            <button
              type="button"
              onClick={addAnotherService}
              disabled={submitting}
              className="w-full border border-dashed border-stone-200 rounded-xl py-2.5 text-sm font-medium text-[#8B2E4A] hover:bg-rose-50 transition-colors flex items-center justify-center gap-1 min-h-[44px]"
            >
              + Add another service
            </button>
          )}
        </div>

        {/* Pricing inputs — apply to the PRIMARY (first) service */}
        {primaryService?.pricingType === 'addon' && (
          <label className="flex items-center gap-3 bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-3 cursor-pointer hover:bg-stone-100 transition-colors min-h-[44px]">
            <input
              type="checkbox"
              checked={addonChecked}
              onChange={(e) => setAddonChecked(e.target.checked)}
              disabled={submitting}
              className="rounded accent-[#8B2E4A] h-6 w-6 shrink-0"
            />
            <span className="text-sm text-stone-700">
              Add-on (+{formatCents(primaryService.addonAmountCents ?? 0)})
            </span>
          </label>
        )}

        {primaryService?.pricingType === 'tiered' && (() => {
          const tiers = primaryService.pricingTiers ?? []
          const activeTier = tiers.find((t) => selectedQuantity >= t.minQty && selectedQuantity <= t.maxQty)
          return (
            <div className="bg-stone-50 rounded-xl px-3.5 py-3 flex flex-col gap-2">
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                How many?
              </label>
              <div className="flex items-center rounded-xl border border-stone-200 overflow-hidden bg-stone-50 self-start">
                <button
                  type="button"
                  onClick={() => setSelectedQuantity((q) => Math.max(1, q - 1))}
                  disabled={submitting || selectedQuantity <= 1}
                  className="h-11 w-11 flex items-center justify-center text-stone-600 hover:bg-stone-100 active:bg-stone-200 transition-colors disabled:opacity-40 text-lg font-medium border-r border-stone-200"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="w-14 text-center text-base font-semibold text-stone-900 select-none">
                  {selectedQuantity}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedQuantity((q) => q + 1)}
                  disabled={submitting}
                  className="h-11 w-11 flex items-center justify-center text-white bg-[#8B2E4A] hover:bg-[#72253C] active:bg-[#5c1e2e] transition-colors text-lg font-medium border-l border-stone-200"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
              {activeTier && (
                <p className="text-xs text-stone-500">
                  {activeTier.minQty}–{activeTier.maxQty >= 999 ? `${activeTier.minQty}+` : activeTier.maxQty}: {formatCents(activeTier.unitPriceCents)} each
                  {' → '}<span className="font-semibold text-stone-700">{formatCents(selectedQuantity * activeTier.unitPriceCents)}</span>
                </p>
              )}
            </div>
          )
        })()}

        {primaryService?.pricingType === 'multi_option' && (
          <div className="bg-stone-50 rounded-xl px-3.5 py-3 flex flex-col gap-2">
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              Option
            </label>
            <select
              value={selectedOptionName}
              onChange={(e) => setSelectedOptionName(e.target.value)}
              disabled={submitting}
              className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all disabled:opacity-60 min-h-[44px]"
            >
              {primaryService.pricingOptions?.map((opt) => (
                <option key={opt.name} value={opt.name}>
                  {opt.name} — {formatCents(opt.priceCents)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Add-on services — labeled divider + full-width checklist with 24px checkboxes */}
        {addonServices.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="relative flex items-center my-3">
              <div className="flex-grow border-t border-stone-200" />
              <span className="shrink-0 mx-3 px-2 py-0.5 rounded-full bg-stone-100 text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                Add-ons (optional)
              </span>
              <div className="flex-grow border-t border-stone-200" />
            </div>
            {(() => {
              const renderRow = (svc: Service) => (
                <label
                  key={svc.id}
                  className="flex items-center gap-3 bg-white border border-stone-200 rounded-xl px-3 py-3 cursor-pointer hover:bg-stone-50 transition-colors min-h-[44px] w-full"
                >
                  <input
                    type="checkbox"
                    checked={selectedAddonServiceIds.includes(svc.id)}
                    onChange={() => toggleAddonService(svc.id)}
                    disabled={submitting}
                    className="rounded accent-[#8B2E4A] h-6 w-6 shrink-0"
                  />
                  <span className="text-sm font-medium text-stone-800 flex-1 truncate">{svc.name}</span>
                  <span className="text-sm text-stone-500 shrink-0">+{formatCents(svc.addonAmountCents ?? svc.priceCents ?? 0)}</span>
                </label>
              )
              const groups = groupByCategory(addonServices)
              if (groups.length <= 1) {
                return <div className="space-y-2">{addonServices.map(renderRow)}</div>
              }
              return (
                <div className="space-y-3">
                  {groups.map(([category, list]) => (
                    <div key={category} className="space-y-2">
                      <div className="text-xs font-medium text-stone-500 uppercase tracking-wide pt-1">{category}</div>
                      {list.map(renderRow)}
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}

        {/* Stylist (read-only — date-driven auto-assign) */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
            Stylist
          </label>
          {mode === 'edit' && booking?.stylist ? (
            <div className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-700 flex items-center gap-2 min-h-[44px]">
              <span
                aria-hidden
                className="inline-block w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: booking.stylist.color ?? '#8B2E4A' }}
              />
              <span>{booking.stylist.name}</span>
            </div>
          ) : !startTime || selectedServiceIds.filter((id) => !!id).length === 0 ? (
            <div className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-400 min-h-[44px] flex items-center">
              Pick a date and service(s) to see who's scheduled.
            </div>
          ) : loadingStylists ? (
            <div className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-400 min-h-[44px] flex items-center">
              Checking availability…
            </div>
          ) : pickedStylist ? (
            <div className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-700 flex items-center gap-2 min-h-[44px]">
              <span
                aria-hidden
                className="inline-block w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: pickedStylist.color }}
              />
              <span className="font-medium">{pickedStylist.name}</span>
              <span className="text-xs text-stone-400 ml-auto">Auto-assigned (least-loaded)</span>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3.5 py-2.5 text-sm min-h-[44px]">
              No stylist available for {formatDateInTz(fromDateTimeLocalInTz(startTime, facilityTimezone), facilityTimezone, { weekday: 'long', month: undefined, day: undefined })} at {formatTimeInTz(fromDateTimeLocalInTz(startTime, facilityTimezone), facilityTimezone)}. Please choose a different date or time.
            </div>
          )}
        </div>

        {/* Date & Time */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
            Date & Time <span className="text-red-400">*</span>
          </label>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            step="1800"
            disabled={submitting}
            className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all duration-150 disabled:opacity-60 min-h-[44px]"
          />
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Allergies, preferences, special requests..."
            disabled={submitting}
            className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all duration-150 resize-none disabled:opacity-60"
          />
        </div>

        {/* Recurring — admin only, create mode only */}
        {mode === 'create' && isAdmin && (
          <div className="flex flex-col gap-2 pt-1 border-t border-stone-100">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="rounded border-stone-300 text-[#8B2E4A] focus:ring-[#8B2E4A]"
              />
              <span className="text-sm font-medium text-stone-700">Make this recurring</span>
            </label>
            {isRecurring && (
              <div className="flex flex-col gap-3 pl-6">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Frequency</label>
                  <select
                    value={recurringRule}
                    onChange={(e) => setRecurringRule(e.target.value as 'weekly' | 'biweekly' | 'monthly')}
                    className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A] transition-all"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 Weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Repeat until</label>
                  <input
                    type="date"
                    value={recurringEndDate}
                    onChange={(e) => setRecurringEndDate(e.target.value)}
                    className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {cancelSection}
    </>
  )

  // --- Sticky footer with breakdown + total + Book button ---
  const breakdown = primaryService ? (
    <div className="space-y-1 mb-3 text-sm">
      {selectedServices.map((s, idx) => {
        const price =
          idx === 0
            ? primaryResolved?.priceCents ?? s.priceCents
            : resolvePrice(s).priceCents
        // Context-aware name for primary service
        const nameLabel = (() => {
          if (idx !== 0) return s.name
          if (s.pricingType === 'tiered') {
            const tier = (s.pricingTiers ?? []).find(
              (t) => selectedQuantity >= t.minQty && selectedQuantity <= t.maxQty
            )
            return tier
              ? `${s.name} (${selectedQuantity} × ${formatCents(tier.unitPriceCents)})`
              : s.name
          }
          if (s.pricingType === 'multi_option' && selectedOptionName) {
            return `${s.name} — ${selectedOptionName}`
          }
          if (s.pricingType === 'addon' && addonChecked && s.addonAmountCents) {
            return `${s.name} (+${formatCents(s.addonAmountCents)} add-on)`
          }
          return s.name
        })()
        return (
          <div key={s.id} className="flex justify-between text-stone-600">
            <span className="truncate pr-2">{nameLabel}</span>
            <span className="shrink-0">{formatCents(price)}</span>
          </div>
        )
      })}
      {selectedAddonServiceIds.map((id) => {
        const svc = services.find((s) => s.id === id)
        if (!svc) return null
        return (
          <div key={id} className="flex justify-between text-amber-700 text-xs">
            <span className="truncate pr-2">+ {svc.name}</span>
            <span className="shrink-0">+{formatCents(svc.addonAmountCents ?? svc.priceCents ?? 0)}</span>
          </div>
        )
      })}
      {/* Phase 12E — tip row (always visible when a service is picked) */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-stone-600 text-xs shrink-0">Tip</span>
          <div className="flex gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setTipType('percentage')}
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                tipType === 'percentage' ? 'bg-[#8B2E4A] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              %
            </button>
            <button
              type="button"
              onClick={() => setTipType('fixed')}
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                tipType === 'fixed' ? 'bg-[#8B2E4A] text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              $
            </button>
          </div>
          <input
            type="number"
            min={0}
            step={tipType === 'percentage' ? 1 : 0.01}
            inputMode={tipType === 'percentage' ? 'numeric' : 'decimal'}
            value={
              tipValue === ''
                ? ''
                : tipType === 'percentage'
                  ? tipNumeric
                  : (tipNumeric / 100).toFixed(2)
            }
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') { setTipValue(''); return }
              const n = Number(raw)
              if (!Number.isFinite(n) || n < 0) return
              setTipValue(tipType === 'percentage' ? Math.round(n) : Math.round(n * 100))
              setTipCleared(false)
            }}
            placeholder={tipType === 'percentage' ? '15' : '2.00'}
            className="w-16 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:bg-white focus:border-[#8B2E4A]"
          />
          {tipValue !== '' && tipNumeric > 0 && (
            <button
              type="button"
              onClick={() => { setTipValue(''); setTipCleared(true) }}
              className="text-stone-400 hover:text-stone-600 text-xs"
              aria-label="Clear tip"
            >
              ×
            </button>
          )}
        </div>
        <span className="shrink-0 text-stone-600 text-xs">
          {tipCentsPreview > 0 ? formatCents(tipCentsPreview) : '—'}
        </span>
      </div>
      <div className="flex justify-between font-semibold text-stone-900 border-t border-stone-200 pt-1.5 mt-1.5">
        <span>Total</span>
        <span>{formatCents(displayPriceCents + tipCentsPreview)}</span>
      </div>
      <div className="flex justify-between text-xs text-stone-500">
        <span>Duration</span>
        <span>{totalDurationMinutes} min</span>
      </div>
    </div>
  ) : null

  const submitDisabled =
    cancelling ||
    (mode === 'create' &&
      ((!!startTime &&
        selectedServiceIds.filter((id) => !!id).length > 0 &&
        (loadingStylists || (availableCount !== null && !pickedStylist)))))

  const handleSendReceipt = async () => {
    if (!booking || mode !== 'edit') return
    setSendingReceipt(true)
    try {
      const res = await fetch(`/api/bookings/${booking.id}/receipt`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof json.error === 'string' ? json.error : 'Failed to send receipt')
        return
      }
      const { emailSent, smsSent } = json.data ?? {}
      if (emailSent && smsSent) toast.success('Receipt sent via email + SMS')
      else if (emailSent) toast.success('Receipt sent via email')
      else if (smsSent) toast.success('Receipt sent via SMS')
      else toast('No contact info on file', 'info')
    } catch {
      toast.error('Network error')
    } finally {
      setSendingReceipt(false)
    }
  }

  const formFooter = (
    <div
      className="bg-white px-6 pt-4 border-t border-stone-100"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}
    >
      {breakdown}
      <div className="flex items-center justify-end gap-2 flex-wrap">
        {mode === 'edit' && isAdmin && (
          <Button
            variant="secondary"
            onClick={handleSendReceipt}
            loading={sendingReceipt}
            disabled={submitting || cancelling}
          >
            Send Receipt
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={submitting || cancelling}
        >
          Close
        </Button>
        <Button
          onClick={handleSubmit}
          loading={submitting}
          disabled={submitDisabled}
        >
          {mode === 'create' ? 'Book appointment' : 'Save changes'}
        </Button>
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <BottomSheet isOpen={open} onClose={onClose} title={formTitle} footer={formFooter}>
        {formFields}
      </BottomSheet>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title={formTitle} className="max-w-lg" data-tour="calendar-booking-modal">
      {formFields}
      <div className="sticky bottom-0 bg-white px-6 pb-6 border-t border-stone-100 pt-4">
        {breakdown}
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting || cancelling}>Close</Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={submitDisabled}>
            {mode === 'create' ? 'Book appointment' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
