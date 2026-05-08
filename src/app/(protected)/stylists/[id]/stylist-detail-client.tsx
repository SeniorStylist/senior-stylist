'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn, formatCents, formatTime } from '@/lib/utils'
import type {
  Stylist,
  Service,
  Resident,
  ComplianceDocumentWithUrl,
  ComplianceDocumentType,
  StylistAvailability,
  StylistFacilityAssignment,
  StylistNote,
  StylistStatus,
} from '@/types'
import { resolveCommission } from '@/lib/stylist-commission'
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

const PHONE_LABELS = ['mobile', 'office', 'home', 'work', 'fax', 'custom'] as const
type PhoneLabelOption = typeof PHONE_LABELS[number]

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

type AssignmentRow = StylistFacilityAssignment & { facilityName: string }
type NoteRow = StylistNote & { authorEmail: string | null }

const STATUS_OPTIONS: { value: StylistStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'on_leave', label: 'On Leave' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'terminated', label: 'Terminated' },
]

function statusDot(s: StylistStatus) {
  if (s === 'active') return 'bg-emerald-500'
  if (s === 'on_leave') return 'bg-amber-400'
  return 'bg-stone-400'
}

const PRESET_SPECIALTIES = ['Hair', 'Nails', 'Skincare']

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
  isMasterAdmin?: boolean
  franchiseFacilities?: Array<{ id: string; name: string }>
  assignments?: AssignmentRow[]
  notes?: NoteRow[]
  hasLinkedAccount?: boolean
  lastInviteSentAt?: string | null
}

export function StylistDetailClient({
  stylist: initialStylist,
  upcomingBookings,
  stats,
  complianceDocuments,
  availability,
  isAdmin,
  isMasterAdmin = false,
  franchiseFacilities = [],
  assignments: initialAssignments = [],
  notes: initialNotes = [],
  hasLinkedAccount = false,
  lastInviteSentAt = null,
}: StylistDetailClientProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [stylist, setStylist] = useState(initialStylist)
  const [name, setName] = useState(initialStylist.name)
  const [color, setColor] = useState(initialStylist.color)
  const [commissionPercent, setCommissionPercent] = useState(initialStylist.commissionPercent)
  const [licenseNumber, setLicenseNumber] = useState(initialStylist.licenseNumber ?? '')
  const [licenseType, setLicenseType] = useState(initialStylist.licenseType ?? '')
  const [licenseState, setLicenseState] = useState(initialStylist.licenseState ?? '')
  const [licenseExpiresAt, setLicenseExpiresAt] = useState(initialStylist.licenseExpiresAt ?? '')
  const [address, setAddress] = useState(initialStylist.address ?? '')
  const [paymentMethod, setPaymentMethod] = useState(initialStylist.paymentMethod ?? '')
  const [editingCommission, setEditingCommission] = useState(false)
  const [commissionInput, setCommissionInput] = useState(String(initialStylist.commissionPercent))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [stylistCode, setStylistCode] = useState(initialStylist.stylistCode)
  const [facilityId, setFacilityId] = useState<string | null>(initialStylist.facilityId)
  const [phones, setPhones] = useState<Array<{ label: string; number: string }>>(
    initialStylist.phones ?? []
  )
  const [status, setStatus] = useState<StylistStatus>(initialStylist.status ?? 'active')
  const [specialties, setSpecialties] = useState<string[]>(initialStylist.specialties ?? [])
  const [addingSpecialty, setAddingSpecialty] = useState(false)
  const [newSpecialtyInput, setNewSpecialtyInput] = useState('')
  const [assignments, setAssignments] = useState<AssignmentRow[]>(initialAssignments)
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null)
  const [editCommissionInput, setEditCommissionInput] = useState('')
  const [addingAssignment, setAddingAssignment] = useState(false)
  const [newAssignmentFacilityId, setNewAssignmentFacilityId] = useState('')
  const [newAssignmentCommission, setNewAssignmentCommission] = useState('')
  const [savingAssignment, setSavingAssignment] = useState(false)
  const [notes, setNotes] = useState<NoteRow[]>(initialNotes)
  const [newNoteBody, setNewNoteBody] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [email, setEmail] = useState(initialStylist.email ?? '')
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const licenseDirty =
    licenseNumber !== (stylist.licenseNumber ?? '') ||
    licenseType !== (stylist.licenseType ?? '') ||
    licenseState !== (stylist.licenseState ?? '') ||
    licenseExpiresAt !== (stylist.licenseExpiresAt ?? '')
  const codeDirty = stylistCode !== stylist.stylistCode
  const facilityDirty = facilityId !== stylist.facilityId
  const phonesDirty = JSON.stringify(phones) !== JSON.stringify(stylist.phones ?? [])
  const statusDirty = status !== (stylist.status ?? 'active')
  const specialtiesDirty =
    JSON.stringify(specialties) !== JSON.stringify(stylist.specialties ?? [])

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

  const isDirty =
    name !== stylist.name ||
    color !== stylist.color ||
    commissionPercent !== stylist.commissionPercent ||
    email !== (stylist.email ?? '') ||
    licenseDirty ||
    codeDirty ||
    facilityDirty ||
    phonesDirty ||
    statusDirty ||
    specialtiesDirty ||
    address !== (stylist.address ?? '') ||
    paymentMethod !== (stylist.paymentMethod ?? '')

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    if (codeDirty && !/^ST\d{3,}$/.test(stylistCode.trim())) {
      setError('Stylist code must match ST### (e.g. ST001)')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        color,
        commissionPercent,
        email: email.trim() || null,
        licenseNumber: licenseNumber.trim() || null,
        licenseType: licenseType.trim() || null,
        licenseState: licenseState.trim() || null,
        licenseExpiresAt: licenseExpiresAt || null,
        phones,
        status,
        specialties,
        address: address.trim() || null,
        paymentMethod: paymentMethod || null,
      }
      if (codeDirty) body.stylistCode = stylistCode.trim()
      if (facilityDirty) body.facilityId = facilityId
      const res = await fetch(`/api/stylists/${stylist.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
    <div className="page-enter p-6 max-w-5xl mx-auto">
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
            className="text-2xl font-normal text-stone-900"
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
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">
                Stylist code
              </label>
              {isMasterAdmin ? (
                <input
                  value={stylistCode}
                  onChange={(e) => setStylistCode(e.target.value.toUpperCase())}
                  placeholder="ST###"
                  className="w-32 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm font-mono text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                />
              ) : (
                <span className="text-sm font-mono text-stone-700">{stylist.stylistCode}</span>
              )}
            </div>

            {franchiseFacilities.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">
                  Facility assignment
                </label>
                <select
                  value={facilityId ?? ''}
                  onChange={(e) => setFacilityId(e.target.value || null)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                >
                  <option value="">Unassigned (franchise pool)</option>
                  {franchiseFacilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

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
                    className="w-20 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
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

            {isAdmin && (
              <div>
                <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">
                  Email
                </label>
                {stylist.email ? (
                  <p className="text-sm text-stone-700 mb-2 break-all">{stylist.email}</p>
                ) : (
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Add email address"
                    className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 mb-2"
                  />
                )}
                {stylist.email && (hasLinkedAccount ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Account linked
                  </span>
                ) : (() => {
                  const hoursSince = lastInviteSentAt
                    ? (Date.now() - new Date(lastInviteSentAt).getTime()) / 3_600_000
                    : null
                  if (hoursSince !== null && hoursSince < 24) {
                    return (
                      <p className="text-xs text-stone-400">
                        Invite sent {Math.floor(hoursSince)}h ago
                      </p>
                    )
                  }
                  return (
                    <button
                      type="button"
                      disabled={inviteStatus === 'sending'}
                      onClick={async () => {
                        setInviteStatus('sending')
                        setError(null)
                        try {
                          const res = await fetch(`/api/stylists/${stylist.id}/invite`, { method: 'POST' })
                          if (res.ok) {
                            setInviteStatus('sent')
                          } else {
                            const body = await res.json().catch(() => ({}))
                            setError(typeof body.error === 'string' ? body.error : 'Failed to send invite')
                            setInviteStatus('error')
                          }
                        } catch {
                          setError('Failed to send invite')
                          setInviteStatus('error')
                        }
                      }}
                      className="text-xs font-medium text-[#8B2E4A] hover:text-[#72253C] underline underline-offset-2 disabled:opacity-50 transition-colors"
                    >
                      {inviteStatus === 'sending'
                        ? 'Sending…'
                        : inviteStatus === 'sent'
                          ? 'Invite sent ✓'
                          : 'Send account invite →'}
                    </button>
                  )
                })())}
              </div>
            )}

            {isAdmin && (
              <div>
                <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1.5">
                  Status
                </label>
                <div className="flex items-center gap-2">
                  <span className={cn('w-2 h-2 rounded-full shrink-0', statusDot(status))} />
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as StylistStatus)}
                    className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {isAdmin && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                    Specialties
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {specialties.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 px-2 py-0.5 rounded-full text-xs font-medium"
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() => setSpecialties((prev) => prev.filter((x) => x !== s))}
                        className="text-rose-400 hover:text-rose-700 transition-colors"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </span>
                  ))}
                  {PRESET_SPECIALTIES.filter((p) => !specialties.includes(p)).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setSpecialties((prev) => [...prev, p])}
                      className="inline-flex items-center bg-stone-100 text-stone-500 hover:bg-rose-50 hover:text-rose-700 px-2 py-0.5 rounded-full text-xs font-medium transition-colors"
                    >
                      + {p}
                    </button>
                  ))}
                </div>
                {addingSpecialty ? (
                  <div className="flex gap-1.5 items-center">
                    <input
                      autoFocus
                      value={newSpecialtyInput}
                      onChange={(e) => setNewSpecialtyInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newSpecialtyInput.trim()) {
                          const val = newSpecialtyInput.trim()
                          if (!specialties.includes(val)) setSpecialties((prev) => [...prev, val])
                          setNewSpecialtyInput('')
                          setAddingSpecialty(false)
                        }
                        if (e.key === 'Escape') { setNewSpecialtyInput(''); setAddingSpecialty(false) }
                      }}
                      placeholder="Custom specialty"
                      className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1 text-xs text-stone-700 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = newSpecialtyInput.trim()
                        if (val && !specialties.includes(val)) setSpecialties((prev) => [...prev, val])
                        setNewSpecialtyInput('')
                        setAddingSpecialty(false)
                      }}
                      className="text-xs text-[#8B2E4A] font-semibold hover:text-rose-800"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => { setNewSpecialtyInput(''); setAddingSpecialty(false) }}
                      className="text-xs text-stone-400 hover:text-stone-600"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingSpecialty(true)}
                    className="text-xs text-[#8B2E4A] font-semibold hover:text-rose-800 transition-colors"
                  >
                    + Custom
                  </button>
                )}
              </div>
            )}

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
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                    placeholder="e.g. 123456"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-stone-500 block mb-1">Type</label>
                  <input
                    value={licenseType}
                    onChange={(e) => setLicenseType(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                    placeholder="e.g. Cosmetology"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-stone-500 block mb-1">Licensed In</label>
                  <input
                    value={licenseState}
                    onChange={(e) => setLicenseState(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                    placeholder="e.g. MD, VA"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-stone-500 block mb-1">Expires</label>
                  <input
                    type="date"
                    value={licenseExpiresAt}
                    onChange={(e) => setLicenseExpiresAt(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
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

            {isAdmin && (
              <div className="pt-4 border-t border-stone-100 space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Phone numbers</p>
                  <button
                    type="button"
                    onClick={() => setPhones((prev) => [...prev, { label: 'mobile', number: '' }])}
                    className="text-xs text-[#8B2E4A] font-semibold hover:text-rose-800 transition-colors"
                  >
                    + Add
                  </button>
                </div>
                {phones.length === 0 ? (
                  <p className="text-xs text-stone-400 italic">No phone numbers</p>
                ) : (
                  <div className="space-y-2">
                    {phones.map((ph, idx) => {
                      const isCustom = !(PHONE_LABELS as readonly string[]).slice(0, -1).includes(ph.label)
                      const selectValue = isCustom ? 'custom' : (ph.label as PhoneLabelOption)
                      return (
                        <div key={idx} className="flex gap-1.5 items-center">
                          <select
                            value={selectValue}
                            onChange={(e) => {
                              const val = e.target.value
                              setPhones((prev) => {
                                const next = [...prev]
                                next[idx] = { ...next[idx], label: val === 'custom' ? '' : val }
                                return next
                              })
                            }}
                            className="w-24 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-stone-700 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                          >
                            {PHONE_LABELS.map((l) => (
                              <option key={l} value={l}>{l}</option>
                            ))}
                          </select>
                          {isCustom && (
                            <input
                              value={ph.label}
                              onChange={(e) => {
                                const val = e.target.value
                                setPhones((prev) => {
                                  const next = [...prev]
                                  next[idx] = { ...next[idx], label: val }
                                  return next
                                })
                              }}
                              placeholder="label"
                              className="w-20 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-stone-700 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                            />
                          )}
                          <input
                            value={ph.number}
                            onChange={(e) => {
                              const val = e.target.value
                              setPhones((prev) => {
                                const next = [...prev]
                                next[idx] = { ...next[idx], number: val }
                                return next
                              })
                            }}
                            placeholder="555-000-0000"
                            className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-stone-700 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                          />
                          <button
                            type="button"
                            onClick={() => setPhones((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-stone-300 hover:text-red-400 transition-colors p-1 shrink-0"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {isAdmin && (
              <div className="pt-4 border-t border-stone-100 space-y-2">
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Contact</p>
                <div>
                  <span className="text-[11px] text-stone-500 block mb-0.5">Address</span>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Main St, City, State"
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                  />
                </div>
                <div>
                  <span className="text-[11px] text-stone-500 block mb-0.5">Payment Method</span>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                  >
                    <option value="">— select —</option>
                    <option value="Commission">Commission</option>
                    <option value="Hourly">Hourly</option>
                    <option value="Flat Rate">Flat Rate</option>
                    <option value="Booth Rental">Booth Rental</option>
                  </select>
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

        {/* Right column */}
        <div className="col-span-3 space-y-5">

        {/* Facility Assignments */}
        {isAdmin && (
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm">
            <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-stone-900">Facility Assignments</h2>
            </div>
            <div className="divide-y divide-stone-50">
              {assignments.length === 0 && !addingAssignment && (
                <p className="text-sm text-stone-400 px-5 py-4">No assignments yet.</p>
              )}
              {assignments.map((row) => (
                <div key={row.id} className="px-5 py-3">
                  {editingAssignmentId === row.id ? (
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-medium text-stone-700 flex-1">{row.facilityName}</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={editCommissionInput}
                          onChange={(e) => setEditCommissionInput(e.target.value)}
                          placeholder="Default"
                          className="w-20 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-stone-700 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                        />
                        <span className="text-xs text-stone-400">%</span>
                      </div>
                      <button
                        type="button"
                        disabled={savingAssignment}
                        onClick={async () => {
                          setSavingAssignment(true)
                          const val = editCommissionInput === '' ? null : Math.max(0, Math.min(100, parseInt(editCommissionInput) || 0))
                          const res = await fetch(`/api/stylists/${stylist.id}/assignments/${row.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ commissionPercent: val, active: row.active }),
                          })
                          const json = await res.json()
                          setSavingAssignment(false)
                          if (res.ok) {
                            setAssignments((prev) => prev.map((a) => a.id === row.id ? json.data.assignment : a))
                            setEditingAssignmentId(null)
                          } else {
                            toast(json.error ?? 'Failed to save', 'error')
                          }
                        }}
                        className="text-xs text-[#8B2E4A] font-semibold hover:text-rose-800 disabled:opacity-50"
                      >
                        {savingAssignment ? '…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingAssignmentId(null)}
                        className="text-xs text-stone-400 hover:text-stone-600"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-stone-700 flex-1 truncate">{row.facilityName}</span>
                      <span className="text-xs text-stone-500">
                        {row.commissionPercent != null
                          ? `${row.commissionPercent}%`
                          : `Default (${resolveCommission(stylist.commissionPercent, row)}%)`}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await fetch(`/api/stylists/${stylist.id}/assignments/${row.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ active: !row.active }),
                          })
                          const json = await res.json()
                          if (res.ok) {
                            setAssignments((prev) => prev.map((a) => a.id === row.id ? json.data.assignment : a))
                          } else {
                            toast(json.error ?? 'Failed', 'error')
                          }
                        }}
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors',
                          row.active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                        )}
                      >
                        <span className={cn('w-1.5 h-1.5 rounded-full', row.active ? 'bg-emerald-500' : 'bg-stone-400')} />
                        {row.active ? 'Active' : 'Inactive'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAssignmentId(row.id)
                          setEditCommissionInput(row.commissionPercent != null ? String(row.commissionPercent) : '')
                        }}
                        className="text-xs text-stone-400 hover:text-[#8B2E4A] transition-colors font-medium"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {addingAssignment && (() => {
                const assignedIds = new Set(assignments.map((a) => a.facilityId))
                const available = franchiseFacilities.filter((f) => !assignedIds.has(f.id))
                return (
                  <div className="px-5 py-3 flex items-center gap-3 flex-wrap bg-stone-50 rounded-b-2xl">
                    <select
                      value={newAssignmentFacilityId}
                      onChange={(e) => setNewAssignmentFacilityId(e.target.value)}
                      className="flex-1 bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-stone-700 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                    >
                      <option value="">Select facility…</option>
                      {available.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={newAssignmentCommission}
                        onChange={(e) => setNewAssignmentCommission(e.target.value)}
                        placeholder="Default"
                        className="w-20 bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-stone-700 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20"
                      />
                      <span className="text-xs text-stone-400">%</span>
                    </div>
                    <button
                      type="button"
                      disabled={!newAssignmentFacilityId || savingAssignment}
                      onClick={async () => {
                        if (!newAssignmentFacilityId) return
                        setSavingAssignment(true)
                        const commission = newAssignmentCommission === '' ? null : parseInt(newAssignmentCommission) || null
                        const res = await fetch(`/api/stylists/${stylist.id}/assignments`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ facilityId: newAssignmentFacilityId, commissionPercent: commission }),
                        })
                        const json = await res.json()
                        setSavingAssignment(false)
                        if (res.ok) {
                          setAssignments((prev) => {
                            const exists = prev.find((a) => a.id === json.data.assignment.id)
                            if (exists) return prev.map((a) => a.id === json.data.assignment.id ? json.data.assignment : a)
                            return [...prev, json.data.assignment]
                          })
                          setAddingAssignment(false)
                          setNewAssignmentFacilityId('')
                          setNewAssignmentCommission('')
                        } else {
                          toast(json.error ?? 'Failed to add', 'error')
                        }
                      }}
                      className="text-xs text-[#8B2E4A] font-semibold hover:text-rose-800 disabled:opacity-40 transition-colors"
                    >
                      {savingAssignment ? '…' : 'Add'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAddingAssignment(false); setNewAssignmentFacilityId(''); setNewAssignmentCommission('') }}
                      className="text-xs text-stone-400 hover:text-stone-600"
                    >
                      Cancel
                    </button>
                  </div>
                )
              })()}
            </div>
            {franchiseFacilities.length > 0 && !addingAssignment && (
              <div className="px-5 py-3 border-t border-stone-50">
                <button
                  type="button"
                  onClick={() => { setAddingAssignment(true); setNewAssignmentFacilityId(''); setNewAssignmentCommission('') }}
                  className="text-xs text-[#8B2E4A] font-semibold hover:text-rose-800 transition-colors"
                >
                  + Add assignment
                </button>
              </div>
            )}
          </div>
        )}

        {/* Admin Notes */}
        {isAdmin && (
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm">
            <div className="px-5 py-4 border-b border-stone-100">
              <h2 className="text-sm font-semibold text-stone-900">Admin Notes</h2>
              <p className="text-xs text-stone-500 mt-0.5">Internal only — never visible to stylists</p>
            </div>
            <div className="px-5 py-4">
              <div className="flex gap-2 mb-5">
                <textarea
                  value={newNoteBody}
                  onChange={(e) => setNewNoteBody(e.target.value)}
                  placeholder="Add a note…"
                  rows={3}
                  maxLength={5000}
                  className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all resize-none"
                />
                <button
                  type="button"
                  disabled={!newNoteBody.trim() || addingNote}
                  onClick={async () => {
                    if (!newNoteBody.trim()) return
                    setAddingNote(true)
                    const res = await fetch(`/api/stylists/${stylist.id}/notes`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ body: newNoteBody.trim() }),
                    })
                    const json = await res.json()
                    setAddingNote(false)
                    if (res.ok) {
                      setNotes((prev) => [json.data.note, ...prev])
                      setNewNoteBody('')
                    } else {
                      toast(json.error ?? 'Failed to add note', 'error')
                    }
                  }}
                  className="shrink-0 self-start px-3 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-40 transition-colors"
                  style={{ backgroundColor: '#8B2E4A' }}
                >
                  {addingNote ? '…' : 'Add Note'}
                </button>
              </div>
              {notes.length === 0 ? (
                <p className="text-sm text-stone-400 text-center py-2">No notes yet.</p>
              ) : (
                <div className="space-y-3">
                  {notes.map((note) => (
                    <div key={note.id} className="border-t border-stone-100 pt-3 first:border-0 first:pt-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[11px] text-stone-400">
                          {note.createdAt
                            ? new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                            : '—'}
                          {' · '}
                          {note.authorEmail ?? 'Unknown'}
                        </p>
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await fetch(`/api/stylists/${stylist.id}/notes/${note.id}`, { method: 'DELETE' })
                            if (res.ok) {
                              setNotes((prev) => prev.filter((n) => n.id !== note.id))
                            } else {
                              toast('Failed to delete', 'error')
                            }
                          }}
                          className="text-stone-300 hover:text-red-400 transition-colors shrink-0"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
                          </svg>
                        </button>
                      </div>
                      <p className="text-sm text-stone-700 mt-1 whitespace-pre-wrap">{note.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm" data-tour="stylist-compliance-section">
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
          {stylist.scheduleNotes && (
            <div className="px-5 pb-4">
              <p className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide mb-1">
                Schedule notes (unmatched facilities)
              </p>
              <p className="text-xs text-stone-500 italic">{stylist.scheduleNotes}</p>
            </div>
          )}
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
