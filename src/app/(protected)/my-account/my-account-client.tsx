'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { formatCents, formatTime } from '@/lib/utils'
import type { Stylist } from '@/types'

interface WeekBooking {
  id: string
  startTime: string
  endTime: string
  status: string
  priceCents: number | null
  resident: { name: string }
  service: { name: string }
}

interface MyAccountClientProps {
  user: { email: string; fullName: string | null }
  stylist: Stylist | null
  weekBookings: WeekBooking[]
  monthEarningsCents: number
  linked: boolean
  facilityStylists: Stylist[]
}

function groupByDay(bookings: WeekBooking[]) {
  const groups: Record<string, WeekBooking[]> = {}
  for (const b of bookings) {
    const date = new Date(b.startTime)
    const key = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    if (!groups[key]) groups[key] = []
    groups[key].push(b)
  }
  return groups
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    scheduled: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Scheduled' },
    completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Completed' },
    cancelled: { bg: 'bg-red-50', text: 'text-red-700', label: 'Cancelled' },
    no_show: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'No Show' },
  }
  const s = map[status] ?? { bg: 'bg-stone-50', text: 'text-stone-600', label: status }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

export function MyAccountClient({ user, stylist, weekBookings, monthEarningsCents, linked, facilityStylists }: MyAccountClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedStylistId, setSelectedStylistId] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [welcomeBanner, setWelcomeBanner] = useState<string | null>(null)

  useEffect(() => {
    if (searchParams.get('welcome') === '1') {
      setWelcomeBanner(
        linked && stylist
          ? `Welcome! Your account is linked to ${stylist.name}.`
          : 'Welcome! Link your stylist profile in the section below.'
      )
      // Remove query param from URL without reload
      window.history.replaceState({}, '', '/my-account')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLink = async () => {
    if (!selectedStylistId) return
    setLinking(true)
    setLinkError(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stylistId: selectedStylistId }),
      })
      const json = await res.json()
      if (!res.ok) {
        setLinkError(json.error ?? 'Failed to link stylist')
      } else {
        router.refresh()
      }
    } catch {
      setLinkError('Failed to link stylist')
    } finally {
      setLinking(false)
    }
  }

  if (!linked) {
    return (
      <div className="p-4 md:p-8 max-w-2xl mx-auto">
        {welcomeBanner && (
          <div className="mb-4 bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2" className="shrink-0 mt-0.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <p className="text-sm text-rose-800">{welcomeBanner}</p>
          </div>
        )}
        <h1
          className="text-2xl font-bold text-stone-900 mb-6"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          My Account
        </h1>
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6">
          <div className="mb-4">
            <p className="text-sm font-medium text-stone-900">{user.fullName ?? user.email}</p>
            <p className="text-xs text-stone-400">{user.email}</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
            <p className="text-sm text-amber-800 mb-3">
              Your account hasn&apos;t been linked to a stylist profile yet.
            </p>
            {facilityStylists.length > 0 ? (
              <div className="space-y-3">
                <select
                  value={selectedStylistId}
                  onChange={(e) => setSelectedStylistId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-amber-300 text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                >
                  <option value="">Select your stylist profile…</option>
                  {facilityStylists.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {linkError && <p className="text-xs text-red-600">{linkError}</p>}
                <button
                  onClick={handleLink}
                  disabled={!selectedStylistId || linking}
                  className="w-full px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: '#8B2E4A' }}
                >
                  {linking ? 'Linking…' : 'Link My Account'}
                </button>
              </div>
            ) : (
              <p className="text-sm text-amber-700">Please contact your facility admin to link your account.</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  const grouped = groupByDay(weekBookings)
  const upcomingCount = weekBookings.filter((b) => b.status === 'scheduled').length

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-5">
      {welcomeBanner && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2" className="shrink-0 mt-0.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <p className="text-sm text-rose-800">{welcomeBanner}</p>
        </div>
      )}
      <h1
        className="text-2xl font-bold text-stone-900"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        My Account
      </h1>

      {/* Profile card */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
        <div className="flex items-center gap-4">
          {stylist && (
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold shrink-0"
              style={{ backgroundColor: stylist.color }}
            >
              {stylist.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-stone-900">{stylist?.name ?? user.fullName ?? user.email}</p>
            <p className="text-sm text-stone-400">{user.email}</p>
          </div>
        </div>
        {stylist && (
          <div className="mt-4 flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stylist.color }} />
              <span className="text-xs text-stone-500">Calendar color</span>
            </div>
            <span className="text-xs text-stone-300">|</span>
            <span className="text-xs text-stone-500">{stylist.commissionPercent}% commission</span>
          </div>
        )}
      </div>

      {/* Earnings card */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
        <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">
          Your Earnings This Month
        </p>
        <div className="flex items-end gap-2">
          <p className="text-3xl font-bold text-[#8B2E4A]">{formatCents(monthEarningsCents)}</p>
          {stylist && (
            <p className="text-sm text-stone-400 mb-1">{stylist.commissionPercent}% commission</p>
          )}
        </div>
        <p className="text-xs text-stone-400 mt-1">Based on completed appointments</p>
      </div>

      {/* Schedule card */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">
            This Week&apos;s Schedule
          </p>
          <span className="text-xs text-stone-500">{upcomingCount} upcoming</span>
        </div>

        {weekBookings.length === 0 ? (
          <p className="text-sm text-stone-400 py-4 text-center">No appointments this week.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([day, dayBookings]) => (
              <div key={day}>
                <p className="text-xs font-semibold text-stone-500 mb-2">{day}</p>
                <div className="space-y-2">
                  {dayBookings.map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-stone-50 border border-stone-100"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-900 truncate">
                          {b.resident.name}
                        </p>
                        <p className="text-xs text-stone-400">
                          {b.service.name} &middot; {formatTime(b.startTime)} &ndash; {formatTime(b.endTime)}
                        </p>
                      </div>
                      <div className="shrink-0 ml-3 flex items-center gap-2">
                        {b.priceCents != null && (
                          <span className="text-xs font-semibold text-stone-600">
                            {formatCents(b.priceCents)}
                          </span>
                        )}
                        {statusBadge(b.status)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
