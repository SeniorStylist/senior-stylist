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
  role: string
}

export function GeneralSection({ facility, role }: Props) {
  const router = useRouter()
  const isAdmin = role === 'admin'
  const readOnly = !isAdmin

  const wh = (facility as { workingHours?: { days: string[]; startTime: string; endTime: string } }).workingHours
  const initialEmail = (facility as { contactEmail?: string | null }).contactEmail ?? ''

  const [name, setName] = useState(facility.name)
  const [address, setAddress] = useState(facility.address ?? '')
  const [phone, setPhone] = useState(facility.phone ?? '')
  const [timezone, setTimezone] = useState(facility.timezone)
  const [paymentType, setPaymentType] = useState(facility.paymentType ?? 'facility')
  const [workingDays, setWorkingDays] = useState<string[]>(wh?.days ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  const [workingStart, setWorkingStart] = useState(wh?.startTime ?? '08:00')
  const [workingEnd, setWorkingEnd] = useState(wh?.endTime ?? '18:00')
  const [contactEmail, setContactEmail] = useState(initialEmail)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const isDirty =
    name !== facility.name ||
    address !== (facility.address ?? '') ||
    phone !== (facility.phone ?? '') ||
    timezone !== facility.timezone ||
    paymentType !== (facility.paymentType ?? 'facility') ||
    contactEmail !== initialEmail ||
    JSON.stringify({ d: workingDays, s: workingStart, e: workingEnd }) !==
      JSON.stringify({ d: wh?.days ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], s: wh?.startTime ?? '08:00', e: wh?.endTime ?? '18:00' })

  async function handleSave() {
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

  if (readOnly) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Contact your facility admin to change these settings.
        </div>

        <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)] space-y-4">
          <ReadOnlyRow label="Facility Name" value={facility.name} />
          {facility.facilityCode && (
            <ReadOnlyRow
              label="Facility Code"
              value={
                <span className="inline-flex items-center rounded-md bg-stone-100 text-stone-700 text-xs font-mono px-1.5 py-0.5">
                  {facility.facilityCode}
                </span>
              }
            />
          )}
          <ReadOnlyRow label="Address" value={facility.address || '—'} />
          <ReadOnlyRow label="Phone" value={facility.phone || '—'} />
          <ReadOnlyRow label="Timezone" value={facility.timezone} />
          <ReadOnlyRow
            label="Working Hours"
            value={`${(wh?.days ?? []).join(', ') || '—'} · ${wh?.startTime ?? '08:00'}–${wh?.endTime ?? '18:00'}`}
          />
          <ReadOnlyRow label="Contact Email" value={initialEmail || '—'} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)] space-y-5">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Facility</p>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Facility Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
          />
        </div>

        {facility.facilityCode && (
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">Facility Code</label>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center rounded-xl bg-stone-100 text-stone-700 text-sm font-mono px-3 py-2 border border-stone-200">
                {facility.facilityCode}
              </span>
              <span className="text-xs text-stone-400">Assigned on QB import — cross-system identifier</span>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Address</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St, City, State"
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Phone</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 000-0000"
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Timezone</label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
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
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
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
                  onClick={() =>
                    setWorkingDays((prev) =>
                      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
                    )
                  }
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-75 active:scale-95 ${
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
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                >
                  {timeOptions()}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs text-stone-500 mb-1">End</label>
                <select
                  value={workingEnd}
                  onChange={(e) => setWorkingEnd(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                >
                  {timeOptions()}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Contact Email</label>
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="admin@yourfacility.com"
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
          />
          <p className="text-[11px] text-stone-400 mt-1">
            Shown on the &ldquo;Request access&rdquo; button for users waiting for an invite.
          </p>
        </div>

        {error && <p className="text-red-600 text-xs">{error}</p>}

        <div className="pt-2">
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ backgroundColor: '#8B2E4A' }}
          >
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ReadOnlyRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-stone-500 mb-0.5">{label}</p>
      <p className="text-sm text-stone-800">{value}</p>
    </div>
  )
}

function timeOptions() {
  return Array.from({ length: 32 }, (_, i) => {
    const totalMins = 360 + i * 30
    const h = Math.floor(totalMins / 60)
    const m = totalMins % 60
    const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    const label = new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return <option key={val} value={val}>{label}</option>
  })
}
