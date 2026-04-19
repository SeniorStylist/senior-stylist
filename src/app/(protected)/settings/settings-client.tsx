'use client'

import React, { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { PublicFacility } from '@/lib/sanitize'
import { createClient } from '@/lib/supabase/client'

interface ConnectedUser {
  userId: string
  facilityId: string
  role: string
  lastSignIn: string | null
  stylistName: string | null
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
  facility: PublicFacility
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

  // Stripe keys form — secret is write-only: we never receive it from the server,
  // so the input stays blank unless the admin is entering a new value.
  const [stripePublishableKey, setStripePublishableKey] = useState(facility.stripePublishableKey ?? '')
  const [stripeSecretKey, setStripeSecretKey] = useState('')
  const hasStripeSecret = facility.hasStripeSecret
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

  // ── QuickBooks ─────────────────────────────────────────────────────────
  const hasQuickBooks = facility.hasQuickBooks
  const qbRealmId = (facility as { qbRealmId?: string | null }).qbRealmId ?? null
  const qbExpenseAccountIdInit =
    (facility as { qbExpenseAccountId?: string | null }).qbExpenseAccountId ?? ''
  const [qbExpenseAccountId, setQbExpenseAccountId] = useState(qbExpenseAccountIdInit)
  const [qbAccounts, setQbAccounts] = useState<
    Array<{ id: string; name: string; accountType: string; accountSubType: string | null }>
  >([])
  const [qbAccountsLoaded, setQbAccountsLoaded] = useState(false)
  const [qbSavingAccount, setQbSavingAccount] = useState(false)
  const [qbSyncing, setQbSyncing] = useState(false)
  const [qbToast, setQbToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [qbConfirmDisconnect, setQbConfirmDisconnect] = useState(false)
  const [qbDisconnecting, setQbDisconnecting] = useState(false)

  const showQbToast = (kind: 'ok' | 'err', text: string) => {
    setQbToast({ kind, text })
    setTimeout(() => setQbToast(null), 4000)
  }

  const loadQbAccounts = async () => {
    setQbAccountsLoaded(false)
    try {
      const res = await fetch('/api/quickbooks/accounts')
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        showQbToast('err', j.error ?? 'Failed to load accounts')
        return
      }
      const j = await res.json()
      setQbAccounts(j.data?.accounts ?? [])
    } finally {
      setQbAccountsLoaded(true)
    }
  }

  const handleSaveExpenseAccount = async () => {
    setQbSavingAccount(true)
    try {
      const res = await fetch('/api/facility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qbExpenseAccountId: qbExpenseAccountId || null }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        showQbToast('err', j.error ?? 'Save failed')
        return
      }
      showQbToast('ok', 'Expense account saved')
      router.refresh()
    } finally {
      setQbSavingAccount(false)
    }
  }

  const handleSyncVendors = async () => {
    setQbSyncing(true)
    try {
      const res = await fetch('/api/quickbooks/sync-vendors', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) {
        showQbToast('err', j.error ?? 'Sync failed')
        return
      }
      const { created, updated, skipped, errors } = j.data
      const bits = [`${created} created`, `${updated} updated`, `${skipped} unchanged`]
      if (errors.length > 0) bits.push(`${errors.length} error(s)`)
      showQbToast(errors.length > 0 ? 'err' : 'ok', `Vendors: ${bits.join(', ')}`)
    } finally {
      setQbSyncing(false)
    }
  }

  const handleDisconnectQb = async () => {
    setQbDisconnecting(true)
    try {
      const res = await fetch('/api/quickbooks/disconnect', { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        showQbToast('err', j.error ?? 'Disconnect failed')
        return
      }
      showQbToast('ok', 'Disconnected from QuickBooks')
      router.refresh()
    } finally {
      setQbDisconnecting(false)
      setQbConfirmDisconnect(false)
    }
  }

  useEffect(() => {
    if (activeTab !== 'integrations' || !hasQuickBooks) return
    if (!qbAccountsLoaded) loadQbAccounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, hasQuickBooks])

  useEffect(() => {
    const qbFlag = searchParams.get('qb')
    if (!qbFlag) return
    if (qbFlag === 'connected') showQbToast('ok', 'QuickBooks connected')
    else if (qbFlag === 'error') {
      const reason = searchParams.get('reason') ?? 'unknown'
      showQbToast('err', `QuickBooks connect failed: ${decodeURIComponent(reason)}`)
    }
    // Clear the URL param to avoid repeated toasts on tab switches.
    const url = new URL(window.location.href)
    url.searchParams.delete('qb')
    url.searchParams.delete('reason')
    window.history.replaceState(null, '', url.toString())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const [inviteFacilityId, setInviteFacilityId] = useState<string>(facility.id)
  const [facilitiesList, setFacilitiesList] = useState<{ id: string; name: string }[]>([])
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [resendSuccess, setResendSuccess] = useState<string | null>(null)

  // Team / remove access
  const [localUsers, setLocalUsers] = useState<ConnectedUser[]>(connectedUsers)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [removingUserId, setRemovingUserId] = useState<string | null>(null)
  const [teamToast, setTeamToast] = useState<string | null>(null)

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
      // Keep current facility selected; only fall back to first if somehow unset
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

  const handleRemoveUser = async (userId: string) => {
    setRemovingUserId(userId)
    try {
      const res = await fetch(`/api/facility/users/${userId}`, { method: 'DELETE' })
      const j = await res.json()
      if (!res.ok) {
        setTeamToast(j.error ?? 'Failed to remove user')
      } else {
        setLocalUsers((prev) => prev.filter((u) => u.userId !== userId))
        setTeamToast('Access removed')
      }
    } finally {
      setRemovingUserId(null)
      setConfirmRemoveId(null)
      setTimeout(() => setTeamToast(null), 3000)
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
      if (j.refreshed) {
        setInvitesList((prev) => prev.map((i) => (i.id === j.data.id ? j.data : i)))
        setInviteSuccess('Invite refreshed and resent')
      } else {
        setInvitesList((prev) => [j.data, ...prev])
        setInviteSuccess('Invite sent!')
      }
      setTimeout(() => setInviteSuccess(''), 3000)
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
                ? 'border-[#8B2E4A] text-[#8B2E4A]'
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
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A] disabled:opacity-50 disabled:bg-stone-50"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!isAdmin}
              placeholder="123 Main St, City, State"
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A] disabled:opacity-50 disabled:bg-stone-50"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Phone</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!isAdmin}
              placeholder="(555) 000-0000"
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A] disabled:opacity-50 disabled:bg-stone-50"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              disabled={!isAdmin}
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A] disabled:opacity-50 disabled:bg-stone-50"
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
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A] disabled:opacity-50 disabled:bg-stone-50"
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
                        ? 'bg-[#8B2E4A] text-white'
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
                    className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A] disabled:opacity-50 disabled:bg-stone-50"
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
                    className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A] disabled:opacity-50 disabled:bg-stone-50"
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
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A] disabled:opacity-50 disabled:bg-stone-50"
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
              style={{ backgroundColor: '#8B2E4A' }}
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
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A] disabled:opacity-50 disabled:bg-stone-50 font-mono"
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
              style={{ backgroundColor: '#8B2E4A' }}
            >
              {savingCal ? 'Saving…' : savedCal ? 'Saved!' : 'Save'}
            </button>
          )}

          {/* ── QuickBooks Online ── */}
          <div className="rounded-2xl border border-stone-200 p-5 bg-white">
            {qbToast && (
              <div
                className={cn(
                  'mb-4 px-3 py-2 rounded-xl text-sm font-medium',
                  qbToast.kind === 'ok'
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border border-red-200 text-red-700',
                )}
              >
                {qbToast.text}
              </div>
            )}
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-semibold text-stone-800">QuickBooks Online</h3>
              {hasQuickBooks && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  ✓ Connected
                </span>
              )}
            </div>
            <p className="text-xs text-stone-500 mb-4">
              Sync payroll bills and vendor records directly to your QuickBooks Online account.
            </p>

            {!hasQuickBooks && isAdmin && (
              <a
                href="/api/quickbooks/connect"
                className="inline-block px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all"
                style={{ backgroundColor: '#8B2E4A' }}
              >
                Connect QuickBooks
              </a>
            )}

            {hasQuickBooks && (
              <div className="space-y-4">
                {qbRealmId && (
                  <div className="text-xs text-stone-500">
                    <span className="font-semibold text-stone-600">Realm ID:</span>{' '}
                    <span className="font-mono">{qbRealmId}</span>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1.5">
                    Expense Account <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={qbExpenseAccountId}
                      onChange={(e) => setQbExpenseAccountId(e.target.value)}
                      disabled={!isAdmin || !qbAccountsLoaded}
                      className="flex-1 px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A] disabled:opacity-50"
                    >
                      <option value="">{qbAccountsLoaded ? 'Select an expense account…' : 'Loading…'}</option>
                      {qbAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                          {a.accountSubType ? ` (${a.accountSubType})` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleSaveExpenseAccount}
                      disabled={qbSavingAccount || qbExpenseAccountId === qbExpenseAccountIdInit}
                      className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
                      style={{ backgroundColor: '#8B2E4A' }}
                    >
                      {qbSavingAccount ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  <p className="text-xs text-stone-400 mt-1.5">
                    Payroll Bills will book to this account. Required before pushing pay periods.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleSyncVendors}
                    disabled={qbSyncing}
                    className="px-4 py-2 rounded-xl text-sm font-semibold border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 transition-all disabled:opacity-50"
                  >
                    {qbSyncing ? 'Syncing…' : 'Sync Vendors'}
                  </button>
                  {!qbConfirmDisconnect ? (
                    <button
                      onClick={() => setQbConfirmDisconnect(true)}
                      className="px-4 py-2 rounded-xl text-sm font-semibold border border-red-200 text-red-700 hover:bg-red-50 transition-all"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <div
                      className="flex items-center gap-2"
                      onMouseLeave={() => setQbConfirmDisconnect(false)}
                    >
                      <span className="text-sm text-stone-600">Disconnect?</span>
                      <button
                        onClick={handleDisconnectQb}
                        disabled={qbDisconnecting}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-all disabled:opacity-50"
                      >
                        {qbDisconnecting ? 'Disconnecting…' : 'Yes'}
                      </button>
                      <button
                        onClick={() => setQbConfirmDisconnect(false)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-stone-200 text-stone-600 hover:bg-stone-50 transition-all"
                      >
                        No
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Team ── */}
      {activeTab === 'team' && (
        <div className="space-y-4">
          <p className="text-xs text-stone-400">
            Users with access to <span className="font-semibold text-stone-600">{facility.name}</span>
          </p>
          {teamToast && (
            <div className="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-medium text-emerald-800">
              {teamToast}
            </div>
          )}
          <div className="rounded-2xl border border-stone-100 overflow-hidden">
            {localUsers.map((cu, i) => {
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
                  onMouseLeave={() => {
                    if (confirmRemoveId === cu.userId) setConfirmRemoveId(null)
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ backgroundColor: '#fdf2f4', color: '#8B2E4A' }}
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
                        ? 'bg-[#fdf2f4] text-[#8B2E4A]'
                        : 'bg-stone-100 text-stone-500'
                    )}
                  >
                    {cu.role}
                  </span>
                  {cu.stylistName && (
                    <span className="text-xs text-stone-400 truncate hidden sm:inline">
                      ↔ {cu.stylistName}
                    </span>
                  )}
                  {(() => {
                    const status = !cu.lastSignIn
                      ? 'invited'
                      : (Date.now() - new Date(cu.lastSignIn).getTime()) / 86400000 > 90
                        ? 'inactive'
                        : 'active'
                    return (
                      <span
                        className={cn(
                          'text-xs font-medium px-2 py-0.5 rounded-full shrink-0',
                          status === 'active' && 'bg-emerald-50 text-emerald-700',
                          status === 'invited' && 'bg-amber-50 text-amber-700',
                          status === 'inactive' && 'bg-stone-100 text-stone-500'
                        )}
                      >
                        {status === 'active' ? 'Active' : status === 'invited' ? 'Invited' : 'Inactive'}
                      </span>
                    )
                  })()}
                  {isAdmin && !isYou && (
                    confirmRemoveId === cu.userId ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-xs text-stone-500">Remove?</span>
                        <button
                          onClick={() => handleRemoveUser(cu.userId)}
                          disabled={removingUserId === cu.userId}
                          className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          {removingUserId === cu.userId ? '…' : 'Yes'}
                        </button>
                        <button
                          onClick={() => setConfirmRemoveId(null)}
                          className="text-xs text-stone-400 hover:text-stone-600"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRemoveId(cu.userId)}
                        className="text-xs text-stone-400 hover:text-red-500 transition-colors shrink-0 min-h-[32px] px-2"
                      >
                        Remove
                      </button>
                    )
                  )}
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
                className="w-48 px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A]"
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
              className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A]"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-32 px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A]"
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
              style={{ backgroundColor: '#8B2E4A' }}
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
                              ? 'bg-[#fdf2f4] text-[#8B2E4A]'
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
                    {!isExpired ? (
                      <button
                        onClick={() => handleResendInvite(invite.id)}
                        disabled={resendingId === invite.id}
                        className="text-xs text-[#8B2E4A] hover:text-[#72253C] font-medium px-2 py-1 rounded-lg hover:bg-rose-50 transition-colors disabled:opacity-40"
                      >
                        {resendingId === invite.id ? 'Sending…' : resendSuccess === invite.id ? 'Sent!' : 'Resend'}
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setInviteEmail(invite.email)
                          setInviteRole(invite.inviteRole || 'stylist')
                        }}
                        className="text-xs text-[#8B2E4A] hover:text-[#72253C] font-medium px-2 py-1 rounded-lg hover:bg-rose-50 transition-colors"
                      >
                        Re-invite
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
                              ? 'bg-[#fdf2f4] text-[#8B2E4A]'
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
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A] font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Secret Key</label>
            <input
              type="password"
              value={stripeSecretKey}
              onChange={(e) => setStripeSecretKey(e.target.value)}
              placeholder={hasStripeSecret ? 'Stored securely — enter a new key to replace' : 'sk_live_…'}
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A] font-mono"
            />
            {hasStripeSecret && !stripeSecretKey && (
              <p className="mt-1.5 text-[11px] text-emerald-700 flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                Secret key configured
              </p>
            )}
          </div>
          {stripeError && <p className="text-red-600 text-xs">{stripeError}</p>}
          <button
            onClick={handleSaveStripe}
            disabled={savingStripe}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ backgroundColor: '#8B2E4A' }}
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
              <div className="w-5 h-5 border-2 border-stone-200 border-t-[#8B2E4A] rounded-full animate-spin" />
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
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Address</label>
            <input
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="123 Main St, City, State"
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Phone</label>
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="(555) 000-0000"
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Timezone</label>
            <select
              value={newTimezone}
              onChange={(e) => setNewTimezone(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/30 focus:border-[#8B2E4A]"
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
            style={{ backgroundColor: '#8B2E4A' }}
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
