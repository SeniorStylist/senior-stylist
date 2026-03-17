'use client'

import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { cn, formatCents } from '@/lib/utils'
import { Spinner } from '@/components/ui'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { SkeletonStatCard, Skeleton } from '@/components/ui/skeleton'

interface ServiceStat {
  name: string
  count: number
  revenueCents: number
}

interface StylistStat {
  name: string
  count: number
  revenueCents: number
}

interface DayStat {
  date: string
  count: number
}

interface BookingRow {
  id: string
  startTime: string
  resident: string
  service: string
  stylist: string
  priceCents: number
  status: string
}

interface ReportData {
  totalRevenueCents: number
  totalAppointments: number
  byService: ServiceStat[]
  byStylist: StylistStat[]
  busiestDays: DayStat[]
  bookings: BookingRow[]
}

type SortKey = 'date' | 'price'
type SortDir = 'asc' | 'desc'

const BAR_COLORS = ['#0D7377', '#14D9C4', '#0a8f94', '#18b5a4', '#067073', '#1fc4b0']

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-teal-50 text-teal-700',
  scheduled: 'bg-blue-50 text-blue-700',
  no_show: 'bg-amber-50 text-amber-700',
  cancelled: 'bg-stone-100 text-stone-500',
}

export function ReportsClient() {
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetch(`/api/reports/monthly?month=${month}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setData(json.data)
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [month])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedBookings = data
    ? [...data.bookings].sort((a, b) => {
        const cmp =
          sortKey === 'date'
            ? new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
            : a.priceCents - b.priceCents
        return sortDir === 'asc' ? cmp : -cmp
      })
    : []

  const chartData = data?.byService.map((s) => ({
    name: s.name.length > 14 ? s.name.slice(0, 13) + '…' : s.name,
    revenue: s.revenueCents / 100,
    count: s.count,
  }))

  return (
    <ErrorBoundary>
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-bold text-stone-900"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Reports
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">Monthly revenue &amp; activity</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="text-sm text-stone-700 bg-white border border-stone-200 rounded-xl px-3 py-2 focus:outline-none focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
        />
      </div>

      {loading && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <SkeletonStatCard />
            <SkeletonStatCard />
          </div>
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
            <Skeleton className="h-4 w-36 rounded mb-4" />
            <Skeleton className="h-[220px] w-full rounded-xl" />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="text-center py-24">
          <p className="text-stone-400 text-sm">Failed to load report data.</p>
        </div>
      )}

      {!loading && data && (
        <div className="space-y-5">
          {/* Top stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">
                Total Revenue
              </p>
              <p className="text-3xl font-bold text-[#0D7377]">
                {formatCents(data.totalRevenueCents)}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">
                Appointments
              </p>
              <p className="text-3xl font-bold text-stone-900">{data.totalAppointments}</p>
            </div>
          </div>

          {/* Revenue by service bar chart */}
          {data.byService.length > 0 && (
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
              <p className="text-sm font-semibold text-stone-700 mb-4">Revenue by Service</p>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 4, right: 4, left: 0, bottom: 4 }}
                  >
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: '#78716C' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#78716C' }}
                      tickFormatter={(v: number) => `$${v}`}
                      axisLine={false}
                      tickLine={false}
                      width={52}
                    />
                    <Tooltip
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Revenue']}
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 8,
                        border: '1px solid #E7E5E4',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                      }}
                    />
                    <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                      {chartData!.map((_, i) => (
                        <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Revenue by stylist + busiest days */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* By stylist */}
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
              <p className="text-sm font-semibold text-stone-700 mb-3">Revenue by Stylist</p>
              {data.byStylist.length === 0 ? (
                <p className="text-sm text-stone-400">No data</p>
              ) : (
                <div className="space-y-0">
                  {data.byStylist.map((s) => (
                    <div
                      key={s.name}
                      className="flex items-center justify-between py-2.5 border-b border-stone-50 last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium text-stone-800">{s.name}</p>
                        <p className="text-xs text-stone-400">
                          {s.count} appointment{s.count !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-stone-700">
                        {formatCents(s.revenueCents)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Busiest days */}
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
              <p className="text-sm font-semibold text-stone-700 mb-3">Busiest Days</p>
              {data.busiestDays.length === 0 ? (
                <p className="text-sm text-stone-400">No data</p>
              ) : (
                <div className="space-y-0">
                  {data.busiestDays.map((d) => (
                    <div
                      key={d.date}
                      className="flex items-center justify-between py-2.5 border-b border-stone-50 last:border-0"
                    >
                      <p className="text-sm font-medium text-stone-800">
                        {new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 text-xs font-semibold">
                        {d.count} appt{d.count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Full booking table */}
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-stone-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-stone-700">All Appointments</p>
              <p className="text-xs text-stone-400">{data.bookings.length} total</p>
            </div>

            {/* Table header */}
            <div className="grid grid-cols-12 gap-2 px-5 py-2.5 bg-stone-50 border-b border-stone-100">
              <button
                onClick={() => toggleSort('date')}
                className="col-span-2 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide hover:text-stone-700 flex items-center gap-1"
              >
                Date
                {sortKey === 'date' && (
                  <span className="text-[#0D7377]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </button>
              <div className="col-span-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Resident
              </div>
              <div className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Service
              </div>
              <div className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Stylist
              </div>
              <button
                onClick={() => toggleSort('price')}
                className="col-span-2 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide hover:text-stone-700 flex items-center gap-1"
              >
                Price
                {sortKey === 'price' && (
                  <span className="text-[#0D7377]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </button>
              <div className="col-span-1 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Status
              </div>
            </div>

            {sortedBookings.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-3">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-stone-600">No bookings this month</p>
                <p className="text-xs text-stone-400 mt-1">Appointments will appear here once booked.</p>
              </div>
            ) : (
              <div className="divide-y divide-stone-50">
                {sortedBookings.map((b) => (
                  <div
                    key={b.id}
                    className="grid grid-cols-12 gap-2 items-center px-5 py-3 hover:bg-stone-50 transition-colors"
                  >
                    <div className="col-span-2 text-xs text-stone-500">
                      {new Date(b.startTime).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </div>
                    <div className="col-span-3 text-sm font-medium text-stone-800 truncate">
                      {b.resident}
                    </div>
                    <div className="col-span-2 text-sm text-stone-500 truncate">{b.service}</div>
                    <div className="col-span-2 text-sm text-stone-500 truncate">{b.stylist}</div>
                    <div className="col-span-2 text-sm font-semibold text-stone-700">
                      {formatCents(b.priceCents)}
                    </div>
                    <div className="col-span-1">
                      <span
                        className={cn(
                          'inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize',
                          STATUS_STYLES[b.status] ?? 'bg-stone-100 text-stone-500'
                        )}
                      >
                        {b.status.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  )
}
