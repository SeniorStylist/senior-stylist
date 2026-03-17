'use client'

import { useState, useMemo, forwardRef, useImperativeHandle } from 'react'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Avatar } from '@/components/ui/avatar'
import { cn, formatCents } from '@/lib/utils'
import type { Resident, Service, Stylist } from '@/types'
import type { BookingWithRelations } from '@/app/(protected)/dashboard/dashboard-client'

export interface QuickBookFABHandle {
  openWithSlot: (slot: { date: string; time: string }) => void
}

interface QuickBookFABProps {
  residents: Resident[]
  services: Service[]
  stylists: Stylist[]
  onBookingCreated: (booking: BookingWithRelations) => void
}

function formatSlot(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const ampm = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 || 12
  return `${hour}:${m === 0 ? '00' : m} ${ampm}`
}

const TIME_SLOTS = (() => {
  const slots: string[] = []
  for (let h = 9; h < 21; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`)
    slots.push(`${String(h).padStart(2, '0')}:30`)
  }
  return slots
})()

export const QuickBookFAB = forwardRef<QuickBookFABHandle, QuickBookFABProps>(
function QuickBookFAB({
  residents,
  services,
  stylists,
  onBookingCreated,
}: QuickBookFABProps, ref) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(1)

  const [selectedResident, setSelectedResident] = useState<Resident | null>(null)
  const [selectedService, setSelectedService] = useState<Service | null>(null)
  const [selectedStylist, setSelectedStylist] = useState<Stylist | null>(null)
  const [selectedDate, setSelectedDate] = useState(
    () => new Date().toISOString().split('T')[0]
  )
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bounce, setBounce] = useState(false)

  useImperativeHandle(ref, () => ({
    openWithSlot: ({ date, time }) => {
      setStep(1)
      setSelectedResident(null)
      setSelectedService(null)
      setSelectedStylist(stylists.length === 1 ? stylists[0] : null)
      setSelectedDate(date)
      setSelectedTime(time)
      setSearch('')
      setError(null)
      setOpen(true)
    },
  }))

  const reset = () => {
    setStep(1)
    setSelectedResident(null)
    setSelectedService(null)
    setSelectedStylist(null)
    setSelectedDate(new Date().toISOString().split('T')[0])
    setSelectedTime(null)
    setSearch('')
    setError(null)
  }

  const handleOpen = () => {
    reset()
    // Auto-select stylist if only one
    if (stylists.length === 1) setSelectedStylist(stylists[0])
    setOpen(true)
  }

  const handleClose = () => {
    setOpen(false)
    setTimeout(reset, 350)
  }

  const filteredResidents = useMemo(
    () =>
      residents.filter(
        (r) =>
          r.name.toLowerCase().includes(search.toLowerCase()) ||
          (r.roomNumber && r.roomNumber.toLowerCase().includes(search.toLowerCase()))
      ),
    [residents, search]
  )

  const handleSubmit = async () => {
    if (!selectedResident || !selectedService || !selectedStylist || !selectedDate || !selectedTime) {
      setError('Please complete all fields.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const startTime = new Date(`${selectedDate}T${selectedTime}:00`)
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          residentId: selectedResident.id,
          serviceId: selectedService.id,
          stylistId: selectedStylist.id,
          startTime: startTime.toISOString(),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(
          res.status === 409
            ? 'That time slot is taken — pick another.'
            : json.error ?? 'Failed to create booking.'
        )
        return
      }
      handleClose()
      setBounce(true)
      setTimeout(() => setBounce(false), 700)
      onBookingCreated(json.data)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const stepTitles = ['Who is this for?', 'Pick a service', 'Date & time']

  return (
    <>
      {/* FAB — mobile only */}
      <button
        onClick={handleOpen}
        aria-label="Quick book appointment"
        className={cn(
          'md:hidden fixed bottom-24 right-5 w-14 h-14 rounded-full bg-[#0D7377] text-white',
          'shadow-lg flex items-center justify-center active:scale-95 transition-transform z-30',
          bounce && 'animate-fab-bounce'
        )}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <BottomSheet
        isOpen={open}
        onClose={handleClose}
        title={stepTitles[step - 1]}
      >
        {/* Step indicator */}
        <div className="flex items-center gap-1.5 px-5 py-3 border-b border-stone-100">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-200',
                s <= step ? 'bg-[#0D7377]' : 'bg-stone-200'
              )}
            />
          ))}
        </div>

        {/* ── Step 1: Resident ── */}
        {step === 1 && (
          <div className="flex flex-col h-full">
            <div className="px-4 pt-4 pb-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or room..."
                autoFocus
                className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-sm placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
              />
            </div>
            <div className="overflow-y-auto pb-6">
              {filteredResidents.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-stone-400">
                  {search ? 'No residents found' : 'No residents yet'}
                </div>
              ) : (
                filteredResidents.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      setSelectedResident(r)
                      setStep(2)
                    }}
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-stone-50 active:bg-stone-100 transition-colors border-b border-stone-50 last:border-0 text-left"
                  >
                    <Avatar name={r.name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-900 truncate">{r.name}</p>
                      {r.roomNumber && (
                        <p className="text-xs text-stone-400">Room {r.roomNumber}</p>
                      )}
                    </div>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-stone-300 shrink-0"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Service ── */}
        {step === 2 && (
          <div className="pb-6">
            <div className="px-5 py-3 bg-stone-50 border-b border-stone-100">
              <p className="text-xs text-stone-500">
                For <span className="font-semibold text-stone-700">{selectedResident?.name}</span>
              </p>
            </div>
            {services.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedService(s)
                  setStep(3)
                }}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-stone-50 active:bg-stone-100 transition-colors border-b border-stone-50 last:border-0 text-left"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: s.color ?? '#0D7377' }}
                  />
                  <div>
                    <p className="text-sm font-medium text-stone-900">{s.name}</p>
                    <p className="text-xs text-stone-400">{s.durationMinutes} min</p>
                  </div>
                </div>
                <p className="text-sm font-bold text-stone-700">{formatCents(s.priceCents)}</p>
              </button>
            ))}
            <button
              onClick={() => setStep(1)}
              className="w-full py-3.5 text-sm text-stone-400 hover:text-stone-600 transition-colors"
            >
              ← Back
            </button>
          </div>
        )}

        {/* ── Step 3: Stylist + Date + Time ── */}
        {step === 3 && (
          <div className="pb-8">
            <div className="px-5 py-3 bg-stone-50 border-b border-stone-100">
              <p className="text-xs text-stone-500">
                <span className="font-semibold text-stone-700">{selectedResident?.name}</span>
                {' · '}
                <span className="font-semibold text-stone-700">{selectedService?.name}</span>
              </p>
            </div>

            {/* Stylist row (hidden if only one) */}
            {stylists.length > 1 && (
              <div className="px-5 pt-4 pb-2">
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
                  Stylist
                </p>
                <div className="flex gap-2 flex-wrap">
                  {stylists.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedStylist(s)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all',
                        selectedStylist?.id === s.id
                          ? 'bg-[#0D7377] text-white border-[#0D7377]'
                          : 'bg-white text-stone-700 border-stone-200 hover:border-stone-300'
                      )}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: s.color }}
                      />
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Date */}
            <div className="px-5 pt-4 pb-2">
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
                Date
              </p>
              <input
                type="date"
                value={selectedDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => {
                  setSelectedDate(e.target.value)
                  setSelectedTime(null)
                }}
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
              />
            </div>

            {/* Time slots */}
            <div className="px-5 pt-4 pb-2">
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">
                Time
              </p>
              <div className="grid grid-cols-4 gap-2">
                {TIME_SLOTS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setSelectedTime(t)}
                    className={cn(
                      'py-2.5 rounded-xl text-xs font-medium border transition-all',
                      selectedTime === t
                        ? 'bg-[#0D7377] text-white border-[#0D7377]'
                        : 'bg-white text-stone-700 border-stone-200 hover:border-stone-300 active:bg-stone-50'
                    )}
                  >
                    {formatSlot(t)}
                  </button>
                ))}
              </div>
            </div>

            {/* Sticky confirm area */}
            <div className="sticky bottom-0 bg-white px-5 pt-3 pb-6 space-y-1">
              {error && (
                <div className="mb-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              <button
                onClick={handleSubmit}
                disabled={submitting || !selectedTime || (stylists.length > 1 && !selectedStylist)}
                className="w-full py-4 rounded-2xl bg-[#0D7377] text-white font-semibold text-base disabled:opacity-50 active:scale-[0.98] transition-all shadow-sm"
              >
                {submitting ? 'Booking…' : 'Book appointment'}
              </button>
              <button
                onClick={() => setStep(2)}
                className="w-full py-3 text-sm text-stone-400 hover:text-stone-600 transition-colors"
              >
                ← Back
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  )
})
