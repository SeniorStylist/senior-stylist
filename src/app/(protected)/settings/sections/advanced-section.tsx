'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PublicFacility } from '@/lib/sanitize'

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
]

interface Props {
  facility: PublicFacility
}

export function AdvancedSection({ facility }: Props) {
  const router = useRouter()
  const order = (facility as { serviceCategoryOrder?: string[] | null }).serviceCategoryOrder ?? []

  // ─── Add Facility ────────────────────────────────────────────────────
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newTimezone, setNewTimezone] = useState('America/New_York')
  const [creatingFacility, setCreatingFacility] = useState(false)
  const [createError, setCreateError] = useState('')

  async function handleCreateFacility() {
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

  return (
    <div className="space-y-5">
      {/* Service Category Order */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Service Category Order</p>
        <p className="text-xs text-stone-500 mb-3">
          The order shown in the booking modal and across the app. Edit via the Services page.
        </p>
        {order.length === 0 ? (
          <p className="text-sm text-stone-400">No custom order set — categories appear alphabetically.</p>
        ) : (
          <ol className="space-y-1">
            {order.map((cat, i) => (
              <li
                key={cat}
                className="flex items-center gap-3 px-3 py-2 rounded-xl bg-stone-50 border border-stone-100"
              >
                <span className="text-xs font-mono text-stone-400 w-5">{i + 1}.</span>
                <span className="text-sm text-stone-700">{cat}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Add Facility */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)] space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-stone-800 mb-1">Add Facility</h3>
          <p className="text-xs text-stone-500">
            Create a new facility. You&rsquo;ll be added as admin and switched to it automatically.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Facility Name *</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Sunrise Senior Living"
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Address</label>
          <input
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="123 Main St, City, State"
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Phone</label>
          <input
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="(555) 000-0000"
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Timezone</label>
          <select
            value={newTimezone}
            onChange={(e) => setNewTimezone(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>

        {createError && <p className="text-red-600 text-xs">{createError}</p>}

        <div>
          <button
            onClick={handleCreateFacility}
            disabled={!newName.trim() || creatingFacility}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ backgroundColor: '#8B2E4A' }}
          >
            {creatingFacility ? 'Creating…' : 'Create Facility'}
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="rounded-2xl border border-red-100 bg-red-50/40 p-5 shadow-[var(--shadow-sm)]">
        <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">Danger Zone</p>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-stone-800 mb-1">Deactivate this facility</p>
            <p className="text-xs text-stone-500">
              Removes the facility from all views. Bookings and resident data are preserved. Requires support assistance — contact{' '}
              <span className="font-mono">support@seniorstylist.com</span> to deactivate.
            </p>
          </div>
          <span className="shrink-0 inline-flex items-center text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200">
            Coming soon
          </span>
        </div>
      </div>
    </div>
  )
}
