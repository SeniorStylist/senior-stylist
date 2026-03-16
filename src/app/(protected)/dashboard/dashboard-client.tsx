'use client'

import { useState, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { BookingModal } from '@/components/calendar/booking-modal'
import { ResidentsPanel } from '@/components/panels/residents-panel'
import { ServicesPanel } from '@/components/panels/services-panel'
import { StylistsPanel } from '@/components/panels/stylists-panel'
import { cn, formatCents } from '@/lib/utils'
import type { Resident, Stylist, Service, Facility } from '@/types'
import { Spinner } from '@/components/ui'

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

  // Ref for programmatic calendar view changes
  const changeViewRef = useRef<((view: CalendarViewType) => void) | null>(null)

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

  return (
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
          <div className="flex items-center gap-1 bg-white rounded-xl border border-stone-200 p-1">
            {(['timeGridDay', 'timeGridWeek', 'dayGridMonth'] as const).map((view) => (
              <button
                key={view}
                onClick={() => switchView(view)}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150',
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

        {/* Calendar card */}
        <div className="flex-1 bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden min-h-0">
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
                'flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 capitalize',
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

          {/* Today's stats footer */}
          <div className="shrink-0 border-t border-stone-100 px-4 py-3 bg-stone-50 rounded-b-2xl">
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">
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
        </div>
      </div>

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
  )
}
