'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn, formatCents, formatTime } from '@/lib/utils'
import type { Stylist, Service, Resident } from '@/types'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { useToast } from '@/components/ui/toast'

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

interface ServiceBreakdown {
  serviceName: string
  count: number
  revenueCents: number
  commissionCents: number
}

interface StylistDetailClientProps {
  stylist: Stylist
  upcomingBookings: UpcomingBooking[]
  stats: {
    thisWeek: number
    thisMonth: number
    totalRevenue: number
    totalBookings: number
    monthRevenue: number
    serviceBreakdown: ServiceBreakdown[]
  }
}

export function StylistDetailClient({
  stylist: initialStylist,
  upcomingBookings,
  stats,
}: StylistDetailClientProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [stylist, setStylist] = useState(initialStylist)
  const [name, setName] = useState(initialStylist.name)
  const [color, setColor] = useState(initialStylist.color)
  const [commissionPercent, setCommissionPercent] = useState(initialStylist.commissionPercent)
  const [editingCommission, setEditingCommission] = useState(false)
  const [commissionInput, setCommissionInput] = useState(String(initialStylist.commissionPercent))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDirty = name !== stylist.name || color !== stylist.color || commissionPercent !== stylist.commissionPercent

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/stylists/${stylist.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color, commissionPercent }),
      })
      const json = await res.json()
      if (res.ok) {
        setStylist(json.data)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
        toast('Changes saved', 'success')
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
    <ErrorBoundary>
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

      {/* Commission earnings this month */}
      {stylist.commissionPercent > 0 && (
        <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-teal-900">Commission This Month</p>
            <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-semibold">
              {stylist.commissionPercent}%
            </span>
          </div>
          <div className="flex items-end gap-4 mb-3">
            <div>
              <p className="text-xs text-teal-600 mb-0.5">Revenue</p>
              <p className="text-2xl font-bold text-teal-800">{formatCents(stats.monthRevenue)}</p>
            </div>
            <div className="mb-1 text-teal-400">×</div>
            <div>
              <p className="text-xs text-teal-600 mb-0.5">Rate</p>
              <p className="text-2xl font-bold text-teal-800">{stylist.commissionPercent}%</p>
            </div>
            <div className="mb-1 text-teal-400">=</div>
            <div>
              <p className="text-xs text-teal-600 mb-0.5">Commission</p>
              <p className="text-2xl font-bold text-[#0D7377]">
                {formatCents(Math.round(stats.monthRevenue * stylist.commissionPercent / 100))}
              </p>
            </div>
          </div>
          {stats.serviceBreakdown.length > 0 && (
            <div className="border-t border-teal-200 pt-3 space-y-1.5">
              <p className="text-xs font-semibold text-teal-700 mb-2">By service</p>
              {stats.serviceBreakdown.map((row) => (
                <div key={row.serviceName} className="flex items-center justify-between text-xs">
                  <span className="text-teal-700">{row.serviceName} ({row.count})</span>
                  <span className="font-semibold text-teal-800">{formatCents(row.commissionCents)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">
                Commission %
              </label>
              {editingCommission ? (
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={commissionInput}
                    onChange={(e) => setCommissionInput(e.target.value)}
                    className="w-20 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
                    autoFocus
                  />
                  <span className="text-sm text-stone-400">%</span>
                  <button
                    type="button"
                    onClick={() => {
                      const val = Math.max(0, Math.min(100, parseInt(commissionInput) || 0))
                      setCommissionPercent(val)
                      setCommissionInput(String(val))
                      setEditingCommission(false)
                    }}
                    className="text-xs text-teal-700 font-semibold hover:text-teal-800"
                  >
                    Set
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCommissionInput(String(commissionPercent)); setEditingCommission(false) }}
                    className="text-xs text-stone-400 hover:text-stone-600"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingCommission(true)}
                  className="flex items-center gap-2 group"
                >
                  <span className="text-sm font-semibold text-stone-900">
                    {commissionPercent}%
                  </span>
                  <span className="text-xs text-stone-400 group-hover:text-[#0D7377] transition-colors">
                    (click to edit)
                  </span>
                </button>
              )}
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
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-stone-600">No upcoming appointments</p>
              <p className="text-xs text-stone-400">Schedule will appear here for the next 14 days.</p>
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
    </ErrorBoundary>
  )
}
