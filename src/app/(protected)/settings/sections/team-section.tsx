'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export interface ConnectedUser {
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

interface InviteData {
  id: string
  email: string
  inviteRole: string
  used: boolean
  createdAt: string | null
  expiresAt: string
  token: string
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

interface Props {
  connectedUsers: ConnectedUser[]
  currentUserId: string
  isSuperAdmin: boolean
  facilityId: string
  facilityName: string
}

function roleBadgeClass(role: string | null | undefined): string {
  switch (role) {
    case 'admin': return 'bg-[#fdf2f4] text-[#8B2E4A]'
    case 'super_admin': return 'bg-[#fdf2f4] text-[#8B2E4A]'
    case 'facility_staff': return 'bg-blue-50 text-blue-700'
    case 'bookkeeper': return 'bg-emerald-50 text-emerald-700'
    case 'viewer': return 'bg-amber-50 text-amber-700'
    default: return 'bg-stone-100 text-stone-500'
  }
}

function roleBadgeLabel(role: string | null | undefined): string {
  switch (role) {
    case 'admin': return 'admin'
    case 'super_admin': return 'super admin'
    case 'facility_staff': return 'facility staff'
    case 'bookkeeper': return 'bookkeeper'
    case 'stylist': return 'stylist'
    case 'viewer': return 'viewer'
    default: return role || 'stylist'
  }
}

export function TeamSection({
  connectedUsers,
  currentUserId,
  isSuperAdmin,
  facilityId,
  facilityName,
}: Props) {
  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://senior-stylist.vercel.app'

  // Members
  const [localUsers, setLocalUsers] = useState<ConnectedUser[]>(connectedUsers)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [removingUserId, setRemovingUserId] = useState<string | null>(null)
  const [teamToast, setTeamToast] = useState<string | null>(null)

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('stylist')
  const [inviteFacilityId, setInviteFacilityId] = useState<string>(facilityId)
  const [facilitiesList, setFacilitiesList] = useState<{ id: string; name: string }[]>([])
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')

  // Pending invites
  const [invitesList, setInvitesList] = useState<InviteData[]>([])
  const [invitesLoaded, setInvitesLoaded] = useState(false)
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

  useEffect(() => {
    void loadInvites()
    void loadRequests()
    if (isSuperAdmin) void loadFacilitiesForInvite()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadInvites() {
    if (isSuperAdmin) {
      setInvitesLoaded(true)
      return
    }
    const res = await fetch('/api/invites')
    if (res.ok) {
      const j = await res.json()
      setInvitesList(j.data ?? [])
    }
    setInvitesLoaded(true)
  }

  async function loadFacilitiesForInvite() {
    const res = await fetch('/api/facilities')
    if (res.ok) {
      const j = await res.json()
      const list: { id: string; name: string }[] = j.data ?? []
      setFacilitiesList(list)
      if (list.length > 0 && !inviteFacilityId) setInviteFacilityId(list[0].id)
    }
  }

  async function loadRequests() {
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

  async function handleRequestAction(id: string, action: 'approve' | 'deny') {
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

  async function handleRemoveUser(userId: string) {
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

  async function handleSendInvite() {
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

  async function handleRevokeInvite(id: string) {
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

  async function handleResendInvite(id: string) {
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

  function copyInviteLink(token: string) {
    const link = `${appUrl}/invite/accept?token=${token}`
    navigator.clipboard.writeText(link)
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  const pendingInvites = invitesList.filter((i) => !i.used)
  const acceptedInvites = invitesList.filter((i) => i.used)

  return (
    <div className="space-y-5">
      {/* Invite form */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Invite a teammate</p>
        <p className="text-xs text-stone-500 mb-3">
          {isSuperAdmin
            ? 'Invite users to any facility. Links expire after 7 days.'
            : <>Invite users to join <span className="font-semibold text-stone-700">{facilityName}</span>. Links expire after 7 days.</>
          }
        </p>
        <div className="flex flex-wrap gap-2">
          {isSuperAdmin && (
            <select
              value={inviteFacilityId}
              onChange={(e) => setInviteFacilityId(e.target.value)}
              className="w-48 px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
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
            className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="w-40 px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
          >
            <option value="admin">Admin</option>
            <option value="facility_staff">Facility Staff</option>
            <option value="bookkeeper">Bookkeeper</option>
            <option value="stylist">Stylist</option>
            {isSuperAdmin && <option value="super_admin">Super Admin (franchise)</option>}
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
        {inviteError && <p className="text-xs text-red-600 mt-2">{inviteError}</p>}
        {inviteSuccess && <p className="text-xs text-green-600 mt-2">{inviteSuccess}</p>}
      </div>

      {/* Active members */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Active Members</p>
        {teamToast && (
          <div className="mb-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-medium text-emerald-800">
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
                <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', roleBadgeClass(cu.role))}>
                  {roleBadgeLabel(cu.role)}
                </span>
                {cu.stylistName && (
                  <span className="text-xs text-stone-400 truncate hidden sm:inline">↔ {cu.stylistName}</span>
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
                {!isYou && (
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

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Pending Invites</p>
          <div className="rounded-2xl border border-stone-100 overflow-hidden">
            {pendingInvites.map((invite, idx) => {
              const isExpired = new Date(invite.expiresAt) < new Date()
              return (
                <div key={invite.id} className={cn('flex items-center gap-3 px-4 py-3', idx > 0 && 'border-t border-stone-100')}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-800 truncate">
                      {invite.email}
                      <span className={cn('ml-2 text-xs font-medium px-2 py-0.5 rounded-full', roleBadgeClass(invite.inviteRole))}>
                        {roleBadgeLabel(invite.inviteRole)}
                      </span>
                      {isExpired && (
                        <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600">Expired</span>
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
      {acceptedInvites.length > 0 && (
        <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Accepted Invites</p>
          <div className="rounded-2xl border border-stone-100 overflow-hidden">
            {acceptedInvites.map((invite, idx) => (
              <div key={invite.id} className={cn('flex items-center gap-3 px-4 py-3', idx > 0 && 'border-t border-stone-100')}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800 truncate">
                    {invite.email}
                    <span className={cn('ml-2 text-xs font-medium px-2 py-0.5 rounded-full', roleBadgeClass(invite.inviteRole))}>
                      {roleBadgeLabel(invite.inviteRole)}
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

      {invitesLoaded && pendingInvites.length === 0 && acceptedInvites.length === 0 && !isSuperAdmin && (
        <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
          <p className="text-sm text-stone-400 text-center py-4">No invites sent yet.</p>
        </div>
      )}

      {/* Access requests */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Access Requests</p>
        {requestToast && (
          <div className="mb-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-medium text-emerald-800">
            {requestToast}
          </div>
        )}
        {!requestsLoaded ? (
          <div className="py-6 flex justify-center">
            <div className="w-5 h-5 border-2 border-stone-200 border-t-[#8B2E4A] rounded-full animate-spin" />
          </div>
        ) : requestsList.length === 0 ? (
          <p className="text-sm text-stone-400 text-center py-4">No pending access requests</p>
        ) : (
          <div className="space-y-3">
            {requestsList.map((req) => (
              <div key={req.id} className="bg-white rounded-2xl border border-stone-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-stone-900 truncate">{req.fullName || req.email}</p>
                    {req.fullName && <p className="text-xs text-stone-400 truncate">{req.email}</p>}
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
    </div>
  )
}
