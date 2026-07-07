'use client'

// Phase 15 F5 — facility-code entry for family members. On the native app a
// successful lookup also flips "family mode" (device-local), so future app
// launches go straight to this facility's portal.

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { isNativeApp } from '@/lib/detect-device'
import { setFamilyMode } from '@/lib/family-mode'

export function FamilyEntryClient() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return
    setChecking(true)
    setError(null)
    try {
      const res = await fetch('/api/portal/resolve-facility-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof j.error === 'string' ? j.error : 'No facility found for that code')
        return
      }
      const facilityCode: string = j.data.facilityCode
      if (isNativeApp()) setFamilyMode(facilityCode)
      router.push(`/family/${encodeURIComponent(facilityCode)}/login`)
    } catch {
      setError('Network error — please try again')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="px-6 py-8 text-center" style={{ backgroundColor: '#8B2E4A' }}>
        <Image
          src="/seniorstylistlogo.jpg"
          alt="Senior Stylist"
          width={180}
          height={72}
          className="mx-auto"
          style={{ filter: 'brightness(0) invert(1)', objectFit: 'contain', height: 48, width: 'auto' }}
        />
        <p className="text-white/80 text-sm mt-3">Family Portal</p>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 pt-10">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-md)] p-6">
          <h1 className="text-xl text-stone-900 mb-1" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
            Find your community
          </h1>
          <p className="text-sm text-stone-500 mb-5">
            Enter the facility code from your invitation or statement (for example, <span className="font-mono">F123</span>).
          </p>
          <form onSubmit={submit} className="space-y-3">
            {error && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">{error}</div>
            )}
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Facility code"
              autoCapitalize="characters"
              autoComplete="off"
              className="w-full text-center font-mono text-lg tracking-widest uppercase bg-stone-50 border border-stone-200 rounded-xl px-3 py-3 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
            />
            <button
              type="submit"
              disabled={checking || !code.trim()}
              className="w-full rounded-xl bg-[#8B2E4A] text-white font-semibold py-3 text-sm disabled:opacity-50 transition-opacity"
            >
              {checking ? 'Looking up…' : 'Continue'}
            </button>
          </form>
          <p className="text-xs text-stone-400 mt-5 text-center">
            Don&apos;t know your code? Ask the front desk at your loved one&apos;s community.
          </p>
        </div>
      </main>
    </div>
  )
}
