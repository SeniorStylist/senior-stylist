'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { formatCents, formatTime } from '@/lib/utils'
import type { Stylist, ComplianceDocumentWithUrl, ComplianceDocumentType } from '@/types'

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
  googleCalendarConnected: boolean
  complianceDocuments: ComplianceDocumentWithUrl[]
  stylistId: string | null
}

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

export function MyAccountClient({ user, stylist, weekBookings, monthEarningsCents, linked, facilityStylists, googleCalendarConnected, complianceDocuments, stylistId }: MyAccountClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedStylistId, setSelectedStylistId] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [welcomeBanner, setWelcomeBanner] = useState<string | null>(null)
  const [calendarBanner, setCalendarBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadType, setUploadType] = useState<ComplianceDocumentType>('license')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadExpires, setUploadExpires] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const handleUpload = async () => {
    if (!uploadFile || !stylistId) return
    setUploading(true)
    setUploadError(null)
    try {
      const fd = new FormData()
      fd.append('file', uploadFile)
      fd.append('stylistId', stylistId)
      fd.append('documentType', uploadType)
      if (uploadExpires && (uploadType === 'license' || uploadType === 'insurance')) {
        fd.append('expiresAt', uploadExpires)
      }
      const res = await fetch('/api/compliance/upload', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setUploadError(typeof json.error === 'string' ? json.error : 'Upload failed')
        return
      }
      setUploadFile(null)
      setUploadExpires('')
      setUploadOpen(false)
      router.refresh()
    } catch {
      setUploadError('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteDoc = async (id: string) => {
    const res = await fetch(`/api/compliance/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setConfirmDeleteId(null)
      router.refresh()
    }
  }

  useEffect(() => {
    if (searchParams.get('welcome') === '1') {
      setWelcomeBanner(
        linked && stylist
          ? `Welcome! Your account is linked to ${stylist.name}.`
          : 'Welcome! Link your stylist profile in the section below.'
      )
      window.history.replaceState({}, '', '/my-account')
    }
    const calendarParam = searchParams.get('calendar')
    if (calendarParam === 'connected') {
      setCalendarBanner({ type: 'success', message: 'Google Calendar connected! Your bookings will now sync automatically.' })
      window.history.replaceState({}, '', '/my-account')
    } else if (calendarParam === 'error') {
      setCalendarBanner({ type: 'error', message: 'Failed to connect Google Calendar. Please try again.' })
      window.history.replaceState({}, '', '/my-account')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      const res = await fetch('/api/auth/google-calendar/disconnect', { method: 'POST' })
      if (res.ok) {
        router.refresh()
      } else {
        setCalendarBanner({ type: 'error', message: 'Failed to disconnect. Please try again.' })
        setConfirmDisconnect(false)
      }
    } catch {
      setCalendarBanner({ type: 'error', message: 'Failed to disconnect. Please try again.' })
      setConfirmDisconnect(false)
    } finally {
      setDisconnecting(false)
    }
  }

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

      {/* Calendar banner */}
      {calendarBanner && (
        <div className={`rounded-2xl p-4 flex items-start gap-3 ${calendarBanner.type === 'success' ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={calendarBanner.type === 'success' ? '#059669' : '#dc2626'} strokeWidth="2" className="shrink-0 mt-0.5">
            {calendarBanner.type === 'success'
              ? <polyline points="20 6 9 17 4 12" />
              : <><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
            }
          </svg>
          <p className={`text-sm ${calendarBanner.type === 'success' ? 'text-emerald-800' : 'text-red-800'}`}>{calendarBanner.message}</p>
        </div>
      )}

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

      {/* Google Calendar card */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Google Calendar</p>
          {googleCalendarConnected && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Connected
            </span>
          )}
        </div>
        {googleCalendarConnected ? (
          <>
            <p className="text-sm text-stone-500 mb-4">Your bookings sync to your personal Google Calendar.</p>
            {!confirmDisconnect ? (
              <button
                onClick={() => setConfirmDisconnect(true)}
                className="text-sm font-medium text-red-500 hover:text-red-700 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="text-sm font-medium text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-xl disabled:opacity-50 transition-colors"
                >
                  {disconnecting ? 'Disconnecting…' : 'Yes, disconnect'}
                </button>
                <button
                  onClick={() => setConfirmDisconnect(false)}
                  className="text-sm text-stone-500 hover:text-stone-700 px-3 py-1.5 rounded-xl border border-stone-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-stone-500 mb-4">Sync your bookings to your personal Google Calendar.</p>
            <a
              href="/api/auth/google-calendar/connect"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors"
              style={{ backgroundColor: '#8B2E4A' }}
            >
              Connect Google Calendar
            </a>
          </>
        )}
      </div>

      {/* Compliance Documents card */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">
            Compliance Documents
          </p>
          {!uploadOpen && (
            <button
              onClick={() => setUploadOpen(true)}
              className="text-xs font-medium px-2.5 py-1 rounded-lg border border-rose-200 text-[#8B2E4A] hover:bg-rose-50 transition-colors"
            >
              + Upload Document
            </button>
          )}
        </div>

        {uploadOpen && (
          <div className="mb-4 p-4 rounded-xl bg-rose-50 border border-rose-100 space-y-3">
            <div>
              <label className="text-xs font-medium text-stone-600 block mb-1">Type</label>
              <select
                value={uploadType}
                onChange={(e) => setUploadType(e.target.value as ComplianceDocumentType)}
                className="w-full px-3 py-2 rounded-xl border border-rose-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-100"
              >
                <option value="license">License</option>
                <option value="insurance">Insurance</option>
                <option value="w9">W-9</option>
                <option value="contractor_agreement">Contractor Agreement</option>
                <option value="background_check">Background Check</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-stone-600 block mb-1">File (PDF / JPG / PNG, max 10MB)</label>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm"
              />
            </div>
            {(uploadType === 'license' || uploadType === 'insurance') && (
              <div>
                <label className="text-xs font-medium text-stone-600 block mb-1">Expiry date</label>
                <input
                  type="date"
                  value={uploadExpires}
                  onChange={(e) => setUploadExpires(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-rose-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-100"
                />
              </div>
            )}
            {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleUpload}
                disabled={!uploadFile || uploading}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
                style={{ backgroundColor: '#8B2E4A' }}
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
              <button
                onClick={() => { setUploadOpen(false); setUploadFile(null); setUploadError(null); setUploadExpires('') }}
                className="px-4 py-2 rounded-xl text-sm text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {complianceDocuments.length === 0 ? (
          <p className="text-sm text-stone-400 py-2">No documents uploaded yet.</p>
        ) : (
          <ul className="space-y-2">
            {complianceDocuments.map((doc) => {
              const type = doc.documentType as ComplianceDocumentType
              return (
                <li key={doc.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-stone-50 border border-stone-100">
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
                  {confirmDeleteId === doc.id ? (
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => handleDeleteDoc(doc.id)}
                        className="text-xs px-2 py-1 rounded-lg text-white bg-red-500 hover:bg-red-600"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs px-2 py-1 rounded-lg text-stone-600 border border-stone-200"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(doc.id)}
                      disabled={doc.verified}
                      title={doc.verified ? 'Verified documents can only be deleted by an admin' : 'Delete'}
                      className="shrink-0 text-stone-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                      </svg>
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
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
