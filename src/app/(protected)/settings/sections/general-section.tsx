'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PublicFacility } from '@/lib/sanitize'
import { HelpTip } from '@/components/ui/help-tip'
import { WorkingHoursEditor, workingHoursValid } from '@/components/facilities/working-hours-editor'
import { DEFAULT_WORKING_HOURS, TIMEZONES, type WorkingHours } from '@/lib/facility-options'

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
  // P57 — one shared editor with the New-Facility wizard
  const initialHours: WorkingHours = {
    days: wh?.days ?? DEFAULT_WORKING_HOURS.days,
    startTime: wh?.startTime ?? DEFAULT_WORKING_HOURS.startTime,
    endTime: wh?.endTime ?? DEFAULT_WORKING_HOURS.endTime,
  }
  const [workingHours, setWorkingHours] = useState<WorkingHours>(initialHours)
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
    JSON.stringify(workingHours) !== JSON.stringify(initialHours)

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
          workingHours,
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
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)] space-y-5" data-tour="settings-facility-form">
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
              <option key={tz.value} value={tz.value}>{tz.label} ({tz.value})</option>
            ))}
          </select>
        </div>

        <div data-tour="settings-payment-type">
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

        <div data-tour="settings-working-hours">
          <div className="flex items-center gap-1.5 mb-1.5">
            <label className="block text-xs font-semibold text-stone-600">Working Hours</label>
            <HelpTip
              tourId="admin-facility-setup"
              label="Working hours"
              description="Pick the days and hours your facility is open. Bookings can only be created within these times."
            />
          </div>
          <WorkingHoursEditor value={workingHours} onChange={setWorkingHours} />
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
            disabled={!isDirty || saving || !workingHoursValid(workingHours)}
            data-tour="settings-save-button"
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
