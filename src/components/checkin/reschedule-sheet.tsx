'use client'

import { useMemo, useState } from 'react'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useToast } from '@/components/ui/toast'
import { formatTimeInTz } from '@/lib/time'

export interface RescheduleBooking {
  id: string
  startTime: string
  endTime: string
  status: string
  residentName: string
  serviceName: string
}

interface RescheduleSheetProps {
  open: boolean
  delayMinutes: number
  todayBookings: RescheduleBooking[]
  facilityTimezone: string
  onConfirm: () => void
  onDismiss: () => void
}

export function RescheduleSheet({
  open,
  delayMinutes,
  todayBookings,
  facilityTimezone,
  onConfirm,
  onDismiss,
}: RescheduleSheetProps) {
  const isMobile = useIsMobile()
  const { toast } = useToast()
  const [submitting, setSubmitting] = useState(false)

  const futureBookings = useMemo(() => {
    const nowMs = Date.now()
    return todayBookings.filter(
      (b) => b.status !== 'cancelled' && new Date(b.startTime).getTime() > nowMs,
    )
  }, [todayBookings])

  const allInProgress = futureBookings.length === 0

  async function handleConfirm() {
    if (submitting || futureBookings.length === 0) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/bookings/bulk-reschedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingIds: futureBookings.map((b) => b.id),
          shiftMinutes: delayMinutes,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error?.toString() || 'Failed to reschedule')
      }
      toast.success('Schedule updated')
      onConfirm()
    } catch (err) {
      console.error('Bulk reschedule failed:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to reschedule')
    } finally {
      setSubmitting(false)
    }
  }

  const header = (
    <div>
      <h2
        className="text-2xl font-normal text-stone-900"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        You&apos;re {delayMinutes} {delayMinutes === 1 ? 'minute' : 'minutes'} late
      </h2>
      <p className="text-sm text-stone-500 mt-1">
        {allInProgress
          ? 'All appointments are already in progress — no rescheduling needed.'
          : "Here's your updated schedule — confirm to shift all remaining appointments."}
      </p>
    </div>
  )

  const list = !allInProgress && (
    <div className="mt-4">
      {futureBookings.map((b) => {
        const shifted = new Date(new Date(b.startTime).getTime() + delayMinutes * 60_000)
        return (
          <div
            key={b.id}
            className="flex items-center justify-between py-2 border-b border-stone-100 last:border-b-0"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-stone-900 truncate">
                {b.residentName}
              </div>
              <div className="text-xs text-stone-500 truncate">{b.serviceName}</div>
            </div>
            <div className="text-right ml-3">
              <div className="text-xs text-stone-400 line-through">
                {formatTimeInTz(b.startTime, facilityTimezone)}
              </div>
              <div className="text-sm font-bold text-stone-900">
                {formatTimeInTz(shifted, facilityTimezone)}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )

  const footer = allInProgress ? (
    <div className="flex justify-end p-4">
      <Button variant="primary" onClick={onDismiss}>
        Got it
      </Button>
    </div>
  ) : (
    <div className="flex flex-col gap-2 p-4 sm:flex-row sm:justify-end">
      <Button variant="ghost" onClick={onDismiss} disabled={submitting}>
        Keep original times
      </Button>
      <Button variant="primary" onClick={handleConfirm} disabled={submitting}>
        {submitting ? 'Saving…' : 'Confirm new times'}
      </Button>
    </div>
  )

  if (isMobile) {
    return (
      <BottomSheet
        isOpen={open}
        onClose={onDismiss}
        footer={footer}
      >
        {header}
        {list}
      </BottomSheet>
    )
  }

  return (
    <Modal open={open} onClose={onDismiss} className="w-[480px] max-w-[calc(100vw-2rem)]">
      <div className="p-5">
        {header}
        {list}
      </div>
      {footer}
    </Modal>
  )
}
