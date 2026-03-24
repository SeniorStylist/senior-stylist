'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

interface FacilityInfo {
  id: string
  name: string
  address: string | null
  phone: string | null
  paymentType: string
  active: boolean
  createdAt: string | null
  residentCount: number
  stylistCount: number
  bookingsThisMonth: number
  adminEmail: string | null
}

interface SuperAdminClientProps {
  facilities: FacilityInfo[]
}

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Arizona' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
]

export function SuperAdminClient({ facilities }: SuperAdminClientProps) {
  const router = useRouter()
  const [enteringId, setEnteringId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    timezone: 'America/New_York',
  })

  const handleEnterFacility = async (facilityId: string) => {
    setEnteringId(facilityId)
    await fetch('/api/facilities/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facilityId }),
    })
    router.push('/dashboard')
  }

  const handleCreateFacility = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) return
    setCreating(true)
    try {
      await fetch('/api/facilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      setFormData({ name: '', address: '', phone: '', timezone: 'America/New_York' })
      setShowCreateForm(false)
      router.refresh()
    } catch {
      // silently fail
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1
              className="text-2xl font-bold text-stone-900"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              Super Admin
            </h1>
            <p className="text-sm text-stone-500 mt-1">
              {facilities.length} {facilities.length === 1 ? 'facility' : 'facilities'} total
            </p>
          </div>
          <button
            onClick={() => setShowCreateForm((v) => !v)}
            className="px-4 py-2.5 rounded-2xl text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: '#0D7377' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0B6163')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#0D7377')}
          >
            {showCreateForm ? 'Cancel' : '+ Create Facility'}
          </button>
        </div>

        {/* Create Facility Form */}
        {showCreateForm && (
          <form
            onSubmit={handleCreateFacility}
            className="bg-white rounded-2xl border border-stone-200 p-6 mb-8 shadow-sm"
          >
            <h2
              className="text-lg font-bold text-stone-900 mb-4"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              New Facility
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData((d) => ({ ...d, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377]"
                  placeholder="Sunrise Senior Living"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Address</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData((d) => ({ ...d, address: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377]"
                  placeholder="123 Main St, City, ST"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Phone</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData((d) => ({ ...d, phone: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377]"
                  placeholder="(555) 123-4567"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">Timezone</label>
                <select
                  value={formData.timezone}
                  onChange={(e) => setFormData((d) => ({ ...d, timezone: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377] bg-white"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label} ({tz.value})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="submit"
                disabled={creating}
                className="px-5 py-2.5 rounded-2xl text-sm font-medium text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#0D7377' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0B6163')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#0D7377')}
              >
                {creating ? 'Creating...' : 'Create Facility'}
              </button>
            </div>
          </form>
        )}

        {/* Facility Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {facilities.map((f) => (
            <div
              key={f.id}
              className={cn(
                'bg-white rounded-2xl border border-stone-200 p-5 shadow-sm transition-shadow hover:shadow-md',
                !f.active && 'opacity-60'
              )}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold text-stone-900 truncate">{f.name}</h3>
                  {f.adminEmail && (
                    <p className="text-xs text-stone-400 mt-0.5 truncate">{f.adminEmail}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-600 uppercase tracking-wide">
                    {f.paymentType}
                  </span>
                  {!f.active && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-500 uppercase tracking-wide">
                      Inactive
                    </span>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 mb-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-lg font-bold text-stone-900">{f.residentCount}</span>
                  <span className="text-xs text-stone-500">residents</span>
                </div>
                <div className="w-px h-4 bg-stone-200" />
                <div className="flex items-center gap-1.5">
                  <span className="text-lg font-bold text-stone-900">{f.stylistCount}</span>
                  <span className="text-xs text-stone-500">stylists</span>
                </div>
                <div className="w-px h-4 bg-stone-200" />
                <div className="flex items-center gap-1.5">
                  <span className="text-lg font-bold text-stone-900">{f.bookingsThisMonth}</span>
                  <span className="text-xs text-stone-500">bookings</span>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-stone-400">
                  {f.createdAt
                    ? `Created ${new Date(f.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                    : ''}
                </span>
                <button
                  onClick={() => handleEnterFacility(f.id)}
                  disabled={enteringId === f.id}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#0D7377' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0B6163')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#0D7377')}
                >
                  {enteringId === f.id ? 'Entering...' : 'Enter as Admin'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {facilities.length === 0 && (
          <div className="text-center py-16">
            <p className="text-stone-400 text-sm">No facilities yet. Create one to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}
