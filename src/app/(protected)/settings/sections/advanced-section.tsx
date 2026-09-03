'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PublicFacility } from '@/lib/sanitize'
import { useToast } from '@/components/ui/toast'

interface Props {
  facility: PublicFacility
  isMaster?: boolean
}

export function AdvancedSection({ facility, isMaster = false }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const order = (facility as { serviceCategoryOrder?: string[] | null }).serviceCategoryOrder ?? []

  // ─── Demo Data Reset ──────────────────────────────────────────────────
  const [demoResetConfirm, setDemoResetConfirm] = useState(false)
  const [demoResetting, setDemoResetting] = useState(false)

  async function handleDemoReset() {
    setDemoResetting(true)
    try {
      const res = await fetch('/api/help/demo-data', { method: 'DELETE' })
      if (!res.ok) {
        toast.error('Failed to reset tutorial data')
        return
      }
      toast.success('Tutorial data reset — it will be re-seeded on your next tutorial launch')
      setDemoResetConfirm(false)
    } catch {
      toast.error('Failed to reset tutorial data')
    } finally {
      setDemoResetting(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Tutorial Data Reset */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Tutorial Data</p>
        <p className="text-xs text-stone-500 mb-4">
          Tutorials use demo residents like Mrs. Smith and Mr. Johnson. Reset this data if it looks stale — it will be re-seeded automatically the next time you start a tutorial.
        </p>
        {!demoResetConfirm ? (
          <button
            type="button"
            onClick={() => setDemoResetConfirm(true)}
            className="px-4 py-2 rounded-xl text-sm font-medium text-stone-700 border border-stone-200 hover:bg-stone-50 transition-colors"
          >
            Reset tutorial data
          </button>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <p className="text-sm text-amber-800 font-medium">
              This will delete Mrs. Smith, Mr. Johnson, and other tutorial residents. Continue?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDemoReset}
                disabled={demoResetting}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                style={{ backgroundColor: '#8B2E4A' }}
              >
                {demoResetting ? 'Resetting…' : 'Yes, reset'}
              </button>
              <button
                type="button"
                onClick={() => setDemoResetConfirm(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-stone-700 border border-stone-200 hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

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

      {/* Add Facility — P57: ONE flow, the /facilities/new wizard */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
          {isMaster ? 'Facility Management' : 'Add Facility'}
        </p>
        <p className="text-xs text-stone-500 mb-4">
          {isMaster
            ? 'Create a new community with the guided setup, or manage every facility from Master Admin.'
            : 'Set up another community you manage — name, hours, and billing in a few guided steps. You\u2019ll be its admin and switched to it when you finish.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => router.push('/facilities/new?returnTo=/settings?section=advanced')}
            data-tour="settings-add-facility"
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ backgroundColor: '#8B2E4A' }}
          >
            + New facility
          </button>
          {isMaster && (
            <button
              type="button"
              onClick={() => router.push('/master-admin')}
              className="px-4 py-2 rounded-xl text-sm font-medium text-stone-700 border border-stone-200 hover:bg-stone-50 transition-colors"
            >
              Go to Master Admin →
            </button>
          )}
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
