'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn, formatCents, formatTime } from '@/lib/utils'
import type { Stylist, Service, Resident } from '@/types'

const PRESET_COLORS = [
  '#0D7377',
  '#7C3AED',
  '#DC2626',
  '#D97706',
  '#059669',
  '#2563EB',
  '#DB2777',
  '#92400E',
]

interface UpcomingBooking {
  id: string
  startTime: string
  endTime: string
  status: string
  priceCents: number | null
  resident: Resident
  service: Service
}

interface StylistDetailClientProps {
  stylist: Stylist
  upcomingBookings: UpcomingBooking[]
  stats: {
    thisWeek: number
    thisMonth: number
    totalRevenue: number
    totalBookings: number
  }
}

export function StylistDetailClient({
  stylist: initialStylist,
  upcomingBookings,
  stats,
}: StylistDetailClientProps) {
  const router = useRouter()
  const [stylist, setStylist] = useState(initialStylist)
  const [name, setName] = useState(initialStylist.name)
  const [color, setColor] = useState(initialStylist.color)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDirty = name !== stylist.name || color !== stylist.color

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/stylists/${stylist.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color }),
      })
      const json = await res.json()
      if (res.ok) {
        setStylist(json.data)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
        router.refresh()
      } else {
        setError(json.error ?? 'Failed to save')
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-2 hover:bg-stone-100 rounded-xl transition-colors text-stone-400 hover:text-stone-600"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <h1
            className="text-2xl font-bold text-stone-900"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            {stylist.name}
          </h1>
          <p className="text-sm text-stone-500">Stylist</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'This week', value: stats.thisWeek },
          { label: 'This month', value: stats.thisMonth },
          { label: 'All time', value: stats.totalBookings },
          { label: 'Total revenue', value: formatCents(stats.totalRevenue) },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4 text-center"
          >
            <p className="text-xl font-bold text-stone-900">{stat.value}</p>
            <p className="text-xs text-stone-500 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-5">
        {/* Info card */}
        <div className="col-span-2 bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
          <div className="flex justify-center mb-5">
            <Avatar name={name} color={color} size="lg" />
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">
                Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-2">
                Calendar color
              </label>
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={cn(
                      'w-7 h-7 rounded-full transition-all duration-150',
                      color === c
                        ? 'ring-2 ring-offset-2 ring-stone-400 scale-110'
                        : 'hover:scale-105'
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <Button
              onClick={handleSave}
              loading={saving}
              disabled={!isDirty || saving}
              className="w-full"
            >
              {saved ? '✓ Saved' : 'Save changes'}
            </Button>
          </div>
        </div>

        {/* Upcoming schedule */}
        <div className="col-span-3 bg-white rounded-2xl border border-stone-100 shadow-sm">
          <div className="px-5 py-4 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-stone-900">Upcoming appointments</h2>
            <p className="text-xs text-stone-500 mt-0.5">Next 14 days</p>
          </div>

          {upcomingBookings.length === 0 ? (
            <div className="flex items-center justify-center h-40">
              <p className="text-sm text-stone-400">No upcoming appointments</p>
            </div>
          ) : (
            <div className="divide-y divide-stone-50">
              {upcomingBookings.map((booking) => {
                const d = new Date(booking.startTime)
                return (
                  <div key={booking.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="shrink-0 w-10 text-center">
                      <p className="text-xs font-medium text-stone-400 uppercase leading-none">
                        {d.toLocaleDateString('en-US', { month: 'short' })}
                      </p>
                      <p className="text-xl font-bold text-stone-900 leading-tight">
                        {d.getDate()}
                      </p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-stone-900 truncate">
                        {booking.resident.name}
                      </p>
                      <p className="text-xs text-stone-500 truncate">
                        {booking.service.name} · {formatTime(booking.startTime)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-stone-700">
                        {formatCents(booking.priceCents ?? booking.service.priceCents)}
                      </p>
                      <p className="text-xs text-stone-400">
                        {booking.service.durationMinutes}min
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
