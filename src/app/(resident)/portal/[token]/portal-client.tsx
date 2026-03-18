'use client'

import { useState, useEffect } from 'react'
import { formatCents } from '@/lib/utils'

interface ServiceData {
  id: string
  name: string
  description: string | null
  priceCents: number
  durationMinutes: number
}

interface StylistData {
  id: string
  name: string
  color: string
}

interface BookingData {
  id: string
  startTime: string
  endTime: string
  status: string
  service: ServiceData
  stylist: StylistData
}

interface PortalData {
  resident: {
    id: string
    name: string
    roomNumber: string | null
    facilityId: string
  }
  upcomingBookings: BookingData[]
  pastBookings: BookingData[]
}

type BookingStep = 'service' | 'details' | 'confirm' | 'success'

interface PortalClientProps {
  token: string
  residentName: string
  roomNumber: string | null
}

function formatDateTime(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No show',
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-blue-50 text-blue-700',
  completed: 'bg-teal-50 text-teal-700',
  cancelled: 'bg-stone-100 text-stone-500',
  no_show: 'bg-amber-50 text-amber-700',
}

// Generate 30-min time slots 9am–8pm
function generateTimeSlots(dateStr: string): string[] {
  if (!dateStr) return []
  const slots: string[] = []
  for (let h = 9; h < 20; h++) {
    for (const m of [0, 30]) {
      const d = new Date(dateStr + 'T00:00:00')
      d.setHours(h, m, 0, 0)
      slots.push(d.toISOString())
    }
  }
  return slots
}

function formatSlotLabel(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function PortalClient({ token, residentName, roomNumber }: PortalClientProps) {
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPast, setShowPast] = useState(false)
  const [booking, setBooking] = useState(false)
  const [bookingStep, setBookingStep] = useState<BookingStep>('service')

  // Booking form state
  const [services, setServices] = useState<ServiceData[]>([])
  const [stylists, setStylists] = useState<StylistData[]>([])
  const [selectedService, setSelectedService] = useState<ServiceData | null>(null)
  const [selectedStylist, setSelectedStylist] = useState<StylistData | null>(null)
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)

  const loadPortalData = () => {
    setLoading(true)
    fetch(`/api/portal/${token}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setData(json.data)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadPortalData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const startBooking = async () => {
    setBooking(true)
    setBookingStep('service')
    setSelectedService(null)
    setSelectedStylist(null)
    setSelectedDate(todayStr())
    setSelectedTime(null)
    setBookError(null)

    const [svcRes, stlRes] = await Promise.all([
      fetch(`/api/portal/${token}/services`),
      fetch(`/api/portal/${token}/stylists`),
    ])
    const [svcJson, stlJson] = await Promise.all([svcRes.json(), stlRes.json()])
    if (svcJson.data) setServices(svcJson.data)
    if (stlJson.data) {
      setStylists(stlJson.data)
      if (stlJson.data.length === 1) setSelectedStylist(stlJson.data[0])
    }
  }

  const handleBook = async () => {
    if (!selectedService || !selectedStylist || !selectedTime) return
    setSubmitting(true)
    setBookError(null)
    try {
      const res = await fetch(`/api/portal/${token}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: selectedService.id,
          stylistId: selectedStylist.id,
          startTime: selectedTime,
        }),
      })
      if (res.ok) {
        setBookingStep('success')
        loadPortalData()
      } else {
        const json = await res.json()
        setBookError(json.error ?? 'Failed to book. Please try again.')
      }
    } catch {
      setBookError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const timeSlots = generateTimeSlots(selectedDate)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-2 border-[#0D7377] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-6 text-center">
        <p className="text-stone-400 text-sm">Failed to load portal data.</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
      {/* Resident header */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg"
            style={{ backgroundColor: '#0D7377' }}
          >
            {residentName.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-base font-bold text-stone-900">{residentName}</p>
            {roomNumber && <p className="text-sm text-stone-500">Room {roomNumber}</p>}
          </div>
        </div>
      </div>

      {/* Book button */}
      {!booking && (
        <button
          onClick={startBooking}
          className="w-full py-3.5 rounded-2xl text-white font-semibold text-sm transition-all active:scale-95"
          style={{ backgroundColor: '#0D7377' }}
        >
          Book Appointment
        </button>
      )}

      {/* Booking flow */}
      {booking && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          {/* Step header */}
          <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-stone-900">
              {bookingStep === 'service' && 'Choose a Service'}
              {bookingStep === 'details' && 'Pick Date & Time'}
              {bookingStep === 'confirm' && 'Confirm Booking'}
              {bookingStep === 'success' && 'Booking Confirmed!'}
            </p>
            {bookingStep !== 'success' && (
              <button
                onClick={() => setBooking(false)}
                className="text-xs text-stone-400 hover:text-stone-600"
              >
                Cancel
              </button>
            )}
          </div>

          <div className="p-5">
            {/* Step 1: Service */}
            {bookingStep === 'service' && (
              <div className="grid grid-cols-1 gap-3">
                {services.map((svc) => (
                  <button
                    key={svc.id}
                    onClick={() => {
                      setSelectedService(svc)
                      setBookingStep('details')
                    }}
                    className="text-left p-4 rounded-xl border-2 border-stone-100 hover:border-[#0D7377] transition-all"
                  >
                    <p className="text-sm font-semibold text-stone-900">{svc.name}</p>
                    <p className="text-xs text-stone-500 mt-1">
                      {formatCents(svc.priceCents)} · {svc.durationMinutes} min
                    </p>
                    {svc.description && (
                      <p className="text-xs text-stone-400 mt-1">{svc.description}</p>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Step 2: Stylist + Date + Time */}
            {bookingStep === 'details' && (
              <div className="space-y-4">
                {/* Selected service summary */}
                <div className="bg-teal-50 rounded-xl p-3 text-sm text-teal-800 font-medium">
                  {selectedService?.name} — {formatCents(selectedService?.priceCents ?? 0)}
                </div>

                {/* Stylist picker (if multiple) */}
                {stylists.length > 1 && (
                  <div>
                    <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Stylist</p>
                    <div className="grid grid-cols-2 gap-2">
                      {stylists.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setSelectedStylist(s)}
                          className={`p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                            selectedStylist?.id === s.id
                              ? 'border-[#0D7377] bg-teal-50 text-teal-800'
                              : 'border-stone-100 text-stone-700 hover:border-stone-200'
                          }`}
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {stylists.length === 1 && selectedStylist && (
                  <div className="bg-stone-50 rounded-xl p-3 text-sm text-stone-600">
                    Stylist: <span className="font-semibold">{selectedStylist.name}</span>
                  </div>
                )}

                {/* Date picker */}
                <div>
                  <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Date</p>
                  <input
                    type="date"
                    value={selectedDate}
                    min={todayStr()}
                    onChange={(e) => { setSelectedDate(e.target.value); setSelectedTime(null) }}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
                  />
                </div>

                {/* Time slots */}
                {selectedDate && (
                  <div>
                    <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Time</p>
                    <div className="grid grid-cols-4 gap-2">
                      {timeSlots.map((slot) => (
                        <button
                          key={slot}
                          onClick={() => setSelectedTime(slot)}
                          className={`py-2 rounded-xl text-xs font-medium transition-all ${
                            selectedTime === slot
                              ? 'bg-[#0D7377] text-white'
                              : 'bg-stone-50 text-stone-600 hover:bg-stone-100'
                          }`}
                        >
                          {formatSlotLabel(slot)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setBookingStep('service')}
                    className="flex-1 py-3 rounded-xl border border-stone-200 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-all"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => {
                      if (!selectedStylist || !selectedTime) return
                      setBookingStep('confirm')
                    }}
                    disabled={!selectedStylist || !selectedTime}
                    className="flex-1 py-3 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-40"
                    style={{ backgroundColor: '#0D7377' }}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Confirm */}
            {bookingStep === 'confirm' && selectedService && selectedStylist && selectedTime && (
              <div className="space-y-4">
                <div className="bg-stone-50 rounded-xl p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-stone-500">Service</span>
                    <span className="font-medium text-stone-900">{selectedService.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Stylist</span>
                    <span className="font-medium text-stone-900">{selectedStylist.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Date</span>
                    <span className="font-medium text-stone-900">{formatDate(selectedTime)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Time</span>
                    <span className="font-medium text-stone-900">{formatTime(selectedTime)}</span>
                  </div>
                  <div className="flex justify-between border-t border-stone-200 pt-2 mt-2">
                    <span className="text-stone-500">Price</span>
                    <span className="font-bold text-stone-900">{formatCents(selectedService.priceCents)}</span>
                  </div>
                </div>

                {bookError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">
                    {bookError}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => setBookingStep('details')}
                    disabled={submitting}
                    className="flex-1 py-3 rounded-xl border border-stone-200 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-all disabled:opacity-40"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleBook}
                    disabled={submitting}
                    className="flex-1 py-3 rounded-xl text-white text-sm font-semibold transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                    style={{ backgroundColor: '#0D7377' }}
                  >
                    {submitting ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : 'Book Appointment'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Success */}
            {bookingStep === 'success' && (
              <div className="text-center py-4 space-y-3">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
                  style={{ backgroundColor: '#0D7377' }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p className="text-base font-bold text-stone-900">Appointment Booked!</p>
                <p className="text-sm text-stone-500">
                  Your {selectedService?.name} appointment with {selectedStylist?.name} on {selectedTime ? formatDateTime(selectedTime) : ''} has been scheduled.
                </p>
                <button
                  onClick={() => setBooking(false)}
                  className="mt-2 px-6 py-2.5 rounded-xl text-white text-sm font-medium"
                  style={{ backgroundColor: '#0D7377' }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Upcoming appointments */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm">
        <div className="px-5 py-4 border-b border-stone-100">
          <p className="text-sm font-semibold text-stone-900">Upcoming Appointments</p>
        </div>
        {data.upcomingBookings.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-stone-400">No upcoming appointments</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-50">
            {data.upcomingBookings.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="shrink-0 w-10 text-center">
                  <p className="text-xs font-medium text-stone-400 uppercase leading-none">
                    {new Date(b.startTime).toLocaleDateString('en-US', { month: 'short' })}
                  </p>
                  <p className="text-xl font-bold text-stone-900 leading-tight">
                    {new Date(b.startTime).getDate()}
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-stone-900">{b.service.name}</p>
                  <p className="text-xs text-stone-500">
                    {b.stylist.name} · {formatTime(b.startTime)}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[b.status] ?? 'bg-stone-100 text-stone-500'}`}>
                  {STATUS_LABELS[b.status] ?? b.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Past appointments */}
      {data.pastBookings.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm">
          <button
            onClick={() => setShowPast((v) => !v)}
            className="w-full px-5 py-4 flex items-center justify-between"
          >
            <p className="text-sm font-semibold text-stone-900">Past Appointments</p>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`text-stone-400 transition-transform ${showPast ? 'rotate-180' : ''}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showPast && (
            <div className="divide-y divide-stone-50 border-t border-stone-100">
              {data.pastBookings.map((b) => (
                <div key={b.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="shrink-0 w-10 text-center">
                    <p className="text-xs font-medium text-stone-400 uppercase leading-none">
                      {new Date(b.startTime).toLocaleDateString('en-US', { month: 'short' })}
                    </p>
                    <p className="text-xl font-bold text-stone-900 leading-tight">
                      {new Date(b.startTime).getDate()}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-stone-900">{b.service.name}</p>
                    <p className="text-xs text-stone-500">
                      {b.stylist.name} · {formatTime(b.startTime)}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[b.status] ?? 'bg-stone-100 text-stone-500'}`}>
                    {STATUS_LABELS[b.status] ?? b.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
