'use client'

import { useState } from 'react'
import { useToast } from '@/components/ui/toast'
import { formatTimeInTz } from '@/lib/time'
import { RescheduleSheet, type RescheduleBooking } from './reschedule-sheet'

interface CheckInBannerProps {
  role: string
  facilityId: string
  facilityTimezone: string
  todayDate: string
  todayBookings: RescheduleBooking[]
  alreadyCheckedIn: boolean
}

export function CheckInBanner({
  role,
  facilityId,
  facilityTimezone,
  todayDate,
  todayBookings,
  alreadyCheckedIn,
}: CheckInBannerProps) {
  const { toast } = useToast()
  const [checkedIn, setCheckedIn] = useState(alreadyCheckedIn)
  const [submitting, setSubmitting] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetDelay, setSheetDelay] = useState(0)
  const [fading, setFading] = useState(false)

  if (role !== 'stylist') return null
  if (checkedIn) return null
  if (todayBookings.length === 0) return null

  const sorted = [...todayBookings].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  )
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const nowMs = Date.now()
  if (new Date(last.endTime).getTime() < nowMs) return null

  function startFadeOut() {
    setFading(true)
    setTimeout(() => setCheckedIn(true), 500)
  }

  async function handleCheckIn() {
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId, date: todayDate }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error?.toString() || 'Check-in failed')
      }
      const json = await res.json()
      const delay: number = json?.data?.delayMinutes ?? 0
      if (delay <= 0) {
        toast.success('Welcome! Have a great day 🎉')
        startFadeOut()
      } else {
        setSheetDelay(delay)
        setSheetOpen(true)
      }
    } catch (err) {
      console.error('Check-in failed:', err)
      toast.error(err instanceof Error ? err.message : 'Check-in failed')
    } finally {
      setSubmitting(false)
    }
  }

  function handleSheetConfirm() {
    setSheetOpen(false)
    startFadeOut()
  }

  function handleSheetDismiss() {
    setSheetOpen(false)
    startFadeOut()
  }

  const count = sorted.length

  return (
    <>
      <div
        data-tour="checkin-banner"
        className="rounded-2xl bg-[#8B2E4A] text-white px-4 py-3 mb-3 flex items-center justify-between gap-3 shadow-[var(--shadow-sm)] transition-opacity duration-500"
        style={{ opacity: fading ? 0 : 1 }}
      >
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            📍 You have {count} appointment{count === 1 ? '' : 's'} today
          </div>
          <div className="text-xs text-white/70">
            First appointment at {formatTimeInTz(first.startTime, facilityTimezone)}
          </div>
        </div>
        <button
          data-tour="checkin-button"
          type="button"
          onClick={handleCheckIn}
          disabled={submitting || fading}
          className="bg-white text-[#8B2E4A] text-sm font-semibold px-4 py-2 rounded-xl active:scale-95 transition-transform shrink-0 disabled:opacity-60"
        >
          {submitting ? 'Checking in…' : "I'm Here →"}
        </button>
      </div>

      <RescheduleSheet
        open={sheetOpen}
        delayMinutes={sheetDelay}
        todayBookings={todayBookings}
        facilityTimezone={facilityTimezone}
        onConfirm={handleSheetConfirm}
        onDismiss={handleSheetDismiss}
      />
    </>
  )
}
