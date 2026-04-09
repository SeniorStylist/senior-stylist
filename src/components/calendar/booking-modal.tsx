'use client'

import { useState, useEffect, useRef } from 'react'
import { Modal } from '@/components/ui/modal'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { formatCents } from '@/lib/utils'
import { resolvePrice, formatPricingLabel } from '@/lib/pricing'
import { useIsMobile } from '@/hooks/use-is-mobile'
import type { Resident, Stylist, Service } from '@/types'
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
  stylists: Stylist[]
  services: Service[]
  onBookingChange: (booking: BookingWithRelations) => void
  onBookingDeleted: (bookingId: string) => void
  isAdmin?: boolean
}

function formatDateTimeLocal(date: Date | string): string {
  const d = new Date(date)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function BookingModal({
  open,
  onClose,
  mode,
  booking,
  defaultStart,
  defaultEnd,
  residents,
  stylists,
  services,
  onBookingChange,
  onBookingDeleted,
  isAdmin,
}: BookingModalProps) {
  const [residentSearch, setResidentSearch] = useState('')
  const [residentDropdownOpen, setResidentDropdownOpen] = useState(false)
  const [selectedResidentId, setSelectedResidentId] = useState('')
  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [selectedStylistId, setSelectedStylistId] = useState('')
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

  const residentInputRef = useRef<HTMLInputElement>(null)

  const isMobile = useIsMobile()
  const { toast } = useToast()
  const selectedService = services.find((s) => s.id === selectedServiceId)

  const filteredResidents = residents.filter(
    (r) =>
      r.name.toLowerCase().includes(residentSearch.toLowerCase()) ||
      (r.roomNumber && r.roomNumber.toLowerCase().includes(residentSearch.toLowerCase()))
  )

  // Pre-fill form when modal opens
  useEffect(() => {
    if (!open) return

    if (mode === 'edit' && booking) {
      setSelectedResidentId(booking.residentId)
      setSelectedServiceId(booking.serviceId)
      setSelectedStylistId(booking.stylistId)
      setStartTime(formatDateTimeLocal(booking.startTime))
      setNotes(booking.notes ?? '')
      setResidentSearch(booking.resident?.name ?? '')
    } else {
      setSelectedResidentId('')
      setSelectedServiceId(services[0]?.id ?? '')
      setSelectedStylistId(stylists[0]?.id ?? '')
      setStartTime(defaultStart ? formatDateTimeLocal(defaultStart) : '')
      setNotes('')
      setResidentSearch('')
    }
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
    // Default recurring end date = 3 months from now
    const threeMonths = new Date()
    threeMonths.setMonth(threeMonths.getMonth() + 3)
    setRecurringEndDate(threeMonths.toISOString().split('T')[0])
  }, [open, mode, booking, defaultStart]) // eslint-disable-line react-hooks/exhaustive-deps

  // When resident changes, pre-select their default service
  useEffect(() => {
    if (mode !== 'create' || !selectedResidentId) return
    const resident = residents.find((r) => r.id === selectedResidentId)
    if (resident?.defaultServiceId) {
      setSelectedServiceId(resident.defaultServiceId)
    }
  }, [selectedResidentId, mode, residents])

  // Reset pricing inputs when service changes
  useEffect(() => {
    setAddonChecked(false)
    setSelectedQuantity(1)
    if (selectedService?.pricingType === 'multi_option' && selectedService.pricingOptions?.length) {
      setSelectedOptionName(selectedService.pricingOptions[0].name)
    } else {
      setSelectedOptionName('')
    }
  }, [selectedServiceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute resolved price for display
  const resolvedPrice = selectedService
    ? resolvePrice(selectedService, {
        quantity: selectedQuantity,
        selectedOption: selectedOptionName,
        includeAddon: addonChecked,
      })
    : null

  // Cmd+Enter to submit
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit()
    }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedResidentId, selectedServiceId, selectedStylistId, startTime, notes])

  const handleSubmit = async () => {
    if (!selectedResidentId || !selectedServiceId || !selectedStylistId || !startTime) {
      setError('Please fill in all required fields.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const isCreatingRecurring = mode === 'create' && isRecurring && isAdmin

      const pricingFields = {
        ...(selectedService?.pricingType === 'addon' ? { addonChecked } : {}),
        ...(selectedService?.pricingType === 'tiered' ? { selectedQuantity } : {}),
        ...(selectedService?.pricingType === 'multi_option' ? { selectedOption: selectedOptionName } : {}),
      }

      const payload = isCreatingRecurring
        ? {
            residentId: selectedResidentId,
            serviceId: selectedServiceId,
            stylistId: selectedStylistId,
            startTime: new Date(startTime).toISOString(),
            notes: notes || undefined,
            recurringRule,
            recurringEndDate,
            ...pricingFields,
          }
        : {
            residentId: selectedResidentId,
            serviceId: selectedServiceId,
            stylistId: selectedStylistId,
            startTime: new Date(startTime).toISOString(),
            notes: notes || undefined,
            ...pricingFields,
          }

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
        toast(`${json.data.count} recurring appointments booked!`, 'success')
        onClose()
        // Trigger a reload by passing a synthetic booking change signal
        // The caller will re-fetch bookings on next calendar navigation
      } else {
        onBookingChange(json.data)
        toast(mode === 'create' ? 'Appointment booked!' : 'Appointment updated', 'success')
        onClose()
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
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
        className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0D7377] transition-all"
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
          className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
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
      <div className="px-6 py-4 space-y-4">
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
            onBlur={() => setTimeout(() => setResidentDropdownOpen(false), 150)}
            placeholder="Search by name or room..."
            disabled={submitting}
            className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all duration-150 disabled:opacity-60"
          />
          {residentDropdownOpen && filteredResidents.length > 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-stone-200 rounded-xl shadow-lg z-50 max-h-44 overflow-y-auto">
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
            </div>
          )}
          {residentDropdownOpen && residentSearch && filteredResidents.length === 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-stone-200 rounded-xl shadow-lg z-50 px-3.5 py-3">
              <p className="text-sm text-stone-400">No residents found</p>
            </div>
          )}
        </div>

        {/* Service */}
        <Select
          label="Service *"
          value={selectedServiceId}
          onChange={(e) => setSelectedServiceId(e.target.value)}
          disabled={submitting}
        >
          <option value="">Select a service</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {formatPricingLabel(s)} · {s.durationMinutes}min
            </option>
          ))}
        </Select>

        {/* Pricing inputs — conditional on service type */}
        {selectedService?.pricingType === 'addon' && (
          <label className="flex items-center gap-2.5 bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 cursor-pointer hover:bg-stone-100 transition-colors">
            <input
              type="checkbox"
              checked={addonChecked}
              onChange={(e) => setAddonChecked(e.target.checked)}
              disabled={submitting}
              className="rounded accent-[#0D7377] w-4 h-4"
            />
            <span className="text-sm text-stone-700">
              Add-on (+{formatCents(selectedService.addonAmountCents ?? 0)})
            </span>
          </label>
        )}

        {selectedService?.pricingType === 'tiered' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              Quantity
            </label>
            <input
              type="number"
              value={selectedQuantity}
              onChange={(e) => setSelectedQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              min={1}
              max={selectedService.pricingTiers?.[selectedService.pricingTiers.length - 1]?.maxQty}
              disabled={submitting}
              className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all disabled:opacity-60"
            />
          </div>
        )}

        {selectedService?.pricingType === 'multi_option' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              Option
            </label>
            <select
              value={selectedOptionName}
              onChange={(e) => setSelectedOptionName(e.target.value)}
              disabled={submitting}
              className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all disabled:opacity-60"
            >
              {selectedService.pricingOptions?.map((opt) => (
                <option key={opt.name} value={opt.name}>
                  {opt.name} — {formatCents(opt.priceCents)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Price & Duration auto-fill */}
        {selectedService && (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Price
              </label>
              <div className="bg-teal-50 border border-teal-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-teal-800">
                {formatCents(resolvedPrice?.priceCents ?? selectedService.priceCents)}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Duration
              </label>
              <div className="bg-teal-50 border border-teal-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-teal-800">
                {selectedService.durationMinutes} min
              </div>
            </div>
          </div>
        )}

        {/* Stylist */}
        <Select
          label="Stylist *"
          value={selectedStylistId}
          onChange={(e) => setSelectedStylistId(e.target.value)}
          disabled={submitting}
        >
          <option value="">Select a stylist</option>
          {stylists.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>

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
            className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all duration-150 disabled:opacity-60"
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
            className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all duration-150 resize-none disabled:opacity-60"
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
                className="rounded border-stone-300 text-[#0D7377] focus:ring-[#0D7377]"
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
                    className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0D7377] transition-all"
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
                    className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
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

  // Action buttons — always visible footer, never scrolls
  const formFooter = (
    <div className="bg-white px-6 pb-4 pt-4 flex items-center justify-end gap-2 border-t border-stone-100">
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
        disabled={cancelling}
      >
        {mode === 'create' ? 'Book appointment' : 'Save changes'}
      </Button>
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
    <Modal open={open} onClose={onClose} title={formTitle} className="max-w-lg">
      {formFields}
      <div className="sticky bottom-0 bg-white px-6 pb-6 border-t border-stone-100 pt-4">
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting || cancelling}>Close</Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={cancelling}>
            {mode === 'create' ? 'Book appointment' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
