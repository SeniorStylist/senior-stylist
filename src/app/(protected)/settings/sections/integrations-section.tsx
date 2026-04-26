'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PublicFacility } from '@/lib/sanitize'

interface Props {
  facility: PublicFacility
}

export function IntegrationsSection({ facility }: Props) {
  const router = useRouter()
  const [calendarId, setCalendarId] = useState(facility.calendarId ?? '')
  const [savingCal, setSavingCal] = useState(false)
  const [savedCal, setSavedCal] = useState(false)
  const calDirty = calendarId !== (facility.calendarId ?? '')

  async function handleSaveCalendar() {
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

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)] space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-stone-800 mb-1">Google Calendar</h3>
          <p className="text-xs text-stone-500">
            Connect a shared Google Calendar so new bookings are mirrored to your team&rsquo;s calendar automatically.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Google Calendar ID</label>
          <input
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
            placeholder="your-calendar@group.calendar.google.com"
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A] font-mono"
          />
          <p className="text-xs text-stone-400 mt-1.5">
            Find this in Google Calendar → Settings → your calendar → Calendar ID.
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

        <div>
          <button
            onClick={handleSaveCalendar}
            disabled={!calDirty || savingCal}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ backgroundColor: '#8B2E4A' }}
          >
            {savingCal ? 'Saving…' : savedCal ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
