'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn, formatCents, formatTime } from '@/lib/utils'
import type { Stylist, Service, Resident, ComplianceDocumentWithUrl, ComplianceDocumentType, StylistAvailability } from '@/types'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { useToast } from '@/components/ui/toast'

const DOC_TYPE_LABEL: Record<ComplianceDocumentType, string> = {
  license: 'License',
  insurance: 'Insurance',
  w9: 'W-9',
  contractor_agreement: 'Contractor Agreement',
  background_check: 'Background Check',
}

const DOC_TYPE_BADGE: Record<ComplianceDocumentType, string> = {
  license: 'bg-blue-50 text-blue-700',
  insurance: 'bg-purple-50 text-purple-700',
  w9: 'bg-stone-100 text-stone-600',
  contractor_agreement: 'bg-stone-100 text-stone-600',
  background_check: 'bg-emerald-50 text-emerald-700',
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatTimeLabel(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  const period = h >= 12 ? 'pm' : 'am'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, '0')}${period}`
}

function summarizeAvailability(rows: StylistAvailability[]): string[] {
  const active = rows
    .filter((r) => r.active)
    .slice()
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
  if (active.length === 0) return []
  const groups: string[] = []
  let groupStart = 0
  for (let i = 1; i <= active.length; i++) {
    const prev = active[i - 1]
    const cur = active[i]
    const sameTimes =
      cur && cur.startTime === prev.startTime && cur.endTime === prev.endTime
    const consecutive = cur && cur.dayOfWeek === prev.dayOfWeek + 1
    if (!sameTimes || !consecutive) {
      const first = active[groupStart]
      const last = prev
      const dayLabel =
        first.dayOfWeek === last.dayOfWeek
          ? DAY_SHORT[first.dayOfWeek]
          : `${DAY_SHORT[first.dayOfWeek]}–${DAY_SHORT[last.dayOfWeek]}`
      groups.push(`${dayLabel} ${formatTimeLabel(first.startTime)}–${formatTimeLabel(first.endTime)}`)
      groupStart = i
    }
  }
  return groups
}

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
  complianceDocuments: ComplianceDocumentWithUrl[]
  availability: StylistAvailability[]
  isAdmin: boolean
}

export function StylistDetailClient({
  stylist: initialStylist,
  upcomingBookings,
  stats,
  complianceDocuments,
  availability,
  isAdmin,
}: StylistDetailClientProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [stylist, setStylist] = useState(initialStylist)
  const [name, setName] = useState(initialStylist.name)
  const [color, setColor] = useState(initialStylist.color)
  const [commissionPercent, setCommissionPercent] = useState(initialStylist.commissionPercent)
  const [licenseNumber, setLicenseNumber] = useState(initialStylist.licenseNumber ?? '')
  const [licenseType, setLicenseType] = useState(initialStylist.licenseType ?? '')
  const [licenseExpiresAt, setLicenseExpiresAt] = useState(initialStylist.licenseExpiresAt ?? '')
  const [editingCommission, setEditingCommission] = useState(false)
  const [commissionInput, setCommissionInput] = useState(String(initialStylist.commissionPercent))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)

  const licenseDirty =
    licenseNumber !== (stylist.licenseNumber ?? '') ||
    licenseType !== (stylist.licenseType ?? '') ||
    licenseExpiresAt !== (stylist.licenseExpiresAt ?? '')

  const handleVerify = async (docId: string, verified: boolean) => {
    setVerifyingId(docId)
    try {
      const path = verified ? 'unverify' : 'verify'
      const res = await fetch(`/api/compliance/${docId}/${path}`, { method: 'PUT' })
      if (res.ok) {
        toast(verified ? 'Unverified' : 'Verified', 'success')
        router.refresh()
      } else {
        toast('Failed', 'error')
      }
    } finally {
      setVerifyingId(null)
    }
  }

  const isDirty = name !== stylist.name || color !== stylist.color || commissionPercent !== stylist.commissionPercent || licenseDirty

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/stylists/${stylist.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          color,
          commissionPercent,
          licenseNumber: licenseNumber.trim() || null,
          licenseType: licenseType.trim() || null,
          licenseExpiresAt: licenseExpiresAt || null,
        }),
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
        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-stone-900">Commission This Month</p>
            <span className="text-xs bg-rose-100 text-[#8B2E4A] px-2 py-0.5 rounded-full font-semibold">
              {stylist.commissionPercent}%
            </span>
          </div>
          <div className="flex items-end gap-4 mb-3">
            <div>
              <p className="text-xs text-rose-600 mb-0.5">Revenue</p>
              <p className="text-2xl font-bold text-rose-800">{formatCents(stats.monthRevenue)}</p>
            </div>
            <div className="mb-1 text-rose-400">×</div>
            <div>
              <p className="text-xs text-rose-600 mb-0.5">Rate</p>
              <p className="text-2xl font-bold text-rose-800">{stylist.commissionPercent}%</p>
            </div>
            <div className="mb-1 text-rose-400">=</div>
            <div>
              <p className="text-xs text-rose-600 mb-0.5">Commission</p>
              <p className="text-2xl font-bold text-[#8B2E4A]">
                {formatCents(Math.round(stats.monthRevenue * stylist.commissionPercent / 100))}
              </p>
            </div>
          </div>
          {stats.serviceBreakdown.length > 0 && (
            <div className="border-t border-rose-200 pt-3 space-y-1.5">
              <p className="text-xs font-semibold text-[#8B2E4A] mb-2">By service</p>
              {stats.serviceBreakdown.map((row) => (
                <div key={row.serviceName} className="flex items-center justify-between text-xs">
                  <span className="text-[#8B2E4A]">{row.serviceName} ({row.count})</span>
                  <span className="font-semibold text-rose-800">{formatCents(row.commissionCents)}</span>
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
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 transition-all"
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
                    className="w-20 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 transition-all"
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
                    className="text-xs text-[#8B2E4A] font-semibold hover:text-rose-800"
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
                  <span className="text-xs text-stone-400 group-hover:text-[#8B2E4A] transition-colors">
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

            {stylist.googleCalendarId && (
              <div className="pt-1">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  Calendar connected
                </span>
              </div>
            )}

            {isAdmin && (
              <div className="pt-4 border-t border-stone-100 space-y-3">
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">License</p>
                <div>
                  <label className="text-[11px] text-stone-500 block mb-1">Number</label>
                  <input
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 transition-all"
                    placeholder="e.g. 123456"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-stone-500 block mb-1">Type</label>
                  <input
                    value={licenseType}
                    onChange={(e) => setLicenseType(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 transition-all"
                    placeholder="e.g. Cosmetology"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-stone-500 block mb-1">Expires</label>
                  <input
                    type="date"
                    value={licenseExpiresAt}
                    onChange={(e) => setLicenseExpiresAt(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 transition-all"
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${stylist.insuranceVerified ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                    {stylist.insuranceVerified ? 'Insurance verified' : 'Insurance unverified'}
                  </span>
                  {stylist.insuranceExpiresAt && (
                    <span className="text-[11px] text-stone-500">until {stylist.insuranceExpiresAt}</span>
                  )}
                </div>
                <div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${stylist.backgroundCheckVerified ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                    {stylist.backgroundCheckVerified ? 'Background check verified' : 'Background check pending'}
                  </span>
                </div>
              </div>
            )}

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
        <div className="col-span-3 space-y-5">
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm">
          <div className="px-5 py-4 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-stone-900">Compliance documents</h2>
            <p className="text-xs text-stone-500 mt-0.5">Licensing, insurance, and agreements</p>
          </div>
          {complianceDocuments.length === 0 ? (
            <p className="text-sm text-stone-400 px-5 py-6">No documents uploaded.</p>
          ) : (
            <ul className="divide-y divide-stone-50">
              {complianceDocuments.map((doc) => {
                const type = doc.documentType as ComplianceDocumentType
                return (
                  <li key={doc.id} className="flex items-center gap-3 px-5 py-3">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-stone-400 shrink-0">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <a
                        href={doc.signedUrl ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-stone-900 hover:text-[#8B2E4A] truncate block"
                      >
                        {doc.fileName}
                      </a>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${DOC_TYPE_BADGE[type]}`}>
                          {DOC_TYPE_LABEL[type]}
                        </span>
                        <span className="text-[11px] text-stone-500">
                          {doc.expiresAt ? `Expires ${doc.expiresAt}` : '—'}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${doc.verified ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          {doc.verified ? 'Verified' : 'Pending Review'}
                        </span>
                      </div>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => handleVerify(doc.id, doc.verified)}
                        disabled={verifyingId === doc.id}
                        className={cn(
                          'shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50',
                          doc.verified
                            ? 'text-stone-600 border-stone-200 hover:bg-stone-50'
                            : 'text-white border-transparent'
                        )}
                        style={!doc.verified ? { backgroundColor: '#8B2E4A' } : undefined}
                      >
                        {verifyingId === doc.id ? '…' : doc.verified ? 'Unverify' : 'Verify'}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm">
          <div className="px-5 py-4 border-b border-stone-100">
            <h3 className="text-sm font-semibold text-stone-900">Availability</h3>
          </div>
          <div className="px-5 py-4 text-sm text-stone-600 space-y-1">
            {(() => {
              const lines = summarizeAvailability(availability)
              if (lines.length === 0) {
                return <p className="text-stone-500">No availability set.</p>
              }
              return lines.map((line) => <p key={line}>{line}</p>)
            })()}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm">
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
    </div>
    </ErrorBoundary>
  )
}
