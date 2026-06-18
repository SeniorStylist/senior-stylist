'use client'

import { useState } from 'react'
import { useToast } from '@/components/ui/toast'
import type { PublicFacility } from '@/lib/sanitize'

interface Props {
  adminEmail: string | null
  role: string
  facility: PublicFacility
}

export function NotificationsSection({ adminEmail, role, facility }: Props) {
  const readOnly = role !== 'admin'
  const { toast } = useToast()
  const [digestEnabled, setDigestEnabled] = useState(facility.dailyDigestEnabled ?? false)
  const [savingDigest, setSavingDigest] = useState(false)

  const toggleDigest = async (enabled: boolean) => {
    if (readOnly || savingDigest) return
    setSavingDigest(true)
    const prev = digestEnabled
    setDigestEnabled(enabled)
    try {
      const res = await fetch('/api/facility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyDigestEnabled: enabled }),
      })
      if (!res.ok) throw new Error('Save failed')
      toast.success(enabled ? 'Daily digest enabled' : 'Daily digest disabled')
    } catch {
      setDigestEnabled(prev)
      toast.error('Could not save — please try again')
    } finally {
      setSavingDigest(false)
    }
  }

  return (
    <div className="space-y-5">
      {readOnly && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Contact your facility admin to change these settings.
        </div>
      )}

      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Alert Email</p>
        <div className="flex items-center gap-2 flex-wrap">
          {adminEmail ? (
            <span className="inline-flex items-center rounded-xl bg-stone-100 text-stone-700 text-sm font-mono px-3 py-2 border border-stone-200">
              {adminEmail}
            </span>
          ) : (
            <span className="text-sm text-stone-400">Not configured</span>
          )}
        </div>
        <p className="text-xs text-stone-500 mt-2">
          New service requests and compliance alerts are sent to this address. Set via the{' '}
          <span className="font-mono text-stone-600">NEXT_PUBLIC_ADMIN_EMAIL</span> environment variable.
        </p>
      </div>

      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-stone-800 mb-1">Daily Digest Email</p>
            <p className="text-xs text-stone-500">
              Receive a morning summary of yesterday&rsquo;s completed visits, revenue, and tips.
              Sent at 8:00 AM UTC to the facility contact email.
            </p>
          </div>
          {readOnly ? (
            <label className="inline-flex items-center cursor-not-allowed shrink-0">
              <span
                className="relative inline-block w-10 h-6 rounded-full bg-stone-200 opacity-60"
                aria-disabled="true"
              >
                <span className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm" />
              </span>
            </label>
          ) : (
            <button
              type="button"
              role="switch"
              aria-checked={digestEnabled}
              disabled={savingDigest}
              onClick={() => toggleDigest(!digestEnabled)}
              className={`relative inline-flex shrink-0 w-10 h-6 rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[#8B2E4A]/30 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                digestEnabled ? 'bg-[#8B2E4A]' : 'bg-stone-200'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  digestEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-semibold text-stone-800">Portal Service Requests</p>
              <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200">
                Coming soon
              </span>
            </div>
            <p className="text-xs text-stone-500">
              Email me when a family submits a service request via the portal.
            </p>
          </div>
          <label className="inline-flex items-center cursor-not-allowed shrink-0">
            <span
              className="relative inline-block w-10 h-6 rounded-full bg-stone-200 opacity-60"
              aria-disabled="true"
            >
              <span className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm" />
            </span>
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Compliance Alerts</p>
        <p className="text-sm text-stone-700">
          Compliance alerts are sent <span className="font-semibold">30 and 60 days</span> before document expiration.
        </p>
        <p className="text-xs text-stone-500 mt-2">
          Recipients are facility admins on this facility. To change recipients, update an admin&rsquo;s email in Team &amp; Roles.
        </p>
      </div>
    </div>
  )
}
