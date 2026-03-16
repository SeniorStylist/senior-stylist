'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Facility } from '@/types'

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

interface SettingsClientProps {
  facility: Facility
  connectedUsers: ConnectedUser[]
  currentUserId: string
  isAdmin: boolean
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

type Tab = 'general' | 'integrations' | 'team' | 'new-facility'

export function SettingsClient({
  facility,
  connectedUsers,
  currentUserId,
  isAdmin,
}: SettingsClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') as Tab | null
  const [activeTab, setActiveTab] = useState<Tab>(tabParam ?? 'general')

  useEffect(() => {
    if (tabParam && tabParam !== activeTab) setActiveTab(tabParam)
  }, [tabParam])

  // General form
  const [name, setName] = useState(facility.name)
  const [address, setAddress] = useState(facility.address ?? '')
  const [phone, setPhone] = useState(facility.phone ?? '')
  const [timezone, setTimezone] = useState(facility.timezone)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const generalDirty =
    name !== facility.name ||
    address !== (facility.address ?? '') ||
    phone !== (facility.phone ?? '') ||
    timezone !== facility.timezone

  const handleSaveGeneral = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/facility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, address: address || undefined, phone: phone || undefined, timezone }),
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

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'team', label: 'Team' },
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
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
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
    </div>
  )
}
