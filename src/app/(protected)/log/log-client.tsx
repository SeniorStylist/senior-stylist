'use client'

import { useState, useRef } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn, formatCents, formatTime } from '@/lib/utils'
import { SkeletonBookingCard } from '@/components/ui/skeleton'
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh'
import type { Resident, Stylist, Service } from '@/types'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { useToast } from '@/components/ui/toast'

interface LogBooking {
  id: string
  startTime: string
  endTime: string
  status: string
  paymentStatus: string
  cancellationReason: string | null
  priceCents: number | null
  notes: string | null
  resident: Resident
  stylist: Stylist
  service: Service
}

interface LogEntryData {
  id: string
  stylistId: string
  date: string
  notes: string | null
  finalized: boolean
  finalizedAt: string | null
}

interface LogClientProps {
  initialDate: string
  initialBookings: LogBooking[]
  initialLogEntries: LogEntryData[]
  residents: Resident[]
  stylists: Stylist[]
  services: Service[]
}

// Round a date to nearest 30 min
function roundToNearest30(date: Date): string {
  const ms = 30 * 60 * 1000
  const rounded = new Date(Math.round(date.getTime() / ms) * ms)
  return `${rounded.getHours().toString().padStart(2, '0')}:${rounded.getMinutes().toString().padStart(2, '0')}`
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function formatLogDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const today = new Date().toISOString().split('T')[0]
  const yesterday = addDays(today, -1)
  const tomorrow = addDays(today, 1)
  if (dateStr === today) return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  if (dateStr === tomorrow) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export function LogClient({
  initialDate,
  initialBookings,
  initialLogEntries,
  residents,
  stylists,
  services,
}: LogClientProps) {
  const [date, setDate] = useState(initialDate)
  const [bookings, setBookings] = useState(initialBookings)
  const [logEntries, setLogEntries] = useState(initialLogEntries)
  const [loading, setLoading] = useState(false)
  // Increments on each successful fetch to re-trigger the enter animation
  const [contentKey, setContentKey] = useState(0)

  // Status updates
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // Finalize / Unfinalize
  const [confirmFinalizeId, setConfirmFinalizeId] = useState<string | null>(null)
  const [finalizingId, setFinalizingId] = useState<string | null>(null)
  const [unfinalizingId, setUnfinalizingId] = useState<string | null>(null)

  // Log notes (per stylist, keyed by stylistId)
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    initialLogEntries.forEach((e) => { m[e.stylistId] = e.notes ?? '' })
    return m
  })
  const [savingNotesId, setSavingNotesId] = useState<string | null>(null)

  // Walk-in form
  const [showWalkIn, setShowWalkIn] = useState(false)
  const [wiResidentSearch, setWiResidentSearch] = useState('')
  const [wiResidentDropOpen, setWiResidentDropOpen] = useState(false)
  const [wiResidentId, setWiResidentId] = useState('')
  const [wiServiceId, setWiServiceId] = useState(services[0]?.id ?? '')
  const [wiStylistId, setWiStylistId] = useState(stylists[0]?.id ?? '')
  const [wiTime, setWiTime] = useState(() => roundToNearest30(new Date()))
  const [wiAdding, setWiAdding] = useState(false)
  const [wiError, setWiError] = useState<string | null>(null)

  const { toast } = useToast()
  const today = new Date().toISOString().split('T')[0]
  const isToday = date === today

  const { refreshing: pullRefreshing, handlers: pullHandlers } = usePullToRefresh(
    () => navigateDate(date)
  )

  // Navigate dates
  const navigateDate = async (newDate: string) => {
    setLoading(true)
    setDate(newDate)
    try {
      const res = await fetch(`/api/log?date=${newDate}`)
      const json = await res.json()
      if (res.ok) {
        setBookings(json.data.bookings)
        setLogEntries(json.data.logEntries)
        const m: Record<string, string> = {}
        json.data.logEntries.forEach((e: LogEntryData) => { m[e.stylistId] = e.notes ?? '' })
        setNotes(m)
        setContentKey((k) => k + 1)
      }
    } finally {
      setLoading(false)
    }
  }

  // Group bookings by stylist
  const stylistMap = new Map<string, { stylist: Stylist; bookings: LogBooking[] }>()
  for (const b of bookings) {
    const existing = stylistMap.get(b.stylist.id)
    if (!existing) {
      stylistMap.set(b.stylist.id, { stylist: b.stylist, bookings: [b] })
    } else {
      existing.bookings.push(b)
    }
  }
  // Add stylists that have no bookings but have finalized log entries
  for (const entry of logEntries) {
    if (!stylistMap.has(entry.stylistId)) {
      const s = stylists.find((st) => st.id === entry.stylistId)
      if (s) stylistMap.set(entry.stylistId, { stylist: s, bookings: [] })
    }
  }
  const stylistGroups = Array.from(stylistMap.values()).sort((a, b) =>
    a.stylist.name.localeCompare(b.stylist.name)
  )

  const getLogEntry = (stylistId: string) =>
    logEntries.find((e) => e.stylistId === stylistId) ?? null

  // Update payment status
  const updatePaymentStatus = async (bookingId: string, currentPaymentStatus: string) => {
    const next =
      currentPaymentStatus === 'unpaid'
        ? 'paid'
        : currentPaymentStatus === 'paid'
        ? 'waived'
        : 'unpaid'
    setUpdatingId(bookingId)
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentStatus: next }),
      })
      const json = await res.json()
      if (res.ok) {
        setBookings(bookings.map((b) =>
          b.id === bookingId ? { ...b, paymentStatus: json.data.paymentStatus } : b
        ))
      }
    } finally {
      setUpdatingId(null)
    }
  }

  // Update booking status
  const updateStatus = async (bookingId: string, status: string) => {
    setUpdatingId(bookingId)
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json()
      if (res.ok) {
        setBookings(bookings.map((b) => (b.id === bookingId ? { ...b, status: json.data.status } : b)))
      }
    } finally {
      setUpdatingId(null)
    }
  }

  // Finalize log entry
  const handleFinalize = async (stylistId: string) => {
    if (confirmFinalizeId !== stylistId) {
      setConfirmFinalizeId(stylistId)
      return
    }
    setFinalizingId(stylistId)
    const existing = getLogEntry(stylistId)
    try {
      const url = existing ? `/api/log/${existing.id}` : '/api/log'
      const method = existing ? 'PUT' : 'POST'
      const body = existing
        ? { finalized: true, notes: notes[stylistId] ?? existing.notes ?? '' }
        : { stylistId, date, finalized: true, notes: notes[stylistId] ?? '' }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (res.ok) {
        setLogEntries((prev) => {
          const filtered = prev.filter((e) => e.stylistId !== stylistId)
          return [...filtered, json.data]
        })
        setConfirmFinalizeId(null)
        toast('Day finalized', 'success')
      }
    } finally {
      setFinalizingId(null)
    }
  }

  // Unfinalize log entry
  const handleUnfinalize = async (stylistId: string) => {
    const existing = getLogEntry(stylistId)
    if (!existing) return
    setUnfinalizingId(stylistId)
    try {
      const res = await fetch(`/api/log/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalized: false }),
      })
      const json = await res.json()
      if (res.ok) {
        setLogEntries((prev) => {
          const filtered = prev.filter((e) => e.stylistId !== stylistId)
          return [...filtered, json.data]
        })
      }
    } finally {
      setUnfinalizingId(null)
    }
  }

  // Save notes
  const saveNotes = async (stylistId: string) => {
    setSavingNotesId(stylistId)
    const existing = getLogEntry(stylistId)
    try {
      const url = existing ? `/api/log/${existing.id}` : '/api/log'
      const method = existing ? 'PUT' : 'POST'
      const body = existing
        ? { notes: notes[stylistId] ?? '' }
        : { stylistId, date, notes: notes[stylistId] ?? '' }
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (res.ok) {
        setLogEntries((prev) => {
          const filtered = prev.filter((e) => e.stylistId !== stylistId)
          return [...filtered, json.data]
        })
      }
    } finally {
      setSavingNotesId(null)
    }
  }

  // Add walk-in
  const filteredResidents = residents.filter(
    (r) =>
      r.name.toLowerCase().includes(wiResidentSearch.toLowerCase()) ||
      (r.roomNumber && r.roomNumber.toLowerCase().includes(wiResidentSearch.toLowerCase()))
  )

  const handleAddWalkIn = async () => {
    if (!wiResidentId) { setWiError('Select a resident'); return }
    if (!wiServiceId) { setWiError('Select a service'); return }
    if (!wiStylistId) { setWiError('Select a stylist'); return }
    if (!wiTime) { setWiError('Enter a time'); return }

    setWiAdding(true)
    setWiError(null)
    try {
      const startTime = new Date(`${date}T${wiTime}:00`)
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          residentId: wiResidentId,
          serviceId: wiServiceId,
          stylistId: wiStylistId,
          startTime: startTime.toISOString(),
          notes: 'Walk-in',
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setBookings((prev) => [...prev, json.data].sort(
          (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        ))
        setShowWalkIn(false)
        setWiResidentSearch('')
        setWiResidentId('')
        setWiServiceId(services[0]?.id ?? '')
        setWiTime(roundToNearest30(new Date()))
        toast('Appointment booked!', 'success')
      } else {
        setWiError(json.error?.message ?? json.error ?? 'Failed to add walk-in')
      }
    } catch {
      setWiError('Network error')
    } finally {
      setWiAdding(false)
    }
  }

  // Totals
  const activeBookings = bookings.filter((b) => b.status !== 'cancelled')
  const completedBookings = bookings.filter((b) => b.status === 'completed')
  const totalRevenue = completedBookings.reduce((sum, b) => sum + (b.priceCents ?? b.service.priceCents), 0)

  return (
    <ErrorBoundary>
    <div
      className="p-4 md:p-6 max-w-3xl mx-auto"
      {...pullHandlers}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigateDate(addDays(date, -1))}
          disabled={loading}
          className="p-3 hover:bg-stone-100 rounded-xl transition-colors text-stone-400 hover:text-stone-700 disabled:opacity-40 min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="flex-1 text-center">
          <div className="flex items-center justify-center gap-2">
            <h1
              className="text-xl font-bold text-stone-900"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              {formatLogDate(date)}
            </h1>
            {loading && (
              <div className="w-4 h-4 rounded-full border-2 border-stone-200 border-t-[#0D7377] animate-spin shrink-0" />
            )}
          </div>
          <p className="text-xs text-stone-400 mt-0.5">
            {new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
              weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
            })}
          </p>
        </div>
        <button
          onClick={() => navigateDate(addDays(date, 1))}
          disabled={loading}
          className="p-3 hover:bg-stone-100 rounded-xl transition-colors text-stone-400 hover:text-stone-700 disabled:opacity-40 min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Pull-to-refresh indicator */}
      {pullRefreshing && (
        <div className="flex justify-center pb-3">
          <div className="w-5 h-5 rounded-full border-2 border-stone-200 border-t-[#0D7377] animate-spin" />
        </div>
      )}

      {/* Body — skeleton on first load, dims on subsequent fetches */}
      {loading && contentKey === 0 ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <SkeletonBookingCard key={i} />
          ))}
        </div>
      ) : (
      <div
        key={contentKey}
        className={cn(contentKey > 0 && 'log-enter')}
        style={{
          opacity: loading ? 0.5 : 1,
          pointerEvents: loading ? 'none' : 'auto',
          transition: 'opacity 150ms ease',
        }}
      >

      {/* Summary bar */}
      {activeBookings.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-5 py-3 mb-4 flex items-center gap-6">
          <div className="text-center">
            <p className="text-lg font-bold text-stone-900">{activeBookings.length}</p>
            <p className="text-xs text-stone-500">appointments</p>
          </div>
          <div className="w-px h-8 bg-stone-100" />
          <div className="text-center">
            <p className="text-lg font-bold text-green-700">{completedBookings.length}</p>
            <p className="text-xs text-stone-500">completed</p>
          </div>
          <div className="w-px h-8 bg-stone-100" />
          <div className="text-center">
            <p className="text-lg font-bold text-stone-900">{formatCents(totalRevenue)}</p>
            <p className="text-xs text-stone-500">revenue</p>
          </div>
        </div>
      )}

      {/* Walk-in form */}
      {showWalkIn && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4 mb-4 space-y-3">
          <p className="text-sm font-semibold text-stone-700">Add Walk-in</p>
          {wiError && <p className="text-xs text-red-600">{wiError}</p>}

          {/* Resident combobox */}
          <div className="relative">
            <input
              type="text"
              value={wiResidentSearch}
              onChange={(e) => {
                setWiResidentSearch(e.target.value)
                setWiResidentDropOpen(true)
                if (wiResidentId) {
                  const r = residents.find((r) => r.id === wiResidentId)
                  if (r && r.name !== e.target.value) setWiResidentId('')
                }
              }}
              onFocus={() => setWiResidentDropOpen(true)}
              onBlur={() => setTimeout(() => setWiResidentDropOpen(false), 150)}
              placeholder="Search resident..."
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
            />
            {wiResidentDropOpen && filteredResidents.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-stone-200 rounded-xl shadow-lg z-50 max-h-40 overflow-y-auto">
                {filteredResidents.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onMouseDown={() => {
                      setWiResidentId(r.id)
                      setWiResidentSearch(r.name)
                      setWiResidentDropOpen(false)
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
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={wiServiceId}
              onChange={(e) => setWiServiceId(e.target.value)}
              className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0D7377] transition-all"
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {formatCents(s.priceCents)}
                </option>
              ))}
            </select>
            <select
              value={wiStylistId}
              onChange={(e) => setWiStylistId(e.target.value)}
              className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#0D7377] transition-all"
            >
              {stylists.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide shrink-0">Time</label>
            <input
              type="time"
              value={wiTime}
              onChange={(e) => setWiTime(e.target.value)}
              className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0D7377] transition-all"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setShowWalkIn(false); setWiError(null) }} disabled={wiAdding}>
              Cancel
            </Button>
            <Button size="sm" loading={wiAdding} onClick={handleAddWalkIn}>
              Add walk-in
            </Button>
          </div>
        </div>
      )}

      {/* No bookings state */}
      {stylistGroups.length === 0 && !loading && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-12 text-center mb-4">
          <p className="text-stone-400 text-sm">No appointments scheduled for this day.</p>
          {isToday && (
            <button
              onClick={() => setShowWalkIn(true)}
              className="mt-3 text-sm text-[#0D7377] font-medium hover:underline"
            >
              Add a walk-in
            </button>
          )}
        </div>
      )}

      {/* Stylist sections */}
      {stylistGroups.map(({ stylist, bookings: stylistBookings }) => {
        const logEntry = getLogEntry(stylist.id)
        const isFinalized = logEntry?.finalized ?? false
        const stylistCompleted = stylistBookings.filter((b) => b.status === 'completed')
        const stylistRevenue = stylistCompleted.reduce(
          (sum, b) => sum + (b.priceCents ?? b.service.priceCents),
          0
        )

        return (
          <div
            key={stylist.id}
            className={cn(
              'bg-white rounded-2xl border shadow-sm mb-4 overflow-hidden',
              isFinalized ? 'border-green-200' : 'border-stone-100'
            )}
          >
            {/* Section header */}
            <div
              className={cn(
                'flex items-center gap-3 px-4 py-3 border-b',
                isFinalized ? 'border-green-100 bg-green-50/60' : 'border-stone-100'
              )}
            >
              <Avatar name={stylist.name} color={stylist.color} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-stone-900">{stylist.name}</p>
                {stylistBookings.length > 0 && (
                  <p className="text-xs text-stone-500">
                    {stylistCompleted.length}/{stylistBookings.filter(b => b.status !== 'cancelled').length} done
                    {stylistRevenue > 0 ? ` · ${formatCents(stylistRevenue)}` : ''}
                  </p>
                )}
              </div>
              {isFinalized ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Finalized
                </span>
              ) : confirmFinalizeId === stylist.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-stone-500">Finalize?</span>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={finalizingId === stylist.id}
                    onClick={() => handleFinalize(stylist.id)}
                  >
                    Yes
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmFinalizeId(null)}>
                    No
                  </Button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleFinalize(stylist.id)}
                >
                  Finalize
                </Button>
              )}
            </div>

            {/* Booking rows */}
            {stylistBookings.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-stone-400">No appointments</div>
            ) : (
              <div className="divide-y divide-stone-50">
                {stylistBookings.map((booking) => {
                  const isCompleted = booking.status === 'completed'
                  const isNoShow = booking.status === 'no_show'
                  const isCancelled = booking.status === 'cancelled'
                  const isUpdating = updatingId === booking.id

                  return (
                    <div
                      key={booking.id}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3.5 transition-colors',
                        isCompleted && 'bg-green-50/40',
                        isNoShow && 'bg-orange-50/40',
                        isCancelled && 'bg-stone-50/60 opacity-60'
                      )}
                    >
                      {/* Status indicator */}
                      <div className="shrink-0 mt-0.5">
                        {isCompleted ? (
                          <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                        ) : isNoShow ? (
                          <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ea580c" strokeWidth="3">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </div>
                        ) : isCancelled ? (
                          <div className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="3">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </div>
                        ) : (
                          <div className="w-6 h-6 rounded-full border-2 border-stone-200" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <p
                            className={cn(
                              'text-sm font-semibold text-stone-900',
                              (isNoShow || isCancelled) && 'line-through text-stone-400'
                            )}
                          >
                            {booking.resident.name}
                          </p>
                          {booking.resident.roomNumber && (
                            <span className="text-xs text-stone-400">
                              Rm {booking.resident.roomNumber}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-stone-500 mt-0.5">
                          {formatTime(booking.startTime)} · {booking.service.name} ·{' '}
                          {formatCents(booking.priceCents ?? booking.service.priceCents)}
                        </p>
                        {booking.notes === 'Walk-in' && (
                          <span className="inline-block mt-0.5 text-xs font-medium text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded-md">
                            Walk-in
                          </span>
                        )}
                        {booking.notes && booking.notes !== 'Walk-in' && (
                          <p className="text-xs text-stone-400 mt-0.5 italic">{booking.notes}</p>
                        )}
                        {isCancelled && booking.cancellationReason && (
                          <p className="text-xs text-stone-400 mt-0.5 italic">Reason: {booking.cancellationReason}</p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="shrink-0 flex items-center gap-1.5">
                        {/* Payment status badge/toggle */}
                        {!isCancelled && (
                          <button
                            onClick={() => !isFinalized && updatePaymentStatus(booking.id, booking.paymentStatus ?? 'unpaid')}
                            disabled={isUpdating || isFinalized}
                            title={isFinalized ? `Payment: ${booking.paymentStatus ?? 'unpaid'}` : 'Toggle payment status'}
                            className={cn(
                              'text-xs font-semibold px-2 py-1 rounded-lg transition-colors disabled:cursor-default',
                              booking.paymentStatus === 'paid'
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : booking.paymentStatus === 'waived'
                                ? 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                                : 'bg-stone-50 text-stone-400 hover:bg-stone-100',
                              isFinalized && 'opacity-70'
                            )}
                          >
                            {booking.paymentStatus === 'paid'
                              ? '$'
                              : booking.paymentStatus === 'waived'
                              ? 'Waived'
                              : '$'}
                          </button>
                        )}
                        {!isFinalized && !isCancelled && (
                          <>
                            {isCompleted || isNoShow ? (
                              <button
                                onClick={() => updateStatus(booking.id, 'scheduled')}
                                disabled={isUpdating}
                                className="text-xs text-stone-400 hover:text-stone-600 font-medium px-3 min-h-[44px] rounded-xl hover:bg-stone-100 transition-colors disabled:opacity-40"
                              >
                                Undo
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => updateStatus(booking.id, 'completed')}
                                  disabled={isUpdating}
                                  className="text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 px-3 min-h-[44px] rounded-xl transition-colors disabled:opacity-40 border border-green-200"
                                >
                                  Done
                                </button>
                                <button
                                  onClick={() => updateStatus(booking.id, 'no_show')}
                                  disabled={isUpdating}
                                  className="text-xs font-semibold text-orange-600 bg-orange-50 hover:bg-orange-100 px-2.5 min-h-[44px] rounded-xl transition-colors disabled:opacity-40 border border-orange-200"
                                >
                                  No-show
                                </button>
                              </>
                            )}
                          </>
                        )}
                        {isCancelled && (
                          <span className="text-xs text-stone-400 font-medium">Cancelled</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Notes + footer */}
            {!isFinalized && (
              <div className="px-4 py-3 border-t border-stone-50">
                <textarea
                  value={notes[stylist.id] ?? ''}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [stylist.id]: e.target.value }))}
                  placeholder="Day notes (optional)..."
                  rows={2}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-1 focus:ring-teal-100 transition-all resize-none"
                />
                {notes[stylist.id] && (
                  <div className="flex justify-end mt-1.5">
                    <button
                      onClick={() => saveNotes(stylist.id)}
                      disabled={savingNotesId === stylist.id}
                      className="text-xs text-[#0D7377] font-medium hover:underline disabled:opacity-40"
                    >
                      {savingNotesId === stylist.id ? 'Saving...' : 'Save notes'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {isFinalized && logEntry?.notes && (
              <div className="px-4 py-3 border-t border-green-100 bg-green-50/30">
                <p className="text-xs text-stone-500 font-medium uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-stone-700">{logEntry.notes}</p>
              </div>
            )}
            {isFinalized && (
              <div className="px-4 py-2 border-t border-green-100 bg-green-50/30 flex items-center justify-between">
                <p className="text-xs text-green-600">
                  {logEntry?.finalizedAt
                    ? `Finalized ${new Date(logEntry.finalizedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
                    : 'Finalized'}
                </p>
                <button
                  onClick={() => handleUnfinalize(stylist.id)}
                  disabled={unfinalizingId === stylist.id}
                  className="text-xs text-stone-400 hover:text-stone-600 font-medium hover:underline disabled:opacity-40 transition-colors"
                >
                  {unfinalizingId === stylist.id ? 'Undoing…' : 'Unfinalize'}
                </button>
              </div>
            )}
          </div>
        )
      })}

      </div>
      )}{/* end body wrapper */}

      {/* Add walk-in FAB */}
      {!showWalkIn && (
        <button
          onClick={() => setShowWalkIn(true)}
          className="fixed bottom-6 right-6 flex items-center gap-2 bg-[#0D7377] text-white rounded-2xl px-4 py-3 shadow-lg hover:bg-[#0a5f63] active:scale-95 transition-all text-sm font-semibold md:relative md:bottom-auto md:right-auto md:mt-2 md:w-full md:justify-center"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add walk-in
        </button>
      )}
    </div>
    </ErrorBoundary>
  )
}
