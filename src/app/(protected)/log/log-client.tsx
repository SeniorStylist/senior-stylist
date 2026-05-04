'use client'

import { useState, useEffect } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn, formatCents, formatTime } from '@/lib/utils'
import { getLocalParts, fromDateTimeLocalInTz } from '@/lib/time'
import { formatPricingLabel } from '@/lib/pricing'
import {
  buildCategoryPriority,
  sortCategoryGroups,
  sortServicesWithinCategory,
} from '@/lib/service-sort'
import { SkeletonBookingCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh'
import type { Resident, Stylist, Service } from '@/types'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { useToast } from '@/components/ui/toast'
import { OcrImportModal } from './ocr-import-modal'

interface LogBooking {
  id: string
  startTime: string
  endTime: string
  status: string
  paymentStatus: string
  cancellationReason: string | null
  priceCents: number | null
  notes: string | null
  selectedQuantity: number | null
  selectedOption: string | null
  addonTotalCents: number | null
  addonServiceIds: string[] | null
  serviceIds: string[] | null
  serviceNames: string[] | null
  totalDurationMinutes: number | null
  source?: string | null
  rawServiceName?: string | null
  importBatch?: { fileName: string } | null
  tipCents: number | null
  resident: Resident
  stylist: Stylist
  service: Service | null
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
  stylistFilter?: string | null
  serviceCategoryOrder?: string[] | null
  // Phase 12F: facility's IANA timezone — drives row times, finalized timestamp,
  // walk-in time picker default + submit conversion, "today/yesterday/tomorrow" labels.
  facilityTimezone: string
  role?: string
}

// Round a date to nearest 30 min IN THE FACILITY'S TIMEZONE.
function roundToNearest30(date: Date, tz: string): string {
  const ms = 30 * 60 * 1000
  const rounded = new Date(Math.round(date.getTime() / ms) * ms)
  const p = getLocalParts(rounded, tz)
  return `${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}`
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function serviceDisplayName(booking: LogBooking, allServices: Service[]): string {
  // Prefer denormalized serviceNames (multi-service bookings), fall back to single service
  const primaryNames =
    booking.serviceNames && booking.serviceNames.length > 0
      ? booking.serviceNames
      : booking.service
        ? [booking.service.name]
        : booking.rawServiceName
          ? [booking.rawServiceName]
          : ['Unknown service']
  const addonNames = (booking.addonServiceIds ?? [])
    .map((id) => allServices.find((s) => s.id === id)?.name)
    .filter((n): n is string => Boolean(n))
  const all = [...primaryNames, ...addonNames]
  return all.join(' + ')
}

function formatLogDate(dateStr: string, tz: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  // Phase 12F — "today" anchors to the facility's calendar, not the viewer's
  const todayParts = getLocalParts(new Date(), tz)
  const today = `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-${String(todayParts.day).padStart(2, '0')}`
  const yesterday = addDays(today, -1)
  const tomorrow = addDays(today, 1)
  if (dateStr === today) return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  if (dateStr === tomorrow) return 'Tomorrow'
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function LogClient({
  initialDate,
  initialBookings,
  initialLogEntries,
  residents,
  stylists,
  services,
  stylistFilter,
  serviceCategoryOrder,
  facilityTimezone,
  role = 'admin',
}: LogClientProps) {
  const wiServiceCategoryPriority = buildCategoryPriority(serviceCategoryOrder)
  // facility_staff and bookkeeper are read-only on the daily log
  const canWrite = role === 'admin' || role === 'super_admin' || role === 'stylist'
  const [date, setDate] = useState(initialDate)
  const [bookings, setBookings] = useState(initialBookings)
  const [logEntries, setLogEntries] = useState(initialLogEntries)
  const [loading, setLoading] = useState(false)
  // Increments on each successful fetch to re-trigger the enter animation
  const [contentKey, setContentKey] = useState(0)

  // Status updates
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // Collapsible stylist sections
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggleCollapsed = (id: string) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))

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

  // Inline booking price/notes editing
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const startEditBooking = (booking: LogBooking) => {
    setEditingBookingId(booking.id)
    setEditPrice(((booking.priceCents ?? booking.service?.priceCents ?? 0) / 100).toFixed(2))
    setEditNotes(booking.notes ?? '')
  }

  const cancelEditBooking = () => {
    setEditingBookingId(null)
    setEditPrice('')
    setEditNotes('')
  }

  const saveEditBooking = async () => {
    if (!editingBookingId) return
    setSavingEdit(true)
    try {
      const priceCents = Math.round(parseFloat(editPrice) * 100)
      if (isNaN(priceCents) || priceCents < 0) return
      const res = await fetch(`/api/bookings/${editingBookingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceCents, notes: editNotes || null }),
      })
      if (res.ok) {
        const json = await res.json()
        setBookings((prev) => prev.map((b) =>
          b.id === editingBookingId
            ? { ...b, priceCents: json.data.priceCents, notes: json.data.notes }
            : b
        ))
        setEditingBookingId(null)
        toast('Updated', 'success')
      }
    } finally {
      setSavingEdit(false)
    }
  }

  // Walk-in form
  const [showWalkIn, setShowWalkIn] = useState(false)
  const [wiResidentSearch, setWiResidentSearch] = useState('')
  const [wiResidentDropOpen, setWiResidentDropOpen] = useState(false)
  const [wiResidentId, setWiResidentId] = useState('')
  const [wiServiceId, setWiServiceId] = useState('')
  const [wiStylistId, setWiStylistId] = useState(stylists[0]?.id ?? '')
  const [wiTime, setWiTime] = useState(() => roundToNearest30(new Date(), facilityTimezone))
  const [wiAddonServiceIds, setWiAddonServiceIds] = useState<string[]>([])
  const [wiAdding, setWiAdding] = useState(false)
  const [wiError, setWiError] = useState<string | null>(null)
  const [wiCreateOpen, setWiCreateOpen] = useState(false)
  const [wiCreateName, setWiCreateName] = useState('')
  const [wiCreateRoom, setWiCreateRoom] = useState('')
  const [wiCreating, setWiCreating] = useState(false)
  const [wiCreateError, setWiCreateError] = useState<string | null>(null)
  const [localNewResidents, setLocalNewResidents] = useState<Resident[]>([])

  // OCR import modal
  const [ocrOpen, setOcrOpen] = useState(false)

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
  const allStylistGroups = Array.from(stylistMap.values()).sort((a, b) =>
    a.stylist.name.localeCompare(b.stylist.name)
  )
  const stylistGroups = stylistFilter
    ? allStylistGroups.filter((g) => g.stylist.id === stylistFilter)
    : allStylistGroups

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
  const allResidents = [...residents, ...localNewResidents]
  const filteredResidents = allResidents.filter(
    (r) =>
      r.name.toLowerCase().includes(wiResidentSearch.toLowerCase()) ||
      (r.roomNumber && r.roomNumber.toLowerCase().includes(wiResidentSearch.toLowerCase()))
  )
  const wiAddonServices = services.filter(
    (s) => s.pricingType === 'addon' && s.id !== wiServiceId
  )

  const handleAddWalkIn = async () => {
    if (!wiResidentId) { setWiError('Select a resident'); return }
    if (!wiServiceId) { setWiError('Select a service'); return }
    if (!wiStylistId) { setWiError('Select a stylist'); return }
    if (!wiTime) { setWiError('Enter a time'); return }

    setWiAdding(true)
    setWiError(null)
    try {
      // Phase 12F — interpret wiTime in the facility's tz so a viewer in any
      // browser tz sees their typed "9:00" land at 9 a.m. facility-local.
      const startTime = fromDateTimeLocalInTz(`${date}T${wiTime}`, facilityTimezone)
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          residentId: wiResidentId,
          serviceId: wiServiceId,
          stylistId: wiStylistId,
          startTime: startTime.toISOString(),
          notes: 'Walk-in',
          ...(wiAddonServiceIds.length > 0 ? { addonServiceIds: wiAddonServiceIds } : {}),
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
        setWiServiceId('')
        setWiAddonServiceIds([])
        setWiTime(roundToNearest30(new Date(), facilityTimezone))
        setLocalNewResidents([])
        setWiCreateOpen(false)
        setWiCreateName('')
        setWiCreateRoom('')
        setWiCreateError(null)
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
  const totalRevenue = completedBookings.reduce((sum, b) => sum + (b.priceCents ?? b.service?.priceCents ?? 0), 0)

  return (
    <ErrorBoundary>
    <div
      className="page-enter p-4 md:p-6 max-w-3xl mx-auto pb-40 md:pb-0"
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
              className="text-xl font-normal text-stone-900"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              {formatLogDate(date, facilityTimezone)}
            </h1>
            {loading && (
              <div className="w-4 h-4 rounded-full border-2 border-stone-200 border-t-[#8B2E4A] animate-spin shrink-0" />
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
          <div className="w-5 h-5 rounded-full border-2 border-stone-200 border-t-[#8B2E4A] animate-spin" />
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
              onBlur={(e) => {
                const related = e.relatedTarget as HTMLElement | null
                const dropdown = e.currentTarget.closest('.relative')
                if (dropdown && related && dropdown.contains(related)) return
                setTimeout(() => setWiResidentDropOpen(false), 150)
              }}
              placeholder="Search resident..."
              className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 focus:shadow-[0_0_0_3px_rgba(139,46,74,0.08)] transition-all"
            />
            {wiResidentDropOpen && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-stone-200 rounded-xl shadow-lg z-50 max-h-52 overflow-y-auto">
                {wiCreateOpen ? (
                  <div className="p-3 space-y-2">
                    <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">New Resident</p>
                    {wiCreateError && (
                      <p className="text-xs text-red-600">{wiCreateError}</p>
                    )}
                    <input
                      autoFocus
                      tabIndex={0}
                      value={wiCreateName}
                      onChange={(e) => setWiCreateName(e.target.value)}
                      placeholder="Full name *"
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                    />
                    <input
                      tabIndex={0}
                      value={wiCreateRoom}
                      onChange={(e) => setWiCreateRoom(e.target.value)}
                      placeholder="Room number (optional)"
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                    />
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onMouseDown={() => { setWiCreateOpen(false); setWiCreateError(null) }}
                        className="flex-1 min-h-[44px] text-sm text-stone-600 border border-stone-200 rounded-xl hover:bg-stone-50 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!wiCreateName.trim() || wiCreating}
                        onMouseDown={async () => {
                          if (!wiCreateName.trim()) return
                          setWiCreating(true)
                          setWiCreateError(null)
                          try {
                            const res = await fetch('/api/residents', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                name: wiCreateName.trim(),
                                roomNumber: wiCreateRoom.trim() || undefined,
                              }),
                            })
                            const json = await res.json()
                            if (!res.ok) {
                              setWiCreateError(
                                res.status === 409
                                  ? 'A resident with this name already exists'
                                  : (json.error ?? 'Failed to create resident')
                              )
                              return
                            }
                            const newResident: Resident = json.data
                            setLocalNewResidents((prev) => [...prev, newResident])
                            setWiResidentId(newResident.id)
                            setWiResidentSearch(newResident.name)
                            setWiResidentDropOpen(false)
                            setWiCreateOpen(false)
                            setWiCreateName('')
                            setWiCreateRoom('')
                          } finally {
                            setWiCreating(false)
                          }
                        }}
                        className="flex-1 min-h-[44px] text-sm font-semibold bg-[#8B2E4A] text-white rounded-xl hover:bg-[#72253C] disabled:opacity-50 transition-colors"
                      >
                        {wiCreating ? 'Creating…' : 'Create & Select'}
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
                    {wiResidentSearch.trim().length >= 3 && (
                      <button
                        type="button"
                        onMouseDown={() => {
                          setWiCreateName(wiResidentSearch.trim())
                          setWiCreateRoom('')
                          setWiCreateError(null)
                          setWiCreateOpen(true)
                        }}
                        className="w-full text-left px-3.5 py-2.5 min-h-[44px] text-sm font-medium text-[#8B2E4A] border-t border-stone-100 hover:bg-rose-50 transition-colors flex items-center gap-2"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        Create &quot;{wiResidentSearch.trim()}&quot;
                      </button>
                    )}
                  </>
                ) : wiResidentSearch.trim().length >= 3 ? (
                  <button
                    type="button"
                    onMouseDown={() => {
                      setWiCreateName(wiResidentSearch.trim())
                      setWiCreateRoom('')
                      setWiCreateError(null)
                      setWiCreateOpen(true)
                    }}
                    className="w-full text-left px-3.5 py-2.5 min-h-[44px] text-sm font-medium text-[#8B2E4A] hover:bg-rose-50 transition-colors flex items-center gap-2"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Create &quot;{wiResidentSearch.trim()}&quot;
                  </button>
                ) : wiResidentSearch ? (
                  <div className="px-3.5 py-3">
                    <p className="text-sm text-stone-400">No residents found</p>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={wiServiceId}
              onChange={(e) => setWiServiceId(e.target.value)}
              className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A] transition-all"
            >
              <option value="">Select a service</option>
              {(() => {
                const grouped = new Map<string, Service[]>()
                for (const s of services) {
                  const key = s.category?.trim() || 'Other'
                  if (!grouped.has(key)) grouped.set(key, [])
                  grouped.get(key)!.push(s)
                }
                const orderedGroups = sortCategoryGroups(
                  [...grouped.entries()],
                  wiServiceCategoryPriority,
                )
                if (orderedGroups.length <= 1) {
                  return sortServicesWithinCategory(services).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {formatPricingLabel(s)}
                    </option>
                  ))
                }
                return orderedGroups.map(([category, list]) => (
                  <optgroup key={category} label={category}>
                    {sortServicesWithinCategory(list).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {formatPricingLabel(s)}
                      </option>
                    ))}
                  </optgroup>
                ))
              })()}
            </select>
            <select
              value={wiStylistId}
              onChange={(e) => setWiStylistId(e.target.value)}
              className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A] transition-all"
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
              className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A] transition-all"
            />
          </div>

          {wiAddonServices.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Add-ons</p>
              {wiAddonServices.map((svc) => (
                <label key={svc.id} className="flex items-center gap-2.5 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={wiAddonServiceIds.includes(svc.id)}
                    onChange={() => setWiAddonServiceIds((prev) =>
                      prev.includes(svc.id) ? prev.filter((x) => x !== svc.id) : [...prev, svc.id]
                    )}
                    className="rounded accent-[#8B2E4A] w-4 h-4 shrink-0"
                  />
                  <span className="text-sm text-stone-700 flex-1">{svc.name}</span>
                  <span className="text-sm text-amber-700">+{formatCents(svc.addonAmountCents ?? 0)}</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setShowWalkIn(false); setWiError(null); setLocalNewResidents([]); setWiCreateOpen(false); setWiCreateName(''); setWiCreateRoom(''); setWiCreateError(null) }} disabled={wiAdding}>
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
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm mb-4">
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
                <path d="M12 14l.8 1.8L14.5 16l-1.7 1.5.4 2L12 18.5l-1.2.9.4-2L9.5 16l1.7-.2.8-1.8z" />
              </svg>
            }
            title={isToday ? 'No appointments today' : 'No appointments scheduled for this day'}
            cta={isToday && canWrite ? { label: '+ Add Walk-in', onClick: () => setShowWalkIn(true) } : undefined}
          />
        </div>
      )}

      {/* Stylist sections */}
      {stylistGroups.map(({ stylist, bookings: stylistBookings }) => {
        const logEntry = getLogEntry(stylist.id)
        const isFinalized = logEntry?.finalized ?? false
        const stylistCompleted = stylistBookings.filter((b) => b.status === 'completed')
        const stylistRevenue = stylistCompleted.reduce(
          (sum, b) => sum + (b.priceCents ?? b.service?.priceCents ?? 0),
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
                'flex items-center gap-3 px-4 py-3 border-b cursor-pointer select-none active:opacity-70 transition-opacity duration-75',
                isFinalized ? 'border-green-100 bg-green-50/60' : 'border-stone-100',
                collapsed[stylist.id] && 'border-b-0'
              )}
              onClick={() => toggleCollapsed(stylist.id)}
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
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={cn('text-stone-400 shrink-0 transition-transform duration-200 mr-1', collapsed[stylist.id] ? '-rotate-90' : '')}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              {isFinalized ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Finalized
                </span>
              ) : !canWrite ? null : confirmFinalizeId === stylist.id ? (
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
            {collapsed[stylist.id] ? null : stylistBookings.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-stone-400">No appointments</div>
            ) : (
              <div className="divide-y divide-stone-50">
                {stylistBookings.map((booking) => {
                  const isCompleted = booking.status === 'completed'
                  const isNoShow = booking.status === 'no_show'
                  const isCancelled = booking.status === 'cancelled'
                  const isUpdating = updatingId === booking.id
                  const isEditing = editingBookingId === booking.id
                  const canEdit = canWrite && !isCancelled && !isFinalized && (!stylistFilter || booking.stylist.id === stylistFilter)

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
                      {/* Avatar */}
                      <div className="shrink-0">
                        <Avatar name={booking.resident.name} size="md" />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p
                            className={cn(
                              'text-[13.5px] font-semibold text-stone-900 leading-snug',
                              (isNoShow || isCancelled) && 'line-through text-stone-400'
                            )}
                          >
                            {booking.resident.name}
                          </p>
                          {isCompleted && (
                            <span className="shrink-0 w-4 h-4 rounded-full bg-green-100 flex items-center justify-center" title="Completed">
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3.5">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </span>
                          )}
                          {isNoShow && (
                            <span className="shrink-0 w-4 h-4 rounded-full bg-orange-100 flex items-center justify-center" title="No-show">
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#ea580c" strokeWidth="3.5">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </span>
                          )}
                          {isCancelled && (
                            <span className="shrink-0 w-4 h-4 rounded-full bg-stone-100 flex items-center justify-center" title="Cancelled">
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="3.5">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </span>
                          )}
                          {booking.resident.roomNumber && (
                            <span className="text-[11.5px] text-stone-400 leading-snug">
                              Rm {booking.resident.roomNumber}
                            </span>
                          )}
                          {booking.source === 'historical_import' && (
                            <span
                              title={booking.importBatch?.fileName ? `Historical record — imported from ${booking.importBatch.fileName}` : 'Historical record'}
                              className="inline-block text-[10.5px] font-semibold text-stone-600 bg-stone-100 px-1.5 py-0.5 rounded-full leading-none"
                            >
                              H
                            </span>
                          )}
                        </div>

                        {isEditing ? (
                          <div className="mt-1.5 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-stone-500">$</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={editPrice}
                                onChange={(e) => setEditPrice(e.target.value)}
                                className="w-24 bg-white border border-stone-200 rounded-lg px-2 py-1 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                              />
                            </div>
                            <textarea
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              placeholder="Notes..."
                              rows={2}
                              className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 resize-none"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={saveEditBooking}
                                disabled={savingEdit}
                                className="text-xs font-semibold text-white bg-[#8B2E4A] hover:bg-[#72253C] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                              >
                                {savingEdit ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                onClick={cancelEditBooking}
                                className="text-xs font-medium text-stone-500 hover:text-stone-700 px-2 py-1.5"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-[11.5px] text-stone-500 leading-snug mt-0.5">
                              {formatTime(booking.startTime, facilityTimezone)} · {serviceDisplayName(booking, services)} ·{' '}
                              {formatCents(booking.priceCents ?? booking.service?.priceCents ?? 0)}
                              {booking.tipCents != null && booking.tipCents > 0 && (
                                <span className="text-stone-400"> · Tip {formatCents(booking.tipCents)}</span>
                              )}
                              {booking.selectedQuantity && booking.selectedQuantity > 1 && (
                                <span className="text-stone-400"> (qty: {booking.selectedQuantity})</span>
                              )}
                              {booking.selectedOption && (
                                <span className="text-stone-400"> — {booking.selectedOption}</span>
                              )}
                            </p>
                            {booking.notes === 'Walk-in' && (
                              <span className="inline-block mt-0.5 text-xs font-medium text-[#8B2E4A] bg-rose-50 px-1.5 py-0.5 rounded-md">
                                Walk-in
                              </span>
                            )}
                            {booking.notes && booking.notes !== 'Walk-in' && (
                              <p className="text-xs text-stone-400 mt-0.5 italic">{booking.notes}</p>
                            )}
                            {isCancelled && booking.cancellationReason && (
                              <p className="text-xs text-stone-400 mt-0.5 italic">Reason: {booking.cancellationReason}</p>
                            )}
                          </>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="shrink-0 flex items-center gap-1.5">
                        {/* Edit button */}
                        {canEdit && !isEditing && (
                          <button
                            onClick={() => startEditBooking(booking)}
                            className="text-stone-400 hover:text-[#8B2E4A] p-1.5 rounded-lg hover:bg-stone-100 transition-colors"
                            title="Edit price & notes"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                        )}
                        {/* Payment status badge/toggle */}
                        {!isCancelled && !isEditing && (
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
                        {!isFinalized && !isCancelled && !isEditing && (
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
                                  className="text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 px-3 min-h-[44px] rounded-xl transition-all duration-75 disabled:opacity-40 border border-green-200 active:scale-95 active:bg-green-200"
                                >
                                  Done
                                </button>
                                <button
                                  onClick={() => updateStatus(booking.id, 'no_show')}
                                  disabled={isUpdating}
                                  className="text-xs font-semibold text-orange-600 bg-orange-50 hover:bg-orange-100 px-2.5 min-h-[44px] rounded-xl transition-all duration-75 disabled:opacity-40 border border-orange-200 active:scale-95 active:bg-orange-200"
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
            {!collapsed[stylist.id] && !isFinalized && (
              <div className="px-4 py-3 border-t border-stone-50">
                <textarea
                  value={notes[stylist.id] ?? ''}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [stylist.id]: e.target.value }))}
                  placeholder="Day notes (optional)..."
                  rows={2}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all resize-none"
                />
                {notes[stylist.id] && (
                  <div className="flex justify-end mt-1.5">
                    <button
                      onClick={() => saveNotes(stylist.id)}
                      disabled={savingNotesId === stylist.id}
                      className="text-xs text-[#8B2E4A] font-medium hover:underline disabled:opacity-40"
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
                    ? `Finalized ${formatTime(logEntry.finalizedAt, facilityTimezone)}`
                    : 'Finalized'}
                </p>
                {canWrite && (
                  <button
                    onClick={() => handleUnfinalize(stylist.id)}
                    disabled={unfinalizingId === stylist.id}
                    className="text-xs text-stone-400 hover:text-stone-600 font-medium hover:underline disabled:opacity-40 transition-colors"
                  >
                    {unfinalizingId === stylist.id ? 'Undoing…' : 'Unfinalize'}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      </div>
      )}{/* end body wrapper */}

      {/* Mobile footer bar — pinned above nav bar */}
      {!showWalkIn && canWrite && (
        <div
          className="md:hidden fixed left-0 right-0 bg-white border-t border-stone-100 px-4 flex gap-2 z-40"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 80px)', paddingTop: '8px', paddingBottom: '8px' }}
        >
          <button
            onClick={() => setOcrOpen(true)}
            className="flex-1 flex items-center justify-center gap-2 bg-white text-stone-600 border border-stone-200 rounded-2xl px-4 py-3 hover:bg-stone-50 active:scale-95 transition-all text-sm font-semibold"
            title="Import from photo"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Scan log sheet
          </button>
          <button
            onClick={() => setShowWalkIn(true)}
            className="flex-1 flex items-center justify-center gap-2 bg-[#8B2E4A] text-white rounded-2xl px-4 py-3 hover:bg-[#72253C] active:scale-95 transition-all text-sm font-semibold"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add walk-in
          </button>
        </div>
      )}

      {/* Desktop inline buttons */}
      {!showWalkIn && canWrite && (
        <div className="hidden md:flex gap-2 mt-4">
          <button
            onClick={() => setOcrOpen(true)}
            className="flex-1 flex items-center justify-center gap-2 bg-white text-stone-600 border border-stone-200 rounded-2xl px-4 py-3 shadow-sm hover:bg-stone-50 active:scale-95 transition-all text-sm font-semibold"
            title="Import from photo"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Scan log sheet
          </button>
          <button
            onClick={() => setShowWalkIn(true)}
            className="flex-1 flex items-center justify-center gap-2 bg-[#8B2E4A] text-white rounded-2xl px-4 py-3 hover:bg-[#72253C] active:scale-95 transition-all text-sm font-semibold"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add walk-in
          </button>
        </div>
      )}

      <OcrImportModal
        open={ocrOpen}
        onClose={() => setOcrOpen(false)}
        onImported={() => navigateDate(date)}
        residents={residents}
        stylists={stylists}
        services={services}
        date={date}
      />
    </div>
    </ErrorBoundary>
  )
}
