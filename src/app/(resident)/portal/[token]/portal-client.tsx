'use client'

import { useState, useEffect } from 'react'
import { formatCents } from '@/lib/utils'
import { formatPricingLabel, resolvePrice } from '@/lib/pricing'
import type { PricingTier, PricingOption } from '@/types'

interface ServiceData {
  id: string
  name: string
  description: string | null
  priceCents: number
  durationMinutes: number
  pricingType: string
  addonAmountCents: number | null
  pricingTiers: PricingTier[] | null
  pricingOptions: PricingOption[] | null
  category: string | null
  color: string | null
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
    paymentType?: string
  }
  upcomingBookings: BookingData[]
  pastBookings: BookingData[]
  facilityPaymentType?: string
}

type BookingStep = 'service' | 'details' | 'confirm' | 'success' | 'payment'

interface PortalClientProps {
  token: string
  residentName: string
  roomNumber: string | null
  poaName?: string | null
  poaEmail?: string | null
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

function groupByCategory<T extends { category?: string | null }>(items: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = item.category?.trim() || 'Other'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === 'Other') return 1
    if (b === 'Other') return -1
    return a.localeCompare(b)
  })
}

export function PortalClient({ token, residentName, roomNumber, poaName, poaEmail }: PortalClientProps) {
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPast, setShowPast] = useState(false)
  const [booking, setBooking] = useState(false)
  const [bookingStep, setBookingStep] = useState<BookingStep>('service')

  // Booking form state
  const [services, setServices] = useState<ServiceData[]>([])
  const [stylists, setStylists] = useState<StylistData[]>([])
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [selectedAddonServiceIds, setSelectedAddonServiceIds] = useState<string[]>([])
  const [selectedQuantity, setSelectedQuantity] = useState(1)
  const [selectedOptionName, setSelectedOptionName] = useState('')
  const [selectedStylist, setSelectedStylist] = useState<StylistData | null>(null)
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)
  const [takenSlots, setTakenSlots] = useState<string[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [lastBookingId, setLastBookingId] = useState<string | null>(null)
  const [checkingOut, setCheckingOut] = useState(false)

  // Derived values
  const nonAddonServices = services.filter(s => s.pricingType !== 'addon')
  const primaryService = services.find(s => s.id === selectedServiceIds[0]) ?? null
  // backward-compat alias used in success/payment steps
  const selectedService = primaryService

  const addonServices = services.filter(s => s.pricingType === 'addon' && !selectedServiceIds.includes(s.id))

  const primaryResolved = primaryService
    ? resolvePrice(primaryService, { quantity: selectedQuantity, selectedOption: selectedOptionName || undefined })
    : null

  const addonTotal = selectedAddonServiceIds.reduce((sum, id) => {
    const svc = services.find(s => s.id === id)
    return sum + (svc ? (svc.addonAmountCents ?? svc.priceCents ?? 0) : 0)
  }, 0)

  const additionalPrimariesTotal = selectedServiceIds.slice(1).reduce((sum, id) => {
    const svc = services.find(s => s.id === id)
    return sum + (svc ? resolvePrice(svc).priceCents : 0)
  }, 0)

  const totalPriceCents = (primaryResolved?.priceCents ?? 0) + addonTotal + additionalPrimariesTotal

  const totalDurationMinutes = selectedServiceIds.reduce((sum, id) => {
    const svc = services.find(s => s.id === id)
    return sum + (svc?.durationMinutes ?? 0)
  }, 0)

  // Service picker helpers
  const setServiceAt = (idx: number, id: string) => {
    setSelectedServiceIds(prev => {
      const next = [...prev]
      next[idx] = id
      return next
    })
    if (idx === 0) {
      setSelectedQuantity(1)
      setSelectedOptionName('')
      setSelectedAddonServiceIds([])
    }
  }

  const removeServiceAt = (idx: number) => {
    setSelectedServiceIds(prev => prev.filter((_, i) => i !== idx))
  }

  const loadPortalData = () => {
    setLoading(true)
    fetch(`/api/portal/${token}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setData(json.data)
      })
      .finally(() => setLoading(false))
  }

  const facilityPaymentType = data?.facilityPaymentType ?? 'facility'

  useEffect(() => {
    loadPortalData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const fetchTakenSlots = async (date: string) => {
    setLoadingSlots(true)
    try {
      const res = await fetch(`/api/portal/${token}/available-times?date=${date}`)
      const json = await res.json()
      if (json.takenSlots) setTakenSlots(json.takenSlots)
      else setTakenSlots([])
    } catch {
      setTakenSlots([])
    } finally {
      setLoadingSlots(false)
    }
  }

  const startBooking = async () => {
    setBooking(true)
    setBookingStep('service')
    setSelectedServiceIds([])
    setSelectedAddonServiceIds([])
    setSelectedQuantity(1)
    setSelectedOptionName('')
    setSelectedStylist(null)
    const today = todayStr()
    setSelectedDate(today)
    setSelectedTime(null)
    setBookError(null)
    setTakenSlots([])

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

    fetchTakenSlots(today)
  }

  const handleBook = async () => {
    if (selectedServiceIds.length === 0 || !selectedStylist || !selectedTime) return
    setSubmitting(true)
    setBookError(null)
    try {
      const res = await fetch(`/api/portal/${token}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceIds: selectedServiceIds,
          stylistId: selectedStylist.id,
          startTime: selectedTime,
          addonServiceIds: selectedAddonServiceIds,
          ...(primaryService?.pricingType === 'tiered' ? { selectedQuantity } : {}),
          ...(primaryService?.pricingType === 'multi_option' ? { selectedOption: selectedOptionName } : {}),
        }),
      })
      if (res.ok) {
        const json = await res.json()
        setLastBookingId(json.data?.id ?? null)
        const paymentType = data?.facilityPaymentType
        if (paymentType === 'ip' || paymentType === 'hybrid') {
          setBookingStep('payment')
        } else {
          setBookingStep('success')
        }
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

  const handleCheckout = async () => {
    if (!lastBookingId || !selectedService) return
    setCheckingOut(true)
    try {
      const res = await fetch(`/api/portal/${token}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: lastBookingId, serviceId: selectedService.id }),
      })
      const json = await res.json()
      if (json.url) {
        window.location.href = json.url
      } else {
        setBookingStep('success')
      }
    } catch {
      setBookingStep('success')
    } finally {
      setCheckingOut(false)
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

      {/* POA banner */}
      {poaName && (
        <div className="bg-teal-50 border border-teal-100 rounded-xl px-4 py-2.5 text-sm text-teal-800">
          Booking on behalf of <strong>{residentName}</strong>
          {poaEmail && <span className="text-teal-600 ml-1">({poaEmail})</span>}
        </div>
      )}

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
              {bookingStep === 'payment' && 'Complete Payment'}
              {bookingStep === 'success' && 'Booking Confirmed!'}
            </p>
            {bookingStep !== 'success' && bookingStep !== 'payment' && (
              <button
                onClick={() => setBooking(false)}
                className="text-xs text-stone-400 hover:text-stone-600"
              >
                Cancel
              </button>
            )}
          </div>

          <div className="p-5">
            {/* Step 1: Service picker */}
            {bookingStep === 'service' && (
              <div className="space-y-4">
                {/* Service slot rows — starts empty, user picks first slot */}
                {selectedServiceIds.length === 0 ? (
                  /* Initial unselected state — show all non-addon services */
                  (() => {
                    const groups = groupByCategory(nonAddonServices)
                    return (
                      <div className="space-y-4">
                        {(groups.length <= 1 ? [['', nonAddonServices] as [string, ServiceData[]]] : groups).map(([category, list]) => (
                          <div key={category || 'all'} className="space-y-2">
                            {groups.length > 1 && category && (
                              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">{category}</p>
                            )}
                            {list.map(svc => (
                              <button
                                key={svc.id}
                                onClick={() => setServiceAt(0, svc.id)}
                                className="w-full text-left p-4 rounded-xl border-2 border-stone-200 bg-white hover:border-stone-300 transition-all flex items-start gap-3"
                              >
                                {svc.color && (
                                  <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: svc.color }} />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-stone-900">{svc.name}</p>
                                  <p className="text-xs text-stone-500 mt-0.5">
                                    {formatPricingLabel(svc)} · {svc.durationMinutes} min
                                  </p>
                                  {svc.description && (
                                    <p className="text-xs text-stone-400 mt-1 line-clamp-2">{svc.description}</p>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )
                  })()
                ) : (
                  /* After first selection — show selected + allow additional */
                  <div className="space-y-4">
                    {selectedServiceIds.map((svcId, idx) => {
                      const availableForSlot = nonAddonServices.filter(s => s.id === svcId || !selectedServiceIds.includes(s.id))
                      const groups = groupByCategory(availableForSlot)
                      return (
                        <div key={idx} className="space-y-2">
                          {idx > 0 && (
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Additional Service</p>
                              <button
                                onClick={() => removeServiceAt(idx)}
                                className="text-xs text-red-500 hover:text-red-700 transition-colors"
                              >
                                Remove
                              </button>
                            </div>
                          )}
                          <div className="space-y-4">
                            {(groups.length <= 1 ? [['', availableForSlot] as [string, ServiceData[]]] : groups).map(([category, list]) => (
                              <div key={category || 'all'} className="space-y-2">
                                {groups.length > 1 && category && (
                                  <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">{category}</p>
                                )}
                                {list.map(svc => (
                                  <button
                                    key={svc.id}
                                    onClick={() => setServiceAt(idx, svc.id)}
                                    className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-start gap-3 ${
                                      svcId === svc.id
                                        ? 'border-[#0D7377] bg-teal-50'
                                        : 'border-stone-200 bg-white hover:border-stone-300'
                                    }`}
                                  >
                                    {svc.color && (
                                      <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: svc.color }} />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-semibold text-stone-900">{svc.name}</p>
                                      <p className="text-xs text-stone-500 mt-0.5">
                                        {formatPricingLabel(svc)} · {svc.durationMinutes} min
                                      </p>
                                      {svc.description && (
                                        <p className="text-xs text-stone-400 mt-1 line-clamp-2">{svc.description}</p>
                                      )}
                                    </div>
                                    {svcId === svc.id && (
                                      <svg className="shrink-0 mt-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0D7377" strokeWidth="2.5">
                                        <polyline points="20 6 9 17 4 12" />
                                      </svg>
                                    )}
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Tiered stepper — primary service only */}
                {primaryService?.pricingType === 'tiered' && (() => {
                  const tiers = primaryService.pricingTiers ?? []
                  const activeTier = tiers.find(t => selectedQuantity >= t.minQty && selectedQuantity <= t.maxQty)
                  return (
                    <div className="bg-stone-50 rounded-xl px-4 py-3 space-y-2">
                      <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">How many?</p>
                      <div className="flex items-center rounded-xl border border-stone-200 overflow-hidden bg-white w-fit">
                        <button
                          onClick={() => setSelectedQuantity(q => Math.max(1, q - 1))}
                          disabled={selectedQuantity <= 1}
                          className="h-11 w-11 flex items-center justify-center text-stone-600 hover:bg-stone-100 disabled:opacity-40 text-lg font-medium border-r border-stone-200"
                        >
                          −
                        </button>
                        <span className="w-14 text-center text-base font-semibold text-stone-900 select-none">
                          {selectedQuantity}
                        </span>
                        <button
                          onClick={() => setSelectedQuantity(q => q + 1)}
                          className="h-11 w-11 flex items-center justify-center text-white bg-[#0D7377] hover:bg-[#0a5f63] text-lg font-medium border-l border-stone-200"
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

                {/* Multi-option pills/select — primary service only */}
                {primaryService?.pricingType === 'multi_option' && (() => {
                  const opts = primaryService.pricingOptions ?? []
                  return (
                    <div className="bg-stone-50 rounded-xl px-4 py-3 space-y-2">
                      <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Option</p>
                      {opts.length <= 3 ? (
                        <div className="flex flex-wrap gap-2">
                          {opts.map(opt => (
                            <button
                              key={opt.name}
                              onClick={() => setSelectedOptionName(opt.name)}
                              className={`px-3 py-2 rounded-xl text-sm font-medium transition-all min-h-[44px] ${
                                selectedOptionName === opt.name
                                  ? 'bg-[#0D7377] text-white'
                                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                              }`}
                            >
                              {opt.name} — {formatCents(opt.priceCents)}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <select
                          value={selectedOptionName}
                          onChange={e => setSelectedOptionName(e.target.value)}
                          className="w-full bg-white border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all min-h-[44px]"
                        >
                          <option value="">Select an option</option>
                          {opts.map(opt => (
                            <option key={opt.name} value={opt.name}>
                              {opt.name} — {formatCents(opt.priceCents)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )
                })()}

                {/* Add-on checklist */}
                {primaryService && addonServices.length > 0 && (
                  <div className="space-y-2">
                    <div className="relative flex items-center">
                      <div className="flex-grow border-t border-stone-200" />
                      <span className="shrink-0 mx-3 px-2 py-0.5 rounded-full bg-stone-100 text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                        Add-ons (optional)
                      </span>
                      <div className="flex-grow border-t border-stone-200" />
                    </div>
                    {(() => {
                      const renderAddon = (svc: ServiceData) => (
                        <label
                          key={svc.id}
                          className="flex items-center gap-3 bg-white border border-stone-200 rounded-xl px-3 py-3 cursor-pointer hover:bg-stone-50 transition-colors min-h-[44px] w-full"
                        >
                          <input
                            type="checkbox"
                            checked={selectedAddonServiceIds.includes(svc.id)}
                            onChange={() => setSelectedAddonServiceIds(prev =>
                              prev.includes(svc.id) ? prev.filter(id => id !== svc.id) : [...prev, svc.id]
                            )}
                            className="rounded accent-[#0D7377] h-5 w-5 shrink-0"
                          />
                          <span className="text-sm font-medium text-stone-800 flex-1 truncate">{svc.name}</span>
                          <span className="text-sm text-stone-500 shrink-0">
                            +{formatCents(svc.addonAmountCents ?? svc.priceCents ?? 0)}
                          </span>
                        </label>
                      )
                      const groups = groupByCategory(addonServices)
                      if (groups.length <= 1) return <div className="space-y-2">{addonServices.map(renderAddon)}</div>
                      return (
                        <div className="space-y-3">
                          {groups.map(([cat, list]) => (
                            <div key={cat} className="space-y-2">
                              <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">{cat}</p>
                              {list.map(renderAddon)}
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* Live price breakdown */}
                {primaryService && (
                  <div className="bg-stone-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
                    {selectedServiceIds.map((id, idx) => {
                      const svc = services.find(s => s.id === id)
                      if (!svc) return null
                      const price = idx === 0
                        ? (primaryResolved?.priceCents ?? svc.priceCents)
                        : resolvePrice(svc).priceCents
                      const label = (() => {
                        if (idx !== 0) return svc.name
                        if (svc.pricingType === 'tiered') {
                          const tier = (svc.pricingTiers ?? []).find(t => selectedQuantity >= t.minQty && selectedQuantity <= t.maxQty)
                          return tier ? `${svc.name} (${selectedQuantity} × ${formatCents(tier.unitPriceCents)})` : svc.name
                        }
                        if (svc.pricingType === 'multi_option' && selectedOptionName) return `${svc.name} — ${selectedOptionName}`
                        return svc.name
                      })()
                      return (
                        <div key={id} className="flex justify-between text-stone-600">
                          <span className="truncate pr-2">{label}</span>
                          <span className="shrink-0">{formatCents(price)}</span>
                        </div>
                      )
                    })}
                    {selectedAddonServiceIds.map(id => {
                      const svc = services.find(s => s.id === id)
                      if (!svc) return null
                      return (
                        <div key={id} className="flex justify-between text-amber-700 text-xs">
                          <span className="truncate pr-2">+ {svc.name}</span>
                          <span className="shrink-0">+{formatCents(svc.addonAmountCents ?? svc.priceCents ?? 0)}</span>
                        </div>
                      )
                    })}
                    <div className="flex justify-between font-semibold text-stone-900 border-t border-stone-200 pt-1.5 mt-0.5">
                      <span>Total</span>
                      <span>{formatCents(totalPriceCents)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-stone-500">
                      <span>Duration</span>
                      <span>{totalDurationMinutes} min</span>
                    </div>
                  </div>
                )}

                {/* + Add another service */}
                {selectedServiceIds.length > 0 && !selectedServiceIds.includes('') && selectedServiceIds.length < nonAddonServices.length && (
                  <button
                    onClick={() => setSelectedServiceIds(prev => [...prev, ''])}
                    className="w-full py-2.5 rounded-xl border border-dashed border-stone-300 text-sm text-stone-500 hover:text-stone-700 hover:border-stone-400 transition-colors"
                  >
                    + Add another service
                  </button>
                )}

                {/* Continue */}
                {selectedServiceIds.length > 0 && (
                  <button
                    onClick={() => setBookingStep('details')}
                    disabled={
                      selectedServiceIds.includes('') ||
                      (primaryService?.pricingType === 'multi_option' && !selectedOptionName)
                    }
                    className="w-full py-3 rounded-xl text-white text-sm font-semibold transition-all disabled:opacity-40"
                    style={{ backgroundColor: '#0D7377' }}
                  >
                    Continue
                  </button>
                )}
              </div>
            )}

            {/* Step 2: Stylist + Date + Time */}
            {bookingStep === 'details' && (
              <div className="space-y-4">
                {/* Selected service summary */}
                <div className="bg-teal-50 rounded-xl p-3 text-sm text-teal-800 font-medium">
                  {selectedServiceIds.map(id => services.find(s => s.id === id)?.name).filter(Boolean).join(' + ')}
                  {' — '}{formatCents(totalPriceCents)}
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
                    onChange={(e) => {
                      setSelectedDate(e.target.value)
                      setSelectedTime(null)
                      if (e.target.value) fetchTakenSlots(e.target.value)
                    }}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
                  />
                </div>

                {/* Time slots */}
                {selectedDate && (
                  <div>
                    <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
                      Time {loadingSlots && <span className="text-stone-300 font-normal">(loading…)</span>}
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {timeSlots.map((slot) => {
                        const slotDate = new Date(slot)
                        const h = String(slotDate.getHours()).padStart(2, '0')
                        const m = String(slotDate.getMinutes()).padStart(2, '0')
                        const hhmm = `${h}:${m}`
                        const isTaken = takenSlots.includes(hhmm)
                        return (
                          <button
                            key={slot}
                            onClick={() => { if (!isTaken) setSelectedTime(slot) }}
                            disabled={isTaken}
                            className={`py-2 rounded-xl text-xs font-medium transition-all flex flex-col items-center ${
                              isTaken
                                ? 'bg-stone-100 text-stone-300 cursor-not-allowed'
                                : selectedTime === slot
                                  ? 'bg-[#0D7377] text-white'
                                  : 'bg-stone-50 text-stone-600 hover:bg-stone-100'
                            }`}
                          >
                            {formatSlotLabel(slot)}
                            {isTaken && <span className="text-[9px] leading-none mt-0.5">Booked</span>}
                          </button>
                        )
                      })}
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
            {bookingStep === 'confirm' && primaryService && selectedStylist && selectedTime && (
              <div className="space-y-4">
                <div className="bg-stone-50 rounded-xl p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-stone-500">Service</span>
                    <span className="font-medium text-stone-900 text-right">
                      {selectedServiceIds.map(id => services.find(s => s.id === id)?.name).filter(Boolean).join(' + ')}
                    </span>
                  </div>
                  {selectedAddonServiceIds.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-stone-500">Add-ons</span>
                      <span className="font-medium text-stone-900 text-right">
                        {selectedAddonServiceIds.map(id => services.find(s => s.id === id)?.name).filter(Boolean).join(', ')}
                      </span>
                    </div>
                  )}
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
                    <span className="font-bold text-stone-900">{formatCents(totalPriceCents)}</span>
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

            {/* Step 4: Payment (IP/hybrid mode) */}
            {bookingStep === 'payment' && (
              <div className="text-center py-4 space-y-4">
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
                  Your appointment has been scheduled. Complete payment below.
                </p>
                <button
                  onClick={handleCheckout}
                  disabled={checkingOut}
                  className="w-full py-3 rounded-xl text-white text-sm font-semibold transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                  style={{ backgroundColor: '#0D7377' }}
                >
                  {checkingOut ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : `Pay Now — ${formatCents(totalPriceCents)}`}
                </button>
                <button
                  onClick={() => setBookingStep('success')}
                  className="text-xs text-stone-400 hover:text-stone-600"
                >
                  Pay later
                </button>
              </div>
            )}

            {/* Step 5: Success */}
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
