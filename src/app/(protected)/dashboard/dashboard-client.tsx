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
  startTime: string
  endTime: string
  priceCents: number | null
  durationMinutes: number | null
  notes: string | null
  status: string
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
}

export function DashboardClient({
  facilityId,
  facility,
  initialResidents,
  initialStylists,
  initialServices,
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

  // Ref for programmatic calendar view changes
  const changeViewRef = useRef<((view: CalendarViewType) => void) | null>(null)

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

  return (
    <ErrorBoundary>
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* ── Calendar column ── */}
      <div className="flex-1 flex flex-col min-w-0 p-3 md:p-4 gap-3">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <h1
            className="text-base md:text-lg font-bold text-stone-900"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            {facility.name}
          </h1>
          <div className="flex items-center gap-2">
            {/* Export billing */}
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
                {exporting ? 'Exporting…' : 'Export'}
              </button>
            </div>
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
          </div>
        </div>

        {/* Calendar card */}
        <div className={cn('flex-1 bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden min-h-0', calendarFlash && 'calendar-booking-flash')}>
          <CalendarView
            bookings={bookings}
            currentView={calendarView}
            onChangeViewRef={changeViewRef}
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
              />
            )}
            {activePanel === 'services' && (
              <ServicesPanel
                services={localServices}
                onServiceAdded={(s) => setLocalServices((prev) => [...prev, s])}
                onServiceUpdated={(s) =>
                  setLocalServices((prev) => prev.map((x) => (x.id === s.id ? s : x)))
                }
              />
            )}
            {activePanel === 'stylists' && (
              <StylistsPanel
                stylists={stylists}
                onStylistAdded={(s) => setStylists((prev) => [...prev, s])}
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
                <div className="text-right">
                  <p className="text-xl font-bold text-[#0D7377]">{formatCents(todayRevenue)}</p>
                  <p className="text-xs text-stone-400">revenue</p>
                </div>
              </div>
            </div>

            {/* Week + Month */}
            {periodStats && (
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
      />
    </div>
    </ErrorBoundary>
  )
}
