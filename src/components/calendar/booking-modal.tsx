'use client'

import { useState, useEffect, useRef } from 'react'
import { Modal } from '@/components/ui/modal'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { formatCents } from '@/lib/utils'
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
  }, [open, mode, booking, defaultStart]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const payload = {
        residentId: selectedResidentId,
        serviceId: selectedServiceId,
        stylistId: selectedStylistId,
        startTime: new Date(startTime).toISOString(),
        notes: notes || undefined,
      }

      const url = mode === 'create' ? '/api/bookings' : `/api/bookings/${booking!.id}`
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

      onBookingChange(json.data)
      toast(mode === 'create' ? 'Appointment booked!' : 'Appointment updated', 'success')
      onClose()
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
        const json = await res.json()
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

  // Scrollable form fields — used as children in both sheet and modal
  const formFields = (
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
            {s.name} — {formatCents(s.priceCents)} · {s.durationMinutes}min
          </option>
        ))}
      </Select>

      {/* Price & Duration auto-fill */}
      {selectedService && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              Price
            </label>
            <div className="bg-teal-50 border border-teal-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-teal-800">
              {formatCents(selectedService.priceCents)}
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
    </div>
  )

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

  // Action buttons — rendered outside scroll area on mobile, sticky on desktop
  const formFooter = (
    <div className="bg-white px-6 pb-4 pt-4 flex flex-col gap-3 border-t border-stone-100">
      {mode === 'edit' && confirmCancel && (
        <div className="space-y-2">
          {cancelReasonSelect}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        {/* Left side — cancel booking (edit mode only) */}
        <div className="flex items-center gap-2">
          {mode === 'edit' && !confirmCancel && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmCancel(true)}
              disabled={submitting || cancelling}
            >
              Cancel appointment
            </Button>
          )}
          {mode === 'edit' && confirmCancel && (
            <>
              <span className="text-xs font-medium text-red-600">Are you sure?</span>
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
            </>
          )}
        </div>

        {/* Right side — close + save */}
        <div className="flex items-center gap-2">
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
    <Modal open={open} onClose={onClose} title={formTitle} className="max-w-lg">
      {formFields}
      <div className="sticky bottom-0 bg-white px-6 pb-6 border-t border-stone-100 pt-4 space-y-3">
        {mode === 'edit' && confirmCancel && (
          <div>{cancelReasonSelect}</div>
        )}
        <div className="flex items-center justify-between gap-3">
          {/* Left side */}
          <div className="flex items-center gap-2">
            {mode === 'edit' && !confirmCancel && (
              <Button variant="danger" size="sm" onClick={() => setConfirmCancel(true)} disabled={submitting || cancelling}>
                Cancel appointment
              </Button>
            )}
            {mode === 'edit' && confirmCancel && (
              <>
                <span className="text-xs font-medium text-red-600">Are you sure?</span>
                <Button variant="danger" size="sm" loading={cancelling} onClick={handleCancelBooking} disabled={submitting}>Yes, cancel</Button>
                <Button variant="ghost" size="sm" onClick={() => { setConfirmCancel(false); setCancelReason(''); setCancelReasonOther('') }} disabled={cancelling}>No</Button>
              </>
            )}
          </div>
          {/* Right side */}
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={submitting || cancelling}>Close</Button>
            <Button onClick={handleSubmit} loading={submitting} disabled={cancelling}>
              {mode === 'create' ? 'Book appointment' : 'Save changes'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
