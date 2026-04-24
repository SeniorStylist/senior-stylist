'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { formatCents, formatDate, formatTime } from '@/lib/utils'
import type { Resident, Stylist, Service } from '@/types'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { useToast } from '@/components/ui/toast'

type BookingStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show'

interface HistoryBooking {
  id: string
  startTime: string
  endTime: string
  priceCents: number | null
  status: string
  paymentStatus: string
  cancellationReason: string | null
  notes: string | null
  stylist: Stylist
  service: Service
}

interface ResidentStats {
  total: number
  totalSpent: number
  mostCommonService: string | null
  firstVisit: string | null
}

interface ResidentDetailClientProps {
  resident: Resident
  bookings: HistoryBooking[]
  stats: ResidentStats
  preferredServiceName?: string | null
  facilityServices?: Service[]
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-stone-100 text-stone-500 line-through',
  no_show: 'bg-orange-50 text-orange-700',
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No show',
}

export function ResidentDetailClient({ resident: initialResident, bookings, stats, preferredServiceName, facilityServices = [] }: ResidentDetailClientProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [resident, setResident] = useState(initialResident)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(initialResident.name)
  const [roomNumber, setRoomNumber] = useState(initialResident.roomNumber ?? '')
  const [phone, setPhone] = useState(initialResident.phone ?? '')
  const [notes, setNotes] = useState(initialResident.notes ?? '')
  const [defaultServiceId, setDefaultServiceId] = useState(initialResident.defaultServiceId ?? '')
  const [poaName, setPoaName] = useState(initialResident.poaName ?? '')
  const [poaEmail, setPoaEmail] = useState(initialResident.poaEmail ?? '')
  const [poaPhone, setPoaPhone] = useState(initialResident.poaPhone ?? '')
  const [poaPaymentMethod, setPoaPaymentMethod] = useState(initialResident.poaPaymentMethod ?? '')
  const [poaNotificationsEnabled, setPoaNotificationsEnabled] = useState(initialResident.poaNotificationsEnabled !== false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [sendingLink, setSendingLink] = useState(false)
  const [linkSent, setLinkSent] = useState(false)

  const portalUrl = typeof window !== 'undefined' && resident.portalToken
    ? `${window.location.origin}/portal/${resident.portalToken}`
    : null

  const copyPortalLink = () => {
    if (!portalUrl) return
    navigator.clipboard.writeText(portalUrl).then(() => {
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    })
  }

  const handleSendPortalLink = useCallback(async () => {
    setSendingLink(true)
    try {
      const res = await fetch(`/api/residents/${resident.id}/send-portal-link`, { method: 'POST' })
      if (res.ok) {
        setLinkSent(true)
        toast('Portal link sent', 'success')
        setTimeout(() => setLinkSent(false), 3000)
      } else {
        toast('Failed to send link', 'error')
      }
    } finally {
      setSendingLink(false)
    }
  }, [resident.id, toast])

  const handleSave = async () => {
    if (!name.trim()) { setSaveError('Name is required'); return }
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/residents/${resident.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          roomNumber: roomNumber.trim() || undefined,
          phone: phone.trim() || undefined,
          notes: notes.trim() || undefined,
          defaultServiceId: defaultServiceId || null,
          poaName: poaName.trim() || undefined,
          poaEmail: poaEmail.trim() || undefined,
          poaPhone: poaPhone.trim() || undefined,
          poaPaymentMethod: poaPaymentMethod || undefined,
          poaNotificationsEnabled,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setResident(json.data)
        setEditing(false)
        toast('Changes saved', 'success')
        router.refresh()
      } else {
        setSaveError(json.error ?? 'Failed to save')
      }
    } catch {
      setSaveError('Network error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      const res = await fetch(`/api/residents/${resident.id}`, { method: 'DELETE' })
      if (res.ok) {
        router.push('/residents')
      }
    } finally {
      setDeleting(false)
    }
  }

  const cancelEdit = () => {
    setEditing(false)
    setName(resident.name)
    setRoomNumber(resident.roomNumber ?? '')
    setPhone(resident.phone ?? '')
    setNotes(resident.notes ?? '')
    setDefaultServiceId(resident.defaultServiceId ?? '')
    setPoaName(resident.poaName ?? '')
    setPoaEmail(resident.poaEmail ?? '')
    setPoaPhone(resident.poaPhone ?? '')
    setPoaPaymentMethod(resident.poaPaymentMethod ?? '')
    setPoaNotificationsEnabled(resident.poaNotificationsEnabled !== false)
    setSaveError(null)
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
            {resident.name}
          </h1>
          {resident.roomNumber && (
            <p className="text-sm text-stone-500">Room {resident.roomNumber}</p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Appointments', value: stats.total },
          { label: 'Total spent', value: stats.totalSpent > 0 ? formatCents(stats.totalSpent) : '—' },
          { label: 'Favorite service', value: stats.mostCommonService ?? '—' },
          { label: 'First visit', value: stats.firstVisit ? new Date(stats.firstVisit).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4 text-center"
          >
            <p className="text-lg font-bold text-stone-900 truncate">{stat.value}</p>
            <p className="text-xs text-stone-500 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-5">
        {/* Info card */}
        <div className="col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
            <div className="flex justify-between items-start mb-4">
              <Avatar name={resident.name} size="lg" />
              {!editing && (
                <button
                  onClick={() => setEditing(true)}
                  className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                  title="Edit"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              )}
            </div>

            {editing ? (
              <div className="space-y-3">
                {saveError && <p className="text-xs text-red-600">{saveError}</p>}
                <div>
                  <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Name *</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Room</label>
                  <input
                    value={roomNumber}
                    onChange={(e) => setRoomNumber(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Phone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all resize-none"
                  />
                </div>
                {facilityServices.length > 0 && (
                  <div>
                    <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Preferred Service</label>
                    <select
                      value={defaultServiceId}
                      onChange={(e) => setDefaultServiceId(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] transition-all"
                    >
                      <option value="">No preference</option>
                      {facilityServices.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {/* POA fields */}
                <div className="pt-2 border-t border-stone-100">
                  <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Power of Attorney</p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">POA Name</label>
                      <input
                        value={poaName}
                        onChange={(e) => setPoaName(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">POA Email</label>
                      <input
                        type="email"
                        value={poaEmail}
                        onChange={(e) => setPoaEmail(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">POA Phone</label>
                      <input
                        type="tel"
                        value={poaPhone}
                        onChange={(e) => setPoaPhone(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Preferred Payment</label>
                      <select
                        value={poaPaymentMethod}
                        onChange={(e) => setPoaPaymentMethod(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] transition-all"
                      >
                        <option value="">Not specified</option>
                        <option value="cash">Cash</option>
                        <option value="check">Check</option>
                        <option value="credit card">Credit card</option>
                        <option value="facility billing">Facility billing</option>
                        <option value="insurance">Insurance</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <label htmlFor="poa-notif" className="text-sm text-stone-700">
                        Send booking confirmations to POA
                      </label>
                      <input
                        id="poa-notif"
                        type="checkbox"
                        checked={poaNotificationsEnabled}
                        onChange={e => setPoaNotificationsEnabled(e.target.checked)}
                        className="h-4 w-4 rounded accent-[#8B2E4A]"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>Cancel</Button>
                  <Button size="sm" loading={saving} onClick={handleSave} className="flex-1">Save</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <InfoRow label="Name" value={resident.name} />
                <InfoRow label="Room" value={resident.roomNumber ? `Room ${resident.roomNumber}` : undefined} />
                <InfoRow label="Phone" value={resident.phone ?? undefined} />
                {preferredServiceName && (
                  <div>
                    <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">Preferred Service</p>
                    <span className="inline-flex items-center bg-rose-50 text-[#8B2E4A] px-2 py-0.5 rounded-full text-xs font-medium">
                      Prefers: {preferredServiceName}
                    </span>
                  </div>
                )}
                {resident.notes && (
                  <div>
                    <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">Notes</p>
                    <p className="text-sm text-stone-700 whitespace-pre-wrap">{resident.notes}</p>
                  </div>
                )}
                {(resident.poaName || resident.poaEmail || resident.poaPhone || resident.poaPaymentMethod) && (
                  <div className="pt-2 border-t border-stone-100">
                    <p className="text-xs font-semibold text-[#8B2E4A] uppercase tracking-wide mb-2">Power of Attorney</p>
                    <InfoRow label="Name" value={resident.poaName ?? undefined} />
                    <InfoRow label="Email" value={resident.poaEmail ?? undefined} />
                    {resident.poaEmail && (
                      <div className="mt-1 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          resident.poaNotificationsEnabled
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-stone-100 text-stone-500'
                        }`}>
                          {resident.poaNotificationsEnabled ? 'Confirmations on' : 'Confirmations off'}
                        </span>
                      </div>
                    )}
                    <InfoRow label="Phone" value={resident.poaPhone ?? undefined} />
                    <InfoRow label="Payment" value={resident.poaPaymentMethod ?? undefined} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Portal link */}
          {resident.portalToken && (
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4">
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">Portal Link</p>
              <p className="text-xs text-stone-400 mb-3">Share with resident or family</p>
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={copyPortalLink}
                  className="flex-1"
                >
                  {linkCopied ? 'Copied!' : 'Copy Link'}
                </Button>
                {portalUrl && (
                  <a
                    href={portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors"
                  >
                    Open Portal
                  </a>
                )}
                {resident.poaEmail && (
                  <button
                    onClick={handleSendPortalLink}
                    disabled={sendingLink}
                    className="inline-flex items-center justify-center px-3 py-1.5 rounded-xl text-xs font-medium border border-[#8B2E4A] text-[#8B2E4A] hover:bg-rose-50 transition-colors disabled:opacity-40 min-h-[44px]"
                  >
                    {sendingLink ? 'Sending…' : linkSent ? 'Sent!' : 'Send portal link'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Delete */}
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4">
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Danger zone</p>
            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-xs text-stone-600">Remove this resident? This cannot be undone.</p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button>
                  <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>Yes, remove</Button>
                </div>
              </div>
            ) : (
              <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
                Remove resident
              </Button>
            )}
          </div>
        </div>

        {/* Booking history */}
        <div className="col-span-3 bg-white rounded-2xl border border-stone-100 shadow-sm">
          <div className="px-5 py-4 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-stone-900">Appointment history</h2>
            <p className="text-xs text-stone-500 mt-0.5">{stats.total} total</p>
          </div>

          {bookings.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-stone-600">No appointments yet</p>
              <p className="text-xs text-stone-400">Appointments for this resident will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-stone-50">
              {bookings.map((booking) => (
                <div key={booking.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="shrink-0 w-10 text-center">
                    <p className="text-xs font-medium text-stone-400 uppercase leading-none">
                      {new Date(booking.startTime).toLocaleDateString('en-US', { month: 'short' })}
                    </p>
                    <p className="text-xl font-bold text-stone-900 leading-tight">
                      {new Date(booking.startTime).getDate()}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-stone-900 truncate">{booking.service.name}</p>
                    <p className="text-xs text-stone-500 truncate">
                      {booking.stylist.name} · {formatTime(booking.startTime)}
                    </p>
                    {booking.notes && (
                      <p className="text-xs text-stone-400 mt-0.5 italic truncate">{booking.notes}</p>
                    )}
                    {booking.status === 'cancelled' && booking.cancellationReason && (
                      <p className="text-xs text-stone-400 mt-0.5 italic truncate">Reason: {booking.cancellationReason}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right space-y-1">
                    <p className="text-sm font-semibold text-stone-700">
                      {formatCents(booking.priceCents ?? booking.service.priceCents)}
                    </p>
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[booking.status] ?? 'bg-stone-100 text-stone-500'}`}
                    >
                      {STATUS_LABELS[booking.status] ?? booking.status}
                    </span>
                    {booking.status === 'completed' && (
                      <div>
                        <span
                          className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                            booking.paymentStatus === 'paid'
                              ? 'bg-green-50 text-green-700'
                              : booking.paymentStatus === 'waived'
                              ? 'bg-stone-100 text-stone-500'
                              : 'bg-stone-50 text-stone-400'
                          }`}
                        >
                          {booking.paymentStatus === 'paid'
                            ? 'Paid'
                            : booking.paymentStatus === 'waived'
                            ? 'Waived'
                            : 'Unpaid'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </ErrorBoundary>
  )
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-stone-800">{value}</p>
    </div>
  )
}
