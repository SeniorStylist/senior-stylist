'use client'

import { useState, useEffect, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { formatCents } from '@/lib/utils'
import { Spinner } from '@/components/ui'

interface MonthlyFacilityData {
  facilityId: string
  facilityName: string
  appointmentCount: number
  totalRevenueCents: number
  unpaidCount: number
  unpaidRevenueCents: number
}

interface OutstandingBooking {
  id: string
  facilityId: string
  facilityName: string
  startTime: string
  effectivePriceCents: number
  resident: { name: string; roomNumber: string | null }
  stylist: { name: string }
  service: { name: string }
}

function currentMonthStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function ReportsTab() {
  const [month, setMonth] = useState(currentMonthStr)
  const [monthlyData, setMonthlyData] = useState<MonthlyFacilityData[]>([])
  const [outstanding, setOutstanding] = useState<OutstandingBooking[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingOutstanding, setLoadingOutstanding] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [markingPaid, setMarkingPaid] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchMonthly = useCallback(async (m: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/super-admin/reports/monthly?month=${m}`)
      const json = await res.json()
      if (res.ok) setMonthlyData(json.data ?? [])
      else setError(json.error ?? 'Failed to load report')
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchOutstanding = useCallback(async () => {
    setLoadingOutstanding(true)
    try {
      const res = await fetch('/api/super-admin/reports/outstanding')
      const json = await res.json()
      if (res.ok) setOutstanding(json.data ?? [])
    } catch {
      // non-fatal
    } finally {
      setLoadingOutstanding(false)
    }
  }, [])

  useEffect(() => {
    fetchMonthly(month)
  }, [month, fetchMonthly])

  useEffect(() => {
    fetchOutstanding()
  }, [fetchOutstanding])

  const handleMarkPaid = async (ids: string[]) => {
    setMarkingPaid(true)
    try {
      const res = await fetch('/api/super-admin/reports/mark-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingIds: ids }),
      })
      if (res.ok) {
        setOutstanding((prev) => prev.filter((b) => !ids.includes(b.id)))
        setSelectedIds(new Set())
        // Refresh monthly data too since revenue numbers may change
        fetchMonthly(month)
      }
    } finally {
      setMarkingPaid(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await fetch(`/api/super-admin/export/billing?month=${month}`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cross-facility-billing-${month}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleFacility = (ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allSelected = ids.every((id) => prev.has(id))
      if (allSelected) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
  }

  // Derived totals
  const totalRevenue = monthlyData.reduce((s, f) => s + f.totalRevenueCents, 0)
  const totalAppointments = monthlyData.reduce((s, f) => s + f.appointmentCount, 0)
  const totalUnpaidRevenue = monthlyData.reduce((s, f) => s + f.unpaidRevenueCents, 0)

  // Chart data
  const chartData = monthlyData.map((f) => ({
    name: f.facilityName.length > 16 ? f.facilityName.slice(0, 14) + '…' : f.facilityName,
    revenue: f.totalRevenueCents,
  }))

  // Group outstanding by facility
  const outstandingByFacility = outstanding.reduce<Record<string, { name: string; bookings: OutstandingBooking[] }>>(
    (acc, b) => {
      if (!acc[b.facilityId]) acc[b.facilityId] = { name: b.facilityName, bookings: [] }
      acc[b.facilityId].bookings.push(b)
      return acc
    },
    {}
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-700 focus:outline-none focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all"
          />
          {loading && <Spinner className="text-[#0D7377]" />}
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50 transition-all"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {/* Summary totals */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">Total Revenue</p>
          <p className="text-2xl font-bold text-stone-900">{formatCents(totalRevenue)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">Appointments</p>
          <p className="text-2xl font-bold text-stone-900">{totalAppointments}</p>
        </div>
        <div className={`rounded-2xl border shadow-sm p-4 ${totalUnpaidRevenue > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-stone-100'}`}>
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">Outstanding</p>
          <p className={`text-2xl font-bold ${totalUnpaidRevenue > 0 ? 'text-amber-700' : 'text-stone-900'}`}>
            {formatCents(totalUnpaidRevenue)}
          </p>
        </div>
      </div>

      {/* Bar chart */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4 mb-6">
          <p className="text-sm font-semibold text-stone-700 mb-3">Revenue by Facility</p>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tickFormatter={(v: number) => `$${(v / 100).toFixed(0)}`}
                  width={64}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v) => [formatCents(Number(v)), 'Revenue']}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e7e5e4', fontSize: 12 }}
                />
                <Bar dataKey="revenue" fill="#0D7377" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Per-facility cards */}
      {monthlyData.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          {monthlyData.map((f) => (
            <div key={f.facilityId} className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-stone-900 leading-snug">{f.facilityName}</p>
                {f.unpaidCount > 0 && (
                  <span className="text-xs font-semibold bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5 shrink-0">
                    {f.unpaidCount} unpaid
                  </span>
                )}
              </div>
              <p className="text-xl font-bold text-stone-900 mt-1">{formatCents(f.totalRevenueCents)}</p>
              <p className="text-xs text-stone-400 mt-0.5">{f.appointmentCount} appointment{f.appointmentCount !== 1 ? 's' : ''}</p>
            </div>
          ))}
        </div>
      )}

      {/* Outstanding balances */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
          <p className="font-semibold text-stone-900">Outstanding Balances</p>
          {selectedIds.size > 0 && (
            <button
              onClick={() => handleMarkPaid([...selectedIds])}
              disabled={markingPaid}
              className="px-3 py-1.5 text-xs font-semibold bg-[#0D7377] text-white rounded-xl hover:bg-[#0a5f63] disabled:opacity-50 transition-all"
            >
              {markingPaid ? 'Marking…' : `Mark ${selectedIds.size} Paid`}
            </button>
          )}
        </div>

        {loadingOutstanding ? (
          <div className="flex items-center justify-center py-10">
            <Spinner className="text-[#0D7377]" />
          </div>
        ) : outstanding.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-stone-400">
            No outstanding balances
          </div>
        ) : (
          Object.entries(outstandingByFacility).map(([facilityId, { name, bookings: fBookings }]) => {
            const facilityIds = fBookings.map((b) => b.id)
            const allSelected = facilityIds.every((id) => selectedIds.has(id))
            const facilityTotal = fBookings.reduce((s, b) => s + b.effectivePriceCents, 0)
            return (
              <div key={facilityId} className="border-b border-stone-50 last:border-0">
                {/* Facility header */}
                <div className="px-4 py-2.5 bg-stone-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => toggleFacility(facilityIds)}
                      className="w-4 h-4 rounded accent-[#0D7377]"
                    />
                    <p className="text-xs font-semibold text-stone-600">{name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-stone-700">{formatCents(facilityTotal)}</p>
                    <button
                      onClick={() => handleMarkPaid(facilityIds)}
                      disabled={markingPaid}
                      className="text-xs font-semibold text-[#0D7377] hover:underline disabled:opacity-40 transition-colors"
                    >
                      Mark All Paid
                    </button>
                  </div>
                </div>
                {/* Booking rows */}
                {fBookings.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 px-4 py-3 border-b border-stone-50 last:border-0">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(b.id)}
                      onChange={() => toggleSelect(b.id)}
                      className="w-4 h-4 rounded accent-[#0D7377] shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-900 truncate">{b.resident.name}</p>
                      <p className="text-xs text-stone-400 truncate">
                        {b.service.name} · {b.stylist.name} · {new Date(b.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="text-sm font-semibold text-stone-700">{formatCents(b.effectivePriceCents)}</p>
                      <button
                        onClick={() => handleMarkPaid([b.id])}
                        disabled={markingPaid}
                        className="text-xs font-medium text-[#0D7377] hover:underline disabled:opacity-40 transition-colors"
                      >
                        Paid
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
