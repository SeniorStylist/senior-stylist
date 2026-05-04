'use client'

import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import { useRef, useEffect } from 'react'
import { formatCents } from '@/lib/utils'
import type { Resident, Stylist, Service } from '@/types'

interface BookingForCalendar {
  id: string
  startTime: string
  endTime: string
  status: string
  priceCents: number | null
  recurring?: boolean
  serviceNames?: string[] | null
  addonServiceIds?: string[] | null
  source?: string | null
  importBatch?: { fileName: string } | null
  resident: Resident
  stylist: Stylist
  service: Service | null
}

function HistoricalBadge({ fileName }: { fileName?: string | null }) {
  return (
    <span
      title={fileName ? `Historical record — imported from ${fileName}` : 'Historical record'}
      className="inline-flex items-center justify-center w-3.5 h-3.5 mr-0.5 rounded text-[8px] font-bold bg-white/30 text-white align-middle"
    >
      H
    </span>
  )
}

type CalendarViewType = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth'

interface CalendarViewProps {
  bookings: BookingForCalendar[]
  services?: Service[]
  currentView: CalendarViewType
  // Phase 12F: facility's IANA timezone — drives FullCalendar grid axis labels
  // and block positioning. Without this, FullCalendar falls back to browser-local.
  facilityTimezone: string
  onChangeViewRef: React.MutableRefObject<((view: CalendarViewType) => void) | null>
  onPrevRef: React.MutableRefObject<(() => void) | null>
  onNextRef: React.MutableRefObject<(() => void) | null>
  onTodayRef: React.MutableRefObject<(() => void) | null>
  onTitleChange: (title: string) => void
  onDatesSet: (start: Date, end: Date) => void
  onSelectSlot: (start: Date, end: Date) => void
  onEventClick: (bookingId: string) => void
}

export default function CalendarView({
  bookings,
  services = [],
  currentView,
  facilityTimezone,
  onChangeViewRef,
  onPrevRef,
  onNextRef,
  onTodayRef,
  onTitleChange,
  onDatesSet,
  onSelectSlot,
  onEventClick,
}: CalendarViewProps) {
  const fcRef = useRef<FullCalendar>(null)

  // Expose changeView + nav to parent via refs
  useEffect(() => {
    onChangeViewRef.current = (view: CalendarViewType) => {
      fcRef.current?.getApi().changeView(view)
    }
    onPrevRef.current = () => { fcRef.current?.getApi().prev() }
    onNextRef.current = () => { fcRef.current?.getApi().next() }
    onTodayRef.current = () => { fcRef.current?.getApi().today() }
  })

  const events = bookings
    .filter((b) => b.status !== 'cancelled')
    .map((booking) => ({
      id: booking.id,
      title: booking.resident?.name ?? '',
      start: booking.startTime,
      end: booking.endTime,
      backgroundColor: booking.stylist?.color ?? '#0D7377',
      borderColor: booking.stylist?.color ?? '#0D7377',
      textColor: '#ffffff',
      extendedProps: { booking },
    }))

  return (
    <div className="h-full p-3">
      <FullCalendar
        ref={fcRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
        timeZone={facilityTimezone}
        initialView={currentView}
        selectMirror={false}
        unselectAuto={true}
        selectable={true}
        allDaySlot={false}
        nowIndicator={true}
        expandRows={true}
        height="100%"
        slotMinTime="07:00:00"
        slotMaxTime="20:00:00"
        slotDuration="00:30:00"
        eventMinHeight={64}
        slotLabelInterval="01:00:00"
        scrollTime="08:00:00"
        headerToolbar={false}
        events={events}
        datesSet={(dateInfo) => {
          onDatesSet(dateInfo.start, dateInfo.end)
          onTitleChange(fcRef.current?.getApi().view.title ?? '')
        }}
        select={(arg) => {
          fcRef.current?.getApi().unselect()
          onSelectSlot(arg.start, arg.end)
        }}
        dateClick={(arg) => {
          onSelectSlot(arg.date, new Date(arg.date.getTime() + 30 * 60 * 1000))
        }}
        eventClick={(arg) => {
          onEventClick(arg.event.id)
        }}
        eventContent={(arg) => {
          const booking = arg.event.extendedProps.booking as BookingForCalendar
          const view = arg.view.type

          const primaryNames =
            booking.serviceNames && booking.serviceNames.length > 0
              ? booking.serviceNames
              : booking.service?.name
                ? [booking.service.name]
                : []
          const addonNames =
            (booking.addonServiceIds ?? [])
              .map((id) => services.find((s) => s.id === id)?.name)
              .filter((n): n is string => Boolean(n))

          const primaryLabel = primaryNames.join(' + ')
          const fullLabel = [...primaryNames, ...addonNames].join(' + ')

          if (view === 'dayGridMonth') {
            return (
              <div className="px-1 truncate text-xs font-medium leading-tight">
                {booking.recurring && <span className="mr-0.5">↻</span>}
                {booking.source === 'historical_import' && <HistoricalBadge fileName={booking.importBatch?.fileName} />}
                {booking.resident?.name}
              </div>
            )
          }

          if (view === 'timeGridWeek') {
            return (
              <div className="px-1 py-0.5 overflow-hidden">
                <div className="text-xs font-semibold truncate leading-tight">
                  {booking.recurring && <span className="mr-0.5">↻</span>}
                  {booking.resident?.name}
                </div>
                <div className="text-xs opacity-80 truncate leading-tight">
                  {fullLabel || primaryLabel}
                </div>
              </div>
            )
          }

          // timeGridDay
          return (
            <div className="px-1 py-0.5 overflow-hidden">
              <div className="text-xs font-semibold truncate leading-tight">
                {booking.recurring && <span className="mr-0.5">↻</span>}
                {booking.source === 'historical_import' && <HistoricalBadge fileName={booking.importBatch?.fileName} />}
                {booking.resident?.name}
              </div>
              <div className="text-xs opacity-85 truncate leading-tight">
                {fullLabel || primaryLabel}
              </div>
              <div className="text-xs opacity-70 truncate leading-tight">
                {booking.stylist?.name} ·{' '}
                {formatCents(booking.priceCents ?? booking.service?.priceCents ?? 0)}
              </div>
            </div>
          )
        }}
      />
    </div>
  )
}
