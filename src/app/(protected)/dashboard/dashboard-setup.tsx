'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function DashboardSetup() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const router = useRouter()

  const handleSetup = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/setup', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Setup failed')
      } else {
        setDone(true)
        router.refresh()
      }
    } catch (e) {
      setError('Network error — is the database configured?')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="bg-teal-50 border border-teal-200 rounded-2xl p-6 max-w-lg">
        <h2 className="font-semibold text-teal-900 mb-2">✓ Setup complete!</h2>
        <p className="text-sm text-teal-700">Facility, residents, services, and stylist created.</p>
      </div>
    )
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-lg">
      <h2 className="font-semibold text-amber-900 mb-2">First-time Setup Required</h2>
      <p className="text-sm text-amber-700 mb-4">
        Click the button below to create your facility and seed demo data (residents, services, stylist).
      </p>
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          {error}
        </p>
      )}
      <button
        onClick={handleSetup}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0D7377] text-white rounded-xl text-sm font-semibold hover:bg-[#0a5f63] active:scale-95 transition-all duration-150 disabled:opacity-60"
      >
        {loading && (
          <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {loading ? 'Setting up...' : 'Run Setup'}
      </button>
    </div>
  )
}
