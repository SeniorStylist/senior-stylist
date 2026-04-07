'use client'

import React, { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Facility } from '@/types'
import { createClient } from '@/lib/supabase/client'

interface ConnectedUser {
  userId: string
  facilityId: string
  role: string
  profile: {
    id: string
    email: string | null
    fullName: string | null
    avatarUrl: string | null
  }
}

interface AccessRequestData {
  id: string
  email: string
  fullName: string | null
  status: string
  role: string
  userId: string | null
  createdAt: string | null
}

interface SettingsClientProps {
  facility: Facility
  connectedUsers: ConnectedUser[]
  currentUserId: string
  currentUserEmail: string | null
  isAdmin: boolean
  pendingRequestsCount: number
}

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
]

type Tab = 'general' | 'integrations' | 'payments' | 'team' | 'invites' | 'access-requests' | 'new-facility'

interface InviteData {
  id: string
  email: string
  inviteRole: string
  used: boolean
  createdAt: string | null
  expiresAt: string
  token: string
}

export function SettingsClient({
  facility,
  connectedUsers,
  currentUserId,
  currentUserEmail,
  isAdmin,
  pendingRequestsCount,
}: SettingsClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') as Tab | null
  const [activeTab, setActiveTab] = useState<Tab>(tabParam ?? 'general')

  useEffect(() => {
    if (tabParam && tabParam !== activeTab) setActiveTab(tabParam)
    if (tabParam === 'invites') { loadInvites(); loadFacilitiesForInvite() }
  }, [tabParam])

  // General form
  const [name, setName] = useState(facility.name)
  const [address, setAddress] = useState(facility.address ?? '')
  const [phone, setPhone] = useState(facility.phone ?? '')
  const [timezone, setTimezone] = useState(facility.timezone)
  const [paymentType, setPaymentType] = useState(facility.paymentType ?? 'facility')
  const [workingDays, setWorkingDays] = useState<string[]>(
    (facility as { workingHours?: { days: string[]; startTime: string; endTime: string } }).workingHours?.days ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  )
  const [workingStart, setWorkingStart] = useState(
    (facility as { workingHours?: { days: string[]; startTime: string; endTime: string } }).workingHours?.startTime ?? '08:00'
  )
  const [workingEnd, setWorkingEnd] = useState(
    (facility as { workingHours?: { days: string[]; startTime: string; endTime: string } }).workingHours?.endTime ?? '18:00'
  )
  const [contactEmail, setContactEmail] = useState(
    (facility as { contactEmail?: string | null }).contactEmail ?? ''
  )
  const [saving, setSaving] = useState(false)

  // Stripe keys form
  const [stripePublishableKey, setStripePublishableKey] = useState(facility.stripePublishableKey ?? '')
  const [stripeSecretKey, setStripeSecretKey] = useState(facility.stripeSecretKey ?? '')
  const [savingStripe, setSavingStripe] = useState(false)
  const [savedStripe, setSavedStripe] = useState(false)
  const [stripeError, setStripeError] = useState('')

  const handleSaveStripe = async () => {
    setSavingStripe(true)
    setStripeError('')
    try {
      const res = await fetch('/api/facility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stripePublishableKey: stripePublishableKey || undefined,
          stripeSecretKey: stripeSecretKey || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        setStripeError(j.error ?? 'Failed to save')
        return
      }
      setSavedStripe(true)
      setTimeout(() => setSavedStripe(false), 2000)
      router.refresh()
    } finally {
      setSavingStripe(false)
    }
  }
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const generalDirty =
    name !== facility.name ||
    address !== (facility.address ?? '') ||
    phone !== (facility.phone ?? '') ||
    timezone !== facility.timezone ||
    paymentType !== (facility.paymentType ?? 'facility') ||
    contactEmail !== ((facility as { contactEmail?: string | null }).contactEmail ?? '')

  const handleSaveGeneral = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/facility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          address: address || undefined,
          phone: phone || undefined,
          timezone,
          paymentType,
          workingHours: { days: workingDays, startTime: workingStart, endTime: workingEnd },
          contactEmail: contactEmail || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        setError(j.error ?? 'Failed to save')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  // Integrations form
  const [calendarId, setCalendarId] = useState(facility.calendarId ?? '')
  const [savingCal, setSavingCal] = useState(false)
  const [savedCal, setSavedCal] = useState(false)
  const calDirty = calendarId !== (facility.calendarId ?? '')

  const handleSaveCalendar = async () => {
    setSavingCal(true)
    try {
      const res = await fetch('/api/facility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId: calendarId || undefined }),
      })
      if (!res.ok) return
      setSavedCal(true)
      setTimeout(() => setSavedCal(false), 2000)
      router.refresh()
    } finally {
      setSavingCal(false)
    }
  }

  const isSuperAdmin = !!(
    process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    currentUserEmail === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  )

  // Invites
  const [invitesList, setInvitesList] = useState<InviteData[]>([])
  const [invitesLoaded, setInvitesLoaded] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('stylist')
  const [inviteFacilityId, setInviteFacilityId] = useState<string>('')
  const [facilitiesList, setFacilitiesList] = useState<{ id: string; name: string }[]>([])
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [resendSuccess, setResendSuccess] = useState<string | null>(null)

  // Access requests
  const [requestsList, setRequestsList] = useState<AccessRequestData[]>([])
  const [requestsLoaded, setRequestsLoaded] = useState(false)
  const [requestRoles, setRequestRoles] = useState<Record<string, string>>({})
  const [requestToast, setRequestToast] = useState<string | null>(null)
  const [actioningId, setActioningId] = useState<string | null>(null)

  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://senior-stylist.vercel.app'

  const loadInvites = async () => {
    if (!isAdmin) return
    if (!isSuperAdmin) {
      const res = await fetch('/api/invites')
      if (res.ok) {
        const j = await res.json()
        setInvitesList(j.data ?? [])
      }
    }
    setInvitesLoaded(true)
  }

  const loadFacilitiesForInvite = async () => {
    if (!isSuperAdmin) return
    const res = await fetch('/api/facilities')
    if (res.ok) {
      const j = await res.json()
      const list: { id: string; name: string }[] = j.data ?? []
      setFacilitiesList(list)
      if (list.length > 0 && !inviteFacilityId) setInviteFacilityId(list[0].id)
    }
  }

  const loadRequests = async () => {
    if (!isAdmin) return
    const res = await fetch('/api/access-requests')
    if (res.ok) {
      const j = await res.json()
      const list: AccessRequestData[] = j.data ?? []
      setRequestsList(list)
      const roles: Record<string, string> = {}
      list.forEach((r) => { roles[r.id] = r.role })
      setRequestRoles(roles)
    }
    setRequestsLoaded(true)
  }

  const handleRequestAction = async (id: string, action: 'approve' | 'deny') => {
    setActioningId(id)
    try {
      const res = await fetch(`/api/access-requests/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, role: requestRoles[id] }),
      })
      if (res.ok) {
        const req = requestsList.find((r) => r.id === id)
        const name = req?.fullName || req?.email || 'User'
        setRequestsList((prev) => prev.filter((r) => r.id !== id))
        setRequestToast(action === 'approve' ? `Access granted to ${name}` : 'Request denied')
        setTimeout(() => setRequestToast(null), 3000)
      }
    } finally {
      setActioningId(null)
    }
  }

  const handleSendInvite = async () => {
    if (!inviteEmail.trim()) { setInviteError('Email is required'); return }
    if (isSuperAdmin && !inviteFacilityId) { setInviteError('Select a facility'); return }
    setSendingInvite(true)
    setInviteError('')
    setInviteSuccess('')
    try {
      const body: Record<string, string> = { email: inviteEmail.trim(), inviteRole }
      if (isSuperAdmin) body.facilityId = inviteFacilityId
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json()
      if (!res.ok) {
        setInviteError(j.error ?? 'Failed to send invite')
        return
      }
      setInviteEmail('')
      setInviteSuccess('Invite sent!')
      setTimeout(() => setInviteSuccess(''), 3000)
      setInvitesList((prev) => [j.data, ...prev])
    } finally {
      setSendingInvite(false)
    }
  }

  const handleRevokeInvite = async (id: string) => {
    setRevokingId(id)
    try {
      const res = await fetch(`/api/invites/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setInvitesList((prev) => prev.filter((i) => i.id !== id))
      }
    } finally {
      setRevokingId(null)
    }
  }

  const handleResendInvite = async (id: string) => {
    setResendingId(id)
    setResendSuccess(null)
    try {
      const res = await fetch(`/api/invites/${id}/resend`, { method: 'POST' })
      if (res.ok) {
        setResendSuccess(id)
        setTimeout(() => setResendSuccess(null), 3000)
      }
    } finally {
      setResendingId(null)
    }
  }

  const copyInviteLink = (token: string) => {
    const link = `${appUrl}/invite/accept?token=${token}`
    navigator.clipboard.writeText(link)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  // New facility form
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newTimezone, setNewTimezone] = useState('America/New_York')
  const [creatingFacility, setCreatingFacility] = useState(false)
  const [createError, setCreateError] = useState('')

  const handleCreateFacility = async () => {
    if (!newName.trim()) return
    setCreatingFacility(true)
    setCreateError('')
    try {
      const res = await fetch('/api/facilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          address: newAddress || undefined,
          phone: newPhone || undefined,
          timezone: newTimezone,
        }),
      })
      const j = await res.json()
      if (!res.ok) {
        setCreateError(j.error ?? 'Failed to create')
        return
      }
      // Switch to new facility and go to dashboard
      await fetch('/api/facilities/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId: j.data.id }),
      })
      router.push('/dashboard')
      router.refresh()
    } finally {
      setCreatingFacility(false)
    }
  }

  const tabs: { id: Tab; label: string | React.ReactNode; adminOnly?: boolean }[] = [
    { id: 'general', label: 'General' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'payments', label: 'Payments', adminOnly: true },
    { id: 'team', label: 'Team' },
    { id: 'invites', label: 'Invites', adminOnly: true },
    {
      id: 'access-requests',
      label: (
        <span className="flex items-center gap-1">
          Requests
          {pendingRequestsCount > 0 && (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold">
              {pendingRequestsCount}
            </span>
          )}
        </span>
      ),
      adminOnly: true,
    },
    { id: 'new-facility', label: '+ New Facility' },
  ]

  return (
    <div className="p-6 md:p-8 max-w-2xl">
      <h1
        className="text-2xl font-bold text-stone-900 mb-1"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        Settings
      </h1>
      <p className="text-stone-500 text-sm mb-6">{facility.name}</p>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-stone-200">
        {tabs.filter((t) => !t.adminOnly || isAdmin).map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id)
              if (tab.id === 'invites' && !invitesLoaded) { loadInvites(); loadFacilitiesForInvite() }
              if (tab.id === 'access-requests' && !requestsLoaded) loadRequests()
            }}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.id
                ? 'border-[#0D7377] text-[#0D7377]'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── General ── */}
      {activeTab === 'general' && (
        <div className="space-y-5">
          {!isAdmin && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              Only facility admins can edit settings.
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Facility Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isAdmin}
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377] disabled:opacity-50 disabled:bg-stone-50"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!isAdmin}
              placeholder="123 Main St, City, State"
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377] disabled:opacity-50 disabled:bg-stone-50"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Phone</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!isAdmin}
              placeholder="(555) 000-0000"
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377] disabled:opacity-50 disabled:bg-stone-50"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              disabled={!isAdmin}
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377] disabled:opacity-50 disabled:bg-stone-50"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Payment Type</label>
            <select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value)}
              disabled={!isAdmin}
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377] disabled:opacity-50 disabled:bg-stone-50"
            >
              <option value="facility">Facility Pays (facility covers all services)</option>
              <option value="ip">Individual Pay (residents pay at time of service)</option>
              <option value="rfms">RFMS (charged to resident account)</option>
              <option value="hybrid">Hybrid (IP + RFMS mixed)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Working Hours</label>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                  <button
                    key={day}
                    type="button"
                    disabled={!isAdmin}
                    onClick={() => setWorkingDays((prev) =>
                      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
                    )}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-75 active:scale-95 disabled:opacity-50 ${
                      workingDays.includes(day)
                        ? 'bg-[#0D7377] text-white'
                        : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-stone-500 mb-1">Start</label>
                  <select
                    value={workingStart}
                    onChange={(e) => setWorkingStart(e.target.value)}
                    disabled={!isAdmin}
                    className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377] disabled:opacity-50 disabled:bg-stone-50"
                  >
                    {Array.from({ length: 32 }, (_, i) => {
                      const totalMins = 360 + i * 30
                      const h = Math.floor(totalMins / 60)
                      const m = totalMins % 60
                      const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
                      const label = new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                      return <option key={val} value={val}>{label}</option>
                    })}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-stone-500 mb-1">End</label>
                  <select
                    value={workingEnd}
                    onChange={(e) => setWorkingEnd(e.target.value)}
                    disabled={!isAdmin}
                    className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377] disabled:opacity-50 disabled:bg-stone-50"
                  >
                    {Array.from({ length: 32 }, (_, i) => {
                      const totalMins = 360 + i * 30
                      const h = Math.floor(totalMins / 60)
                      const m = totalMins % 60
                      const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
                      const label = new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                      return <option key={val} value={val}>{label}</option>
                    })}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">
              Contact Email
            </label>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              disabled={!isAdmin}
              placeholder="admin@yourfacility.com"
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377] disabled:opacity-50 disabled:bg-stone-50"
            />
            <p className="text-[11px] text-stone-400 mt-1">
              Shown on the &ldquo;Request access&rdquo; button for users waiting for an invite.
            </p>
          </div>

          {error && <p className="text-red-600 text-xs">{error}</p>}

          {isAdmin && (
            <button
              onClick={handleSaveGeneral}
              disabled={!generalDirty || saving}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
              style={{ backgroundColor: '#0D7377' }}
            >
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save changes'}
            </button>
          )}
        </div>
      )}

      {/* ── Integrations ── */}
      {activeTab === 'integrations' && (
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Google Calendar ID</label>
            <input
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              disabled={!isAdmin}
              placeholder="your-calendar@group.calendar.google.com"
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377] disabled:opacity-50 disabled:bg-stone-50 font-mono"
            />
            <p className="text-xs text-stone-400 mt-1.5">
              Find this in Google Calendar → Settings → your calendar → Calendar ID.
              New bookings will be synced to this calendar automatically.
            </p>
          </div>

          <div className="rounded-xl bg-stone-50 border border-stone-200 p-4">
            <p className="text-xs font-semibold text-stone-600 mb-2">Setup instructions</p>
            <ol className="text-xs text-stone-500 space-y-1 list-decimal list-inside">
              <li>Create or open a Google Calendar</li>
              <li>Go to Settings → select your calendar</li>
              <li>Scroll to &quot;Integrate calendar&quot; and copy the Calendar ID</li>
              <li>Share the calendar with your service account email</li>
              <li>Paste the Calendar ID above and save</li>
            </ol>
          </div>

          {isAdmin && (
            <button
              onClick={handleSaveCalendar}
              disabled={!calDirty || savingCal}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
              style={{ backgroundColor: '#0D7377' }}
            >
              {savingCal ? 'Saving…' : savedCal ? 'Saved!' : 'Save'}
            </button>
          )}
        </div>
      )}

      {/* ── Team ── */}
      {activeTab === 'team' && (
        <div className="space-y-4">
          <p className="text-xs text-stone-400">
            Users with access to <span className="font-semibold text-stone-600">{facility.name}</span>
          </p>
          <div className="rounded-2xl border border-stone-100 overflow-hidden">
            {connectedUsers.map((cu, i) => {
              const isYou = cu.userId === currentUserId
              const initials = cu.profile.fullName
                ? cu.profile.fullName.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
                : (cu.profile.email?.slice(0, 2).toUpperCase() ?? '??')
              return (
                <div
                  key={cu.userId}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3',
                    i > 0 && 'border-t border-stone-100'
                  )}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ backgroundColor: '#e6faf9', color: '#0D7377' }}
                  >
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-800 truncate">
                      {cu.profile.fullName ?? cu.profile.email ?? 'Unknown'}
                      {isYou && <span className="ml-1.5 text-xs text-stone-400">(you)</span>}
                    </p>
                    {cu.profile.fullName && (
                      <p className="text-xs text-stone-400 truncate">{cu.profile.email}</p>
                    )}
                  </div>
                  <span
                    className={cn(
                      'text-xs font-medium px-2 py-0.5 rounded-full',
                      cu.role === 'admin'
                        ? 'bg-[#e6faf9] text-[#0D7377]'
                        : 'bg-stone-100 text-stone-500'
                    )}
                  >
                    {cu.role}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Invites ── */}
      {activeTab === 'invites' && isAdmin && (
        <div className="space-y-5">
          <p className="text-xs text-stone-400">
            {isSuperAdmin
              ? 'Invite users to any facility. Links expire after 7 days.'
              : <>Invite users to join <span className="font-semibold text-stone-600">{facility.name}</span>. Links expire after 7 days.</>
            }
          </p>

          {/* Send invite form */}
          <div className="flex flex-wrap gap-2">
            {isSuperAdmin && (
              <select
                value={inviteFacilityId}
                onChange={(e) => setInviteFacilityId(e.target.value)}
                className="w-48 px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377]"
              >
                {facilitiesList.length === 0 && <option value="">Loading…</option>}
                {facilitiesList.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            )}
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendInvite()}
              placeholder="colleague@example.com"
              className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377]"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-32 px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377]"
            >
              <option value="admin">Admin</option>
              <option value="stylist">Stylist</option>
              <option value="viewer">Viewer</option>
              {isSuperAdmin && <option value="super_admin">Super Admin</option>}
            </select>
            <button
              onClick={handleSendInvite}
              disabled={sendingInvite || !inviteEmail.trim() || (isSuperAdmin && !inviteFacilityId)}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-all"
              style={{ backgroundColor: '#0D7377' }}
            >
              {sendingInvite ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
          {inviteError && <p className="text-xs text-red-600">{inviteError}</p>}
          {inviteSuccess && <p className="text-xs text-green-600">{inviteSuccess}</p>}

          {/* Pending invites */}
          {invitesList.filter((i) => !i.used).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Pending</p>
              <div className="rounded-2xl border border-stone-100 overflow-hidden">
                {invitesList.filter((i) => !i.used).map((invite, idx) => {
                  const isExpired = new Date(invite.expiresAt) < new Date()
                  return (
                  <div
                    key={invite.id}
                    className={cn('flex items-center gap-3 px-4 py-3', idx > 0 && 'border-t border-stone-100')}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">
                        {invite.email}
                        <span
                          className={cn(
                            'ml-2 text-xs font-medium px-2 py-0.5 rounded-full',
                            invite.inviteRole === 'admin'
                              ? 'bg-[#e6faf9] text-[#0D7377]'
                              : invite.inviteRole === 'viewer'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-stone-100 text-stone-500'
                          )}
                        >
                          {invite.inviteRole || 'stylist'}
                        </span>
                        {isExpired && (
                          <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600">
                            Expired
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-stone-400">
                        Sent {invite.createdAt ? new Date(invite.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                        {' · '}
                        {isExpired ? 'Expired' : 'Expires'} {new Date(invite.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                    {!isExpired && (
                      <button
                        onClick={() => handleResendInvite(invite.id)}
                        disabled={resendingId === invite.id}
                        className="text-xs text-[#0D7377] hover:text-[#0a5f63] font-medium px-2 py-1 rounded-lg hover:bg-teal-50 transition-colors disabled:opacity-40"
                      >
                        {resendingId === invite.id ? 'Sending…' : resendSuccess === invite.id ? 'Sent!' : 'Resend'}
                      </button>
                    )}
                    <button
                      onClick={() => copyInviteLink(invite.token)}
                      className="text-xs text-stone-400 hover:text-stone-600 font-medium px-2 py-1 rounded-lg hover:bg-stone-100 transition-colors"
                    >
                      {copiedToken === invite.token ? 'Copied!' : 'Copy link'}
                    </button>
                    <button
                      onClick={() => handleRevokeInvite(invite.id)}
                      disabled={revokingId === invite.id}
                      className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                      {revokingId === invite.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Accepted invites */}
          {invitesList.filter((i) => i.used).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Accepted</p>
              <div className="rounded-2xl border border-stone-100 overflow-hidden">
                {invitesList.filter((i) => i.used).map((invite, idx) => (
                  <div
                    key={invite.id}
                    className={cn('flex items-center gap-3 px-4 py-3', idx > 0 && 'border-t border-stone-100')}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">
                        {invite.email}
                        <span
                          className={cn(
                            'ml-2 text-xs font-medium px-2 py-0.5 rounded-full',
                            invite.inviteRole === 'admin'
                              ? 'bg-[#e6faf9] text-[#0D7377]'
                              : invite.inviteRole === 'viewer'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-stone-100 text-stone-500'
                          )}
                        >
                          {invite.inviteRole || 'stylist'}
                        </span>
                      </p>
                      <p className="text-xs text-stone-400">
                        Sent {invite.createdAt ? new Date(invite.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                      </p>
                    </div>
                    <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Accepted</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {invitesLoaded && invitesList.length === 0 && (
            <p className="text-sm text-stone-400 text-center py-6">No invites sent yet.</p>
          )}
        </div>
      )}

      {/* ── Payments ── */}
      {activeTab === 'payments' && isAdmin && (
        <div className="space-y-5">
          <p className="text-xs text-stone-400">
            Enter your Stripe keys to enable per-resident payment collection. These are stored securely and used for portal checkout sessions.
          </p>
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Publishable Key</label>
            <input
              type="text"
              value={stripePublishableKey}
              onChange={(e) => setStripePublishableKey(e.target.value)}
              placeholder="pk_live_…"
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377] font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Secret Key</label>
            <input
              type="password"
              value={stripeSecretKey}
              onChange={(e) => setStripeSecretKey(e.target.value)}
              placeholder="sk_live_…"
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377] font-mono"
            />
          </div>
          {stripeError && <p className="text-red-600 text-xs">{stripeError}</p>}
          <button
            onClick={handleSaveStripe}
            disabled={savingStripe}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ backgroundColor: '#0D7377' }}
          >
            {savedStripe ? 'Saved!' : savingStripe ? 'Saving…' : 'Save Keys'}
          </button>
        </div>
      )}

      {/* ── Access Requests ── */}
      {activeTab === 'access-requests' && (
        <div className="space-y-4">
          {requestToast && (
            <div className="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-medium text-emerald-800">
              {requestToast}
            </div>
          )}

          {!requestsLoaded ? (
            <div className="py-8 flex justify-center">
              <div className="w-5 h-5 border-2 border-stone-200 border-t-[#0D7377] rounded-full animate-spin" />
            </div>
          ) : requestsList.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-stone-400">No pending access requests</p>
            </div>
          ) : (
            <div className="space-y-3">
              {requestsList.map((req) => (
                <div key={req.id} className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-stone-900 truncate">
                        {req.fullName || req.email}
                      </p>
                      {req.fullName && (
                        <p className="text-xs text-stone-400 truncate">{req.email}</p>
                      )}
                      {req.createdAt && (
                        <p className="text-[11px] text-stone-400 mt-0.5">
                          {new Date(req.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={requestRoles[req.id] ?? req.role}
                        onChange={(e) => setRequestRoles((prev) => ({ ...prev, [req.id]: e.target.value }))}
                        className="px-2 py-1 rounded-lg border border-stone-200 text-xs text-stone-700 bg-white focus:outline-none"
                      >
                        <option value="stylist">Stylist</option>
                        <option value="admin">Admin</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button
                        onClick={() => handleRequestAction(req.id, 'approve')}
                        disabled={actioningId === req.id}
                        title="Approve"
                        className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleRequestAction(req.id, 'deny')}
                        disabled={actioningId === req.id}
                        title="Deny"
                        className="w-8 h-8 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── New Facility ── */}
      {activeTab === 'new-facility' && (
        <div className="space-y-5">
          <p className="text-sm text-stone-500">
            Create a new facility. You&apos;ll be added as admin and switched to it automatically.
          </p>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Facility Name *</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Sunrise Senior Living"
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Address</label>
            <input
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="123 Main St, City, State"
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Phone</label>
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="(555) 000-0000"
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Timezone</label>
            <select
              value={newTimezone}
              onChange={(e) => setNewTimezone(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377]"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>

          {createError && <p className="text-red-600 text-xs">{createError}</p>}

          <button
            onClick={handleCreateFacility}
            disabled={!newName.trim() || creatingFacility}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ backgroundColor: '#0D7377' }}
          >
            {creatingFacility ? 'Creating…' : 'Create Facility'}
          </button>
        </div>
      )}

      {/* Sign out */}
      <div className="mt-8 pt-6 border-t border-stone-100">
        <button
          onClick={async () => {
            const supabase = createClient()
            await supabase.auth.signOut()
            window.location.href = '/login'
          }}
          className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700 font-medium transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign out
        </button>
      </div>
    </div>
  )
}
