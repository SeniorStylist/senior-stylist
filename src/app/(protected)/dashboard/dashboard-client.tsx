'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { BookingModal } from '@/components/calendar/booking-modal'
import { QuickBookFAB } from '@/components/calendar/quick-book-fab'
import type { QuickBookFABHandle } from '@/components/calendar/quick-book-fab'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { ResidentsPanel } from '@/components/panels/residents-panel'
import { ServicesPanel } from '@/components/panels/services-panel'
import { StylistsPanel } from '@/components/panels/stylists-panel'
import { cn, formatCents } from '@/lib/utils'
import type { Resident, Stylist, Service, Facility } from '@/types'
import { Spinner } from '@/components/ui'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { useToast } from '@/components/ui/toast'

const CalendarView = dynamic(() => import('@/components/calendar/calendar-view'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center">
      <Spinner className="text-[#0D7377]" />
    </div>
  ),
})

export interface BookingWithRelations {
  id: string
  facilityId: string
  residentId: string
  stylistId: string
  serviceId: string
  serviceIds: string[] | null
  serviceNames: string[] | null
  totalDurationMinutes: number | null
  addonServiceIds: string[] | null
  addonTotalCents: number | null
  selectedQuantity: number | null
  selectedOption: string | null
  startTime: string
  endTime: string
  priceCents: number | null
  durationMinutes: number | null
  notes: string | null
  status: string
  paymentStatus: string
  cancellationReason: string | null
  recurring?: boolean
  recurringRule?: string | null
  recurringEndDate?: string | null
  recurringParentId?: string | null
  googleEventId: string | null
  syncError: string | null
  resident: Resident
  stylist: Stylist
  service: Service
}

type PanelTab = 'residents' | 'services' | 'stylists'
type CalendarViewType = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth'

interface DashboardClientProps {
  facilityId: string
  facility: Facility
  initialResidents: Resident[]
  initialStylists: Stylist[]
  initialServices: Service[]
  isAdmin?: boolean
  userRole?: string
  userName?: string
  pendingRequestsCount?: number
  profileStylistId?: string | null
}

export function DashboardClient({
  facilityId,
  facility,
  initialResidents,
  initialStylists,
  initialServices,
  isAdmin = true,
  userRole = 'admin',
  userName = '',
  pendingRequestsCount = 0,
  profileStylistId = null,
}: DashboardClientProps) {
  const [bookings, setBookings] = useState<BookingWithRelations[]>([])
  const [loadingBookings, setLoadingBookings] = useState(false)
  const [activePanel, setActivePanel] = useState<PanelTab>('residents')
  const [calendarView, setCalendarView] = useState<CalendarViewType>(
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'timeGridDay' : 'timeGridWeek'
  )

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editBookingId, setEditBookingId] = useState<string | null>(null)
  const [modalStart, setModalStart] = useState<Date | null>(null)
  const [modalEnd, setModalEnd] = useState<Date | null>(null)

  // Local data (mutable without full reload)
  const [residents, setResidents] = useState<Resident[]>(initialResidents)
  const [stylists, setStylists] = useState<Stylist[]>(initialStylists)
  const [localServices, setLocalServices] = useState<Service[]>(initialServices)

  const isMobile = useIsMobile()
  const { toast } = useToast()

  // Stylist mobile list mode
  const [stylistListMode, setStylistListMode] = useState(false)
  useEffect(() => {
    if (isMobile && userRole === 'stylist') {
      setStylistListMode(true)
      // Fetch today's appointments immediately
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const end = new Date(); end.setHours(23, 59, 59, 999)
      fetchBookings(start, end)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, userRole])

  // Ref for programmatic calendar view changes
  const changeViewRef = useRef<((view: CalendarViewType) => void) | null>(null)

  // Refs for custom calendar nav controls
  const prevRef = useRef<(() => void) | null>(null)
  const nextRef = useRef<(() => void) | null>(null)
  const todayRef = useRef<(() => void) | null>(null)
  const [calendarTitle, setCalendarTitle] = useState('')

  // Ref for QuickBook FAB imperative control
  const fabRef = useRef<QuickBookFABHandle>(null)

  // Period stats (week + month)
  const [periodStats, setPeriodStats] = useState<{
    thisWeek: { revenueCents: number }
    thisMonth: { revenueCents: number }
  } | null>(null)

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then((json) => { if (json.data) setPeriodStats(json.data) })
      .catch(console.error)
  }, [])

  // Export
  const [exportMonth, setExportMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await fetch(`/api/export/billing?month=${exportMonth}`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `billing-${exportMonth}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast('Export ready', 'success')
    } finally {
      setExporting(false)
    }
  }

  const fetchBookings = useCallback(async (start: Date, end: Date) => {
    setLoadingBookings(true)
    try {
      const res = await fetch(
        `/api/bookings?start=${start.toISOString()}&end=${end.toISOString()}`
      )
      const json = await res.json()
      if (json.data) setBookings(json.data)
    } catch (err) {
      console.error('Failed to fetch bookings:', err)
    } finally {
      setLoadingBookings(false)
    }
  }, [])

  const openCreateModal = (start: Date, end: Date) => {
    if (isMobile && fabRef.current) {
      const pad = (n: number) => n.toString().padStart(2, '0')
      const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
      const time = `${pad(start.getHours())}:${pad(start.getMinutes())}`
      fabRef.current.openWithSlot({ date, time })
      return
    }
    setEditBookingId(null)
    setModalStart(start)
    setModalEnd(end)
    setModalOpen(true)
  }

  const openEditModal = (bookingId: string) => {
    setEditBookingId(bookingId)
    setModalStart(null)
    setModalEnd(null)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditBookingId(null)
    setModalStart(null)
    setModalEnd(null)
  }

  const handleBookingChange = (updated: BookingWithRelations) => {
    setBookings((prev) => {
      const idx = prev.findIndex((b) => b.id === updated.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = updated
        return next
      }
      return [...prev, updated]
    })
    setCalendarFlash(true)
    setTimeout(() => setCalendarFlash(false), 750)
  }

  const handleBookingDeleted = (bookingId: string) => {
    setBookings((prev) => prev.filter((b) => b.id !== bookingId))
  }

  const handleMarkDone = async (bookingId: string) => {
    // Optimistic update
    setBookings((prev) => prev.map((b) => b.id === bookingId ? { ...b, status: 'completed' } : b))
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      if (!res.ok) throw new Error('Failed')
    } catch {
      // Revert on failure
      setBookings((prev) => prev.map((b) => b.id === bookingId ? { ...b, status: 'scheduled' } : b))
      toast('Failed to mark done', 'error')
    }
  }

  const switchView = (view: CalendarViewType) => {
    setCalendarView(view)
    changeViewRef.current?.(view)
  }

  // Today's stats
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)
  const todayBookings = bookings.filter((b) => {
    const start = new Date(b.startTime)
    return (
      start >= todayStart &&
      start <= todayEnd &&
      b.status !== 'cancelled' &&
      b.status !== 'no_show'
    )
  })
  const todayRevenue = todayBookings.reduce((sum, b) => sum + (b.priceCents ?? 0), 0)

  const editBooking = editBookingId
    ? (bookings.find((b) => b.id === editBookingId) ?? null)
    : null

  const [calendarFlash, setCalendarFlash] = useState(false)

  // Stylist's own bookings for mobile today-list
  const myTodayBookings = profileStylistId
    ? todayBookings.filter((b) => b.stylistId === profileStylistId)
    : todayBookings

  // Stylist mobile today-list view
  if (stylistListMode) {
    const greeting = (() => {
      const h = new Date().getHours()
      if (h < 12) return 'Good morning'
      if (h < 17) return 'Good afternoon'
      return 'Good evening'
    })()
    const firstName = userName.split(' ')[0] || 'there'
    const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

    return (
      <ErrorBoundary>
        <div className="flex flex-col min-h-screen pb-24" style={{ backgroundColor: 'var(--color-bg)' }}>
          {/* Header */}
          <div className="px-4 pt-6 pb-4">
            <p className="text-xs text-stone-400 font-medium uppercase tracking-wide">{todayLabel}</p>
            <h1 className="text-2xl font-bold text-stone-900 mt-0.5" style={{ fontFamily: "'DM Serif Display', serif" }}>
              {greeting}, {firstName}
            </h1>
          </div>

          {/* Today's appointments */}
          <div className="px-4 space-y-2">
            {loadingBookings && (
              <div className="flex items-center justify-center py-10">
                <Spinner className="text-[#0D7377]" />
              </div>
            )}
            {!loadingBookings && myTodayBookings.length === 0 && (
              <div className="bg-white rounded-2xl border border-stone-100 p-6 text-center">
                <p className="text-stone-500 text-sm">No appointments today</p>
              </div>
            )}
            {myTodayBookings.map((b) => {
              const time = new Date(b.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
              const isDone = b.status === 'completed'
              return (
                <div key={b.id} className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#0D7377] mb-0.5">{time}</p>
                    <p className="text-sm font-semibold text-stone-900 truncate">{b.resident?.name ?? '—'}</p>
                    <p className="text-xs text-stone-400 truncate">{b.service?.name ?? '—'}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn(
                      'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                      isDone ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-600'
                    )}>
                      {isDone ? 'Done' : 'Scheduled'}
                    </span>
                    {!isDone && (
                      <button
                        onClick={() => handleMarkDone(b.id)}
                        className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center active:bg-green-500 active:text-white active:scale-95 transition-all duration-75"
                        title="Mark done"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* View full calendar */}
          <div className="px-4 mt-4">
            <button
              onClick={() => setStylistListMode(false)}
              className="w-full py-3 text-sm font-medium text-[#0D7377] bg-white rounded-2xl border border-stone-200 active:scale-[0.98] active:opacity-70 transition-all duration-75"
            >
              View Full Calendar →
            </button>
          </div>

          <QuickBookFAB
            ref={fabRef}
            residents={residents}
            services={localServices}
            stylists={stylists}
            onBookingCreated={handleBookingChange}
          />
        </div>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* ── Calendar column ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden p-3 md:p-4 gap-3">
        {/* Admin: pending access requests banner */}
        {isAdmin && pendingRequestsCount > 0 && (
          <div className="shrink-0 px-4 py-2.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between">
            <p className="text-sm text-amber-800">
              <span className="font-semibold">{pendingRequestsCount}</span> access request{pendingRequestsCount > 1 ? 's' : ''} pending
            </p>
            <a
              href="/settings?tab=access-requests"
              className="text-xs font-semibold text-amber-700 underline hover:text-amber-900"
            >
              Review
            </a>
          </div>
        )}
        {/* Header */}
        <div className="shrink-0">
          <p className="text-sm font-semibold text-stone-700 mb-2">{facility.name}</p>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* Left: nav controls + date range */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => prevRef.current?.()}
                className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors"
                aria-label="Previous"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button
                onClick={() => nextRef.current?.()}
                className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors"
                aria-label="Next"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <button
                onClick={() => todayRef.current?.()}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-100 transition-colors"
              >
                Today
              </button>
              <span className="ml-1 text-sm font-medium text-stone-700 truncate">
                {calendarTitle}
              </span>
            </div>
            {/* Right: view switcher + export */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1 bg-white rounded-xl border border-stone-200 p-1">
                {(['timeGridDay', 'timeGridWeek', 'dayGridMonth'] as const).map((view) => (
                  <button
                    key={view}
                    onClick={() => switchView(view)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 active:scale-95',
                      calendarView === view
                        ? 'bg-[#0D7377] text-white'
                        : 'text-stone-600 hover:bg-stone-100'
                    )}
                  >
                    {view === 'timeGridDay' ? 'Day' : view === 'timeGridWeek' ? 'Week' : 'Month'}
                  </button>
                ))}
              </div>
              {/* Export billing — admin only, desktop only */}
              {isAdmin && (
                <div className="hidden md:flex items-center gap-1 bg-white rounded-xl border border-stone-200 p-1">
                  <input
                    type="month"
                    value={exportMonth}
                    onChange={(e) => setExportMonth(e.target.value)}
                    className="text-xs text-stone-600 px-2 py-1.5 rounded-lg bg-transparent focus:outline-none"
                  />
                  <button
                    onClick={handleExport}
                    disabled={exporting}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 text-stone-600 hover:bg-stone-100 disabled:opacity-50"
                    title="Export billing CSV"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    <span className="hidden lg:inline">{exporting ? 'Exporting…' : 'Export'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Calendar card */}
        <div className={cn('flex-1 bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden min-h-0', calendarFlash && 'calendar-booking-flash')}>
          <CalendarView
            bookings={bookings}
            services={localServices}
            currentView={calendarView}
            onChangeViewRef={changeViewRef}
            onPrevRef={prevRef}
            onNextRef={nextRef}
            onTodayRef={todayRef}
            onTitleChange={setCalendarTitle}
            onDatesSet={fetchBookings}
            onSelectSlot={openCreateModal}
            onEventClick={openEditModal}
          />
        </div>
      </div>

      {/* ── Right panel — hidden on mobile ── */}
      <div className="hidden md:flex w-[300px] shrink-0 flex-col h-screen p-4 pl-0 gap-3">
        {/* Tabs */}
        <div className="bg-white rounded-xl border border-stone-200 p-1 flex gap-1 shrink-0">
          {(['residents', 'services', 'stylists'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActivePanel(tab)}
              className={cn(
                'flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 capitalize active:scale-95',
                activePanel === tab
                  ? 'bg-[#0D7377] text-white'
                  : 'text-stone-600 hover:bg-stone-100'
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Panel + stats */}
        <div className="flex-1 bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden flex flex-col min-h-0">
          <div className="flex-1 overflow-hidden min-h-0">
            {activePanel === 'residents' && (
              <ResidentsPanel
                residents={residents}
                onResidentAdded={(r) => setResidents((prev) => [r, ...prev])}
                isAdmin={isAdmin}
              />
            )}
            {activePanel === 'services' && (
              <ServicesPanel
                services={localServices}
                onServiceAdded={(s) => setLocalServices((prev) => [...prev, s])}
                onServiceUpdated={(s) =>
                  setLocalServices((prev) => prev.map((x) => (x.id === s.id ? s : x)))
                }
                isAdmin={isAdmin}
              />
            )}
            {activePanel === 'stylists' && (
              <StylistsPanel
                stylists={stylists}
                onStylistAdded={(s) => setStylists((prev) => [...prev, s])}
                isAdmin={isAdmin}
              />
            )}
          </div>

          {/* Stats footer */}
          <div className="shrink-0 border-t border-stone-100 px-4 py-3 bg-stone-50 rounded-b-2xl space-y-2.5">
            {/* Today */}
            <div>
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1.5">
                Today
              </p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xl font-bold text-stone-900">{todayBookings.length}</p>
                  <p className="text-xs text-stone-400">appointments</p>
                </div>
                {isAdmin && (
                  <div className="text-right">
                    <p className="text-xl font-bold text-[#0D7377]">{formatCents(todayRevenue)}</p>
                    <p className="text-xs text-stone-400">revenue</p>
                  </div>
                )}
              </div>
            </div>

            {/* Week + Month */}
            {isAdmin && periodStats && (
              <div className="border-t border-stone-100 pt-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-stone-400">This week</p>
                  <p className="text-xs font-semibold text-stone-700">
                    {formatCents(periodStats.thisWeek.revenueCents)}
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-stone-400">This month</p>
                  <p className="text-xs font-semibold text-stone-700">
                    {formatCents(periodStats.thisMonth.revenueCents)}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Book FAB — mobile only */}
      <QuickBookFAB
        ref={fabRef}
        residents={residents}
        services={localServices}
        stylists={stylists}
        onBookingCreated={handleBookingChange}
      />

      {/* Booking Modal */}
      <BookingModal
        open={modalOpen}
        onClose={closeModal}
        mode={editBookingId ? 'edit' : 'create'}
        booking={editBooking}
        defaultStart={modalStart}
        defaultEnd={modalEnd}
        residents={residents}
        stylists={stylists}
        services={localServices}
        onBookingChange={handleBookingChange}
        onBookingDeleted={handleBookingDeleted}
        isAdmin={isAdmin}
      />
    </div>
    </ErrorBoundary>
  )
}
