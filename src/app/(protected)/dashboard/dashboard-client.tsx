'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { BookingModal } from '@/components/calendar/booking-modal'
import { QuickBookFAB } from '@/components/calendar/quick-book-fab'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { ResidentsPanel } from '@/components/panels/residents-panel'
import { ServicesPanel } from '@/components/panels/services-panel'
import { StylistsPanel } from '@/components/panels/stylists-panel'
import { cn, formatCents, formatTime } from '@/lib/utils'
import { formatDateInTz, getLocalParts } from '@/lib/time'
import { buildCategoryPriority, sortCategoryGroups, sortServicesWithinCategory } from '@/lib/service-sort'
import type { Resident, Stylist, Service, Facility, CoverageRequest } from '@/types'
import { Spinner } from '@/components/ui'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { useToast } from '@/components/ui/toast'

const CalendarView = dynamic(() => import('@/components/calendar/calendar-view'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center">
      <Spinner className="text-[#8B2E4A]" />
    </div>
  ),
})

export interface BookingWithRelations {
  id: string
  facilityId: string
  residentId: string
  stylistId: string
  serviceId: string | null
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
  source?: string | null
  importBatch?: { fileName: string } | null
  tipCents: number | null
  resident: Resident
  stylist: Stylist
  service: Service | null
}

type PanelTab = 'residents' | 'services' | 'stylists'
type CalendarViewType = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth'

interface WorkingTodayRow {
  id: string
  name: string
  color: string
  startTime: string
  endTime: string
}

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
  openCoverageRequests?: CoverageRequest[]
  workingToday?: WorkingTodayRow[]
  workingTomorrow?: Array<{ name: string }>
}

function formatHHMM(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const hour = h % 12 || 12
  return `${hour}:${m.toString().padStart(2, '0')}${ampm}`
}

const TODAY_CARD_BASE = 'shrink-0 rounded-2xl text-white shadow-[var(--shadow-md)] transition-all duration-200 ease-out'
const TODAY_CARD_GRADIENT = { background: 'linear-gradient(135deg, #8B2E4A 0%, #6B2238 100%)' }

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
  openCoverageRequests = [],
  workingToday = [],
  workingTomorrow = [],
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
  const sortedLocalServices = useMemo(() => {
    const priority = buildCategoryPriority(facility.serviceCategoryOrder)
    const groups = new Map<string, Service[]>()
    for (const s of localServices) {
      const cat = s.category ?? 'Other'
      if (!groups.has(cat)) groups.set(cat, [])
      groups.get(cat)!.push(s)
    }
    const sorted = sortCategoryGroups([...groups.entries()], priority)
    return sorted.flatMap(([, items]) => sortServicesWithinCategory(items))
  }, [localServices, facility.serviceCategoryOrder])
  const [coverageQueue, setCoverageQueue] = useState<CoverageRequest[]>(openCoverageRequests)
  const openCoverageCount = coverageQueue.length


  const isMobile = useIsMobile()
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Handle `?new=1` from TopBar "New Booking" button — opens modal, strips param.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setEditBookingId(null)
      setModalStart(null)
      setModalEnd(null)
      setModalOpen(true)
      router.replace('/dashboard')
    }
  }, [searchParams, router])

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
  const gotoDateRef = useRef<((date: Date) => void) | null>(null)
  const [showCalDatePicker, setShowCalDatePicker] = useState(false)
  const [calendarTitle, setCalendarTitle] = useState('')
  const [calendarStartDate, setCalendarStartDate] = useState<string>(() => {
    const p = getLocalParts(new Date(), facility.timezone)
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
  })

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
    // Phase 12F — month default in facility tz, not browser tz
    const p = getLocalParts(new Date(), facility.timezone)
    return `${p.year}-${String(p.month).padStart(2, '0')}`
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
    setEditBookingId(null)
    setModalStart(start)
    setModalEnd(end)
    setModalOpen(true)
  }

  // FAB tap → open BookingModal with next 30-min slot from now.
  // setMinutes/setHours operate on browser-local — fine here because the result is
  // immediately formatted in facility tz by the BookingModal via toDateTimeLocalInTz.
  const openQuickCreate = () => {
    const start = new Date()
    start.setSeconds(0, 0)
    const m = start.getMinutes()
    if (m < 30) {
      start.setMinutes(30)
    } else {
      start.setMinutes(0)
      start.setHours(start.getHours() + 1)
    }
    const end = new Date(start.getTime() + 30 * 60 * 1000)
    openCreateModal(start, end)
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
      // Phase 12F — greeting hour in facility tz, not viewer's
      const h = getLocalParts(new Date(), facility.timezone).hours
      if (h < 12) return 'Good morning'
      if (h < 17) return 'Good afternoon'
      return 'Good evening'
    })()
    const firstName = userName.split(' ')[0] || 'there'
    const todayLabel = formatDateInTz(new Date(), facility.timezone)

    return (
      <ErrorBoundary>
        <div className="flex flex-col min-h-screen pb-24" style={{ backgroundColor: 'var(--color-bg)' }}>
          {/* Header */}
          <div className="px-4 pt-6 pb-4">
            <p className="text-xs text-stone-400 font-medium uppercase tracking-wide">{todayLabel}</p>
            <h1 className="text-2xl font-normal text-stone-900 mt-0.5" style={{ fontFamily: "'DM Serif Display', serif" }}>
              {greeting}, {firstName}
            </h1>
          </div>

          {/* Today's appointments */}
          <div className="px-4 space-y-2">
            {loadingBookings && (
              <div className="flex items-center justify-center py-10">
                <Spinner className="text-[#8B2E4A]" />
              </div>
            )}
            {!loadingBookings && myTodayBookings.length === 0 && (
              <div className="bg-white rounded-2xl border border-stone-100 p-6 text-center">
                <p className="text-stone-500 text-sm">No appointments today</p>
              </div>
            )}
            {myTodayBookings.map((b) => {
              const time = formatTime(b.startTime, facility.timezone)
              const isDone = b.status === 'completed'
              return (
                <div key={b.id} className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#8B2E4A] mb-0.5">{time}</p>
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
              className="w-full py-3 text-sm font-medium text-[#8B2E4A] bg-white rounded-2xl border border-stone-200 active:scale-[0.98] active:opacity-70 transition-all duration-75"
            >
              View Full Calendar →
            </button>
          </div>

          <QuickBookFAB onOpen={openQuickCreate} />
        </div>
      </ErrorBoundary>
    )
  }

  const bottomZoneContent = (
    <div className="h-full flex flex-col gap-3 scroll-smooth" style={{ overscrollBehavior: 'contain' }}>
      {/* Tabs */}
      <div className="bg-white rounded-xl border border-stone-200 p-0.5 flex gap-0.5 shrink-0 shadow-[var(--shadow-sm)]">
        {(['residents', 'services', 'stylists'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActivePanel(tab)}
            className={cn(
              'flex-1 h-8 text-xs font-medium rounded-lg transition-all duration-150 capitalize active:scale-95',
              activePanel === tab
                ? 'bg-stone-900 text-white shadow-sm'
                : 'text-stone-600 hover:bg-stone-50'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab list white card */}
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
              services={sortedLocalServices}
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
      </div>
    </div>
  )

  return (
    <ErrorBoundary>
    <div className="flex h-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* ── Calendar column ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden p-3 md:p-4 gap-3">
        {/* Admin: pending access requests banner */}
        {isAdmin && pendingRequestsCount > 0 && (
          <div className="shrink-0 px-4 py-2.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between">
            <p className="text-sm text-amber-800">
              <span className="font-semibold">{pendingRequestsCount}</span> access request{pendingRequestsCount > 1 ? 's' : ''} pending
            </p>
            <a
              href="/settings?section=team"
              className="text-xs font-semibold text-amber-700 underline hover:text-amber-900"
            >
              Review
            </a>
          </div>
        )}
        {/* Admin: open coverage requests banner */}
        {isAdmin && openCoverageCount > 0 && (
          <div className="shrink-0 px-4 py-2.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between">
            <p className="text-sm text-amber-800">
              <span className="font-semibold">{openCoverageCount}</span> open coverage request{openCoverageCount > 1 ? 's' : ''} need attention
            </p>
            <button
              type="button"
              onClick={() => document.getElementById('coverage-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="text-xs font-semibold text-amber-700 underline hover:text-amber-900"
            >
              View
            </button>
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
              <div className="relative ml-1 flex items-center">
                <button
                  onClick={() => setShowCalDatePicker(v => !v)}
                  className="flex items-center gap-1 text-sm font-medium text-stone-700 hover:text-stone-900 cursor-pointer transition-colors"
                  aria-label="Jump to date"
                  title="Jump to date"
                >
                  <span className="truncate">{calendarTitle}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400 shrink-0">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                </button>
                {showCalDatePicker && (
                  <input
                    type="date"
                    autoFocus
                    className="absolute top-full left-0 mt-1 z-50 rounded-xl border border-stone-200 shadow-lg bg-white px-3 py-2 text-sm text-stone-700"
                    value={calendarStartDate}
                    onChange={(e) => {
                      if (!e.target.value) return
                      gotoDateRef.current?.(new Date(e.target.value + 'T12:00:00'))
                      setShowCalDatePicker(false)
                    }}
                    onBlur={() => setShowCalDatePicker(false)}
                  />
                )}
              </div>
            </div>
            {/* Right: view switcher + export */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="inline-flex h-9 rounded-xl border border-stone-200 bg-white p-0.5 shadow-[var(--shadow-sm)]">
                {(['timeGridDay', 'timeGridWeek', 'dayGridMonth'] as const).map((view) => (
                  <button
                    key={view}
                    onClick={() => switchView(view)}
                    className={cn(
                      'h-8 px-3 text-sm font-medium rounded-lg transition-all duration-150 active:scale-95',
                      calendarView === view
                        ? 'bg-stone-900 text-white shadow-sm'
                        : 'text-stone-600 hover:bg-stone-50'
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
            facilityTimezone={facility.timezone}
            onChangeViewRef={changeViewRef}
            onPrevRef={prevRef}
            onNextRef={nextRef}
            onTodayRef={todayRef}
            onGotoDateRef={gotoDateRef}
            onTitleChange={setCalendarTitle}
            onDatesSet={(start, end) => {
              fetchBookings(start, end)
              setCalendarStartDate(start.toISOString().split('T')[0])
            }}
            onSelectSlot={openCreateModal}
            onEventClick={openEditModal}
          />
        </div>
      </div>

      {/* ── Right panel — hidden on mobile ── */}
      <div
        className="hidden md:flex w-80 shrink-0 flex-col h-full border-l border-stone-100 p-4 pl-3 gap-3"
        style={{ backgroundColor: 'var(--color-panel-bg)' }}
      >
        {/* Pinned top — admin-only */}
        {isAdmin && (
          <>
            <TodayCard
              date={new Date()}
              todayBookings={todayBookings}
              todayRevenue={todayRevenue}
              size="medium"
              facilityTimezone={facility.timezone}
            />

            {(workingToday.length > 0 || workingTomorrow.length > 0) && (
              <div className="shrink-0 bg-white rounded-2xl border border-stone-100 px-4 py-3 shadow-sm">
                <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide mb-2">
                  Who&apos;s Working Today
                </p>
                {workingToday.length > 0 ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                    {workingToday.map((s) => (
                      <div key={s.id} className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: s.color }}
                        />
                        <span className="text-[12px] font-medium text-stone-700 truncate">
                          {s.name.split(' ')[0]}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-stone-400 italic">No stylists today</p>
                )}
                {workingTomorrow.length > 0 && (
                  <p className="text-[11px] text-stone-400 mt-2 pt-1.5 border-t border-stone-50 truncate">
                    <span className="font-medium">Tomorrow:</span>{' '}
                    {workingTomorrow.map((s) => s.name.split(' ')[0]).join(', ')}
                  </p>
                )}
              </div>
            )}

            {coverageQueue.length > 0 && (
              <div id="coverage-queue" className="shrink-0 bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b border-stone-100">
                  <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">
                    Coverage Requests
                  </p>
                </div>
                <ul className="max-h-[160px] overflow-y-auto divide-y divide-stone-100">
                  {coverageQueue.map((r) => (
                    <CoverageQueueRow
                      key={r.id}
                      request={r}
                      stylists={stylists.filter((s) => s.id !== r.stylistId)}
                      onAssigned={(id) => setCoverageQueue((prev) => prev.filter((x) => x.id !== id))}
                    />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* Scrollable middle — tabs + list */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {bottomZoneContent}
        </div>

        {/* Stats tiles — pinned at bottom */}
        <div className="shrink-0 rounded-2xl border border-stone-100 bg-stone-50/70 px-3 py-3 shadow-sm">
          {isAdmin && periodStats ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white border border-stone-200 px-3 py-2">
                <p className="text-[10px] text-stone-400 uppercase tracking-wide font-medium">This week</p>
                <p className="text-sm font-semibold text-stone-800 mt-0.5">{formatCents(periodStats.thisWeek.revenueCents)}</p>
              </div>
              <div className="rounded-xl bg-white border border-stone-200 px-3 py-2">
                <p className="text-[10px] text-stone-400 uppercase tracking-wide font-medium">This month</p>
                <p className="text-sm font-semibold text-stone-800 mt-0.5">{formatCents(periodStats.thisMonth.revenueCents)}</p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-white border border-stone-200 px-3 py-2">
              <p className="text-[10px] text-stone-400 uppercase tracking-wide font-medium">Today</p>
              <p className="text-sm font-semibold text-stone-800 mt-0.5">{todayBookings.length} appointments</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Book FAB — mobile only */}
      <QuickBookFAB onOpen={openQuickCreate} />

      {/* Booking Modal */}
      <BookingModal
        open={modalOpen}
        onClose={closeModal}
        mode={editBookingId ? 'edit' : 'create'}
        booking={editBooking}
        defaultStart={modalStart}
        defaultEnd={modalEnd}
        residents={residents}
        services={localServices}
        facilityId={facility.id}
        facilityTimezone={facility.timezone}
        onBookingChange={handleBookingChange}
        onBookingDeleted={handleBookingDeleted}
        isAdmin={isAdmin}
        serviceCategoryOrder={facility.serviceCategoryOrder}
      />
    </div>
    </ErrorBoundary>
  )
}

function CoverageQueueRow({
  request,
  onAssigned,
}: {
  request: CoverageRequest
  stylists: Stylist[]
  onAssigned: (id: string) => void
}) {
  const [substituteId, setSubstituteId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [facilityPool, setFacilityPool] = useState<Array<{ id: string; name: string; stylistCode: string }>>([])
  const [franchisePool, setFranchisePool] = useState<Array<{ id: string; name: string; stylistCode: string }>>([])

  useEffect(() => {
    fetch(`/api/coverage/substitutes?date=${request.startDate}`)
      .then((r) => r.json())
      .then((j) => {
        setFacilityPool(j?.data?.facilityStylists ?? [])
        setFranchisePool(j?.data?.franchiseStylists ?? [])
      })
      .catch(() => {})
  }, [request.startDate])

  const dateLabel = (() => {
    const fmt = (iso: string) => {
      const [y, m, d] = iso.split('-').map((v) => Number(v))
      const dt = new Date(y, m - 1, d)
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
    if (request.startDate === request.endDate) {
      const [y, m, d] = request.startDate.split('-').map((v) => Number(v))
      const dt = new Date(y, m - 1, d)
      return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    }
    return `${fmt(request.startDate)} – ${fmt(request.endDate)}`
  })()

  async function handleAssign() {
    if (!substituteId || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/coverage/${request.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'filled', substituteStylistId: substituteId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? 'Failed to assign')
        setSaving(false)
        return
      }
      onAssigned(request.id)
    } catch {
      setError('Network error')
      setSaving(false)
    }
  }

  return (
    <li className="px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-900 truncate">
            {request.stylist?.name ?? 'Stylist'}
          </p>
          <p className="text-xs text-stone-500">{dateLabel}</p>
        </div>
      </div>
      {request.reason && (
        <p className="text-xs text-stone-500 line-clamp-2">{request.reason}</p>
      )}
      <div className="flex items-center gap-2">
        <select
          value={substituteId}
          onChange={(e) => setSubstituteId(e.target.value)}
          className="flex-1 min-w-0 text-xs rounded-lg border border-stone-200 px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20"
          disabled={saving}
        >
          <option value="">Pick substitute…</option>
          {facilityPool.length > 0 && (
            <optgroup label="This Facility">
              {facilityPool.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.stylistCode})
                </option>
              ))}
            </optgroup>
          )}
          {franchisePool.length > 0 && (
            <optgroup label="Franchise Pool">
              {franchisePool.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.stylistCode})
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          type="button"
          onClick={handleAssign}
          disabled={!substituteId || saving}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#8B2E4A] text-white hover:bg-[#72253C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? '…' : 'Assign'}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </li>
  )
}

function TodayCard({
  date,
  todayBookings,
  todayRevenue,
  size,
  facilityTimezone,
}: {
  date: Date
  todayBookings: BookingWithRelations[]
  todayRevenue: number
  size: 'tall' | 'medium' | 'compact'
  facilityTimezone: string
}) {
  const completedCount = todayBookings.filter((b) => b.status === 'completed').length
  const pendingCount = todayBookings.filter((b) => b.status !== 'completed').length
  // Phase 12F — facility-tz dates so "today" matches the facility's clock
  const longDate = formatDateInTz(date, facilityTimezone, { weekday: 'long', month: 'short', day: 'numeric' })
  const shortDate = formatDateInTz(date, facilityTimezone, { weekday: undefined, month: 'short', day: 'numeric' })

  const isTall = size === 'tall'

  if (size === 'compact') {
    return (
      <div
        className={cn(TODAY_CARD_BASE, 'px-4 py-2.5 flex flex-row items-center justify-between gap-3')}
        style={TODAY_CARD_GRADIENT}
      >
        <div className="min-w-0">
          <div
            className="text-3xl leading-none"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            {todayBookings.length}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-white/60 font-medium mt-1">
            today
          </div>
        </div>
        <div className="text-right min-w-0">
          <div className="text-sm font-medium text-white/90 truncate">{shortDate}</div>
          <div className="text-[11px] text-white/60 mt-0.5">
            {pendingCount} pending
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(TODAY_CARD_BASE, 'p-5 flex flex-col')} style={TODAY_CARD_GRADIENT}>
      <div className="text-[11px] uppercase tracking-[0.12em] text-white/70 font-medium">Today</div>
      <div
        className="text-2xl mt-1 leading-tight"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        {longDate}
      </div>
      <div
        className={cn(
          'grid grid-cols-2 gap-2 overflow-hidden transition-all duration-200 ease-out',
          isTall
            ? 'opacity-100 scale-100 max-h-40 mt-4'
            : 'opacity-0 scale-95 max-h-0 mt-0 pointer-events-none'
        )}
        aria-hidden={!isTall}
      >
        <div className="rounded-xl bg-white/10 backdrop-blur-sm px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-white/60 font-medium">Bookings</div>
          <div className="text-xl font-semibold mt-0.5">{todayBookings.length}</div>
        </div>
        <div className="rounded-xl bg-white/10 backdrop-blur-sm px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-white/60 font-medium">Completed</div>
          <div className="text-xl font-semibold mt-0.5">{completedCount}</div>
        </div>
        <div className="rounded-xl bg-white/10 backdrop-blur-sm px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-white/60 font-medium">Revenue</div>
          <div className="text-xl font-semibold mt-0.5">{formatCents(todayRevenue)}</div>
        </div>
        <div className="rounded-xl bg-white/10 backdrop-blur-sm px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-white/60 font-medium">Pending</div>
          <div className="text-xl font-semibold mt-0.5">{pendingCount}</div>
        </div>
      </div>
      <div
        className={cn(
          'text-sm text-white/80 overflow-hidden transition-all duration-200 ease-out',
          isTall
            ? 'opacity-0 max-h-0 mt-0 pointer-events-none'
            : 'opacity-100 max-h-10 mt-2'
        )}
        aria-hidden={isTall}
      >
        {todayBookings.length} today · {pendingCount} pending
      </div>
    </div>
  )
}
