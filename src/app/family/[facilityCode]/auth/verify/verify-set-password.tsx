'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface Props {
  facilityCode: string
}

export function VerifySetPassword({ facilityCode }: Props) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const goHome = () => {
    router.push(`/family/${encodeURIComponent(facilityCode)}`)
    router.refresh()
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/portal/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error ?? 'Could not save password.')
        return
      }
      setDone(true)
      setTimeout(goHome, 800)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 text-center">
        Password saved — redirecting…
      </div>
    )
  }

  if (!showForm) {
    return (
      <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5 mt-4">
        <p className="text-sm font-semibold text-stone-800">Set a password for faster sign-in?</p>
        <p className="text-xs text-stone-500 mt-1">Optional — you can always use email links instead.</p>
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={goHome}
            className="flex-1 text-sm font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl px-4 py-2.5 transition-colors"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex-1 text-sm font-semibold bg-[#8B2E4A] text-white rounded-xl px-4 py-2.5 hover:bg-[#72253C] shadow-[0_2px_6px_rgba(139,46,74,0.22)]"
          >
            Set password
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5 mt-4 flex flex-col gap-3">
      <p className="text-sm font-semibold text-stone-800">Choose a password</p>
      <input
        type="password"
        autoFocus
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="At least 8 characters"
        className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
      />
      <input
        type="password"
        required
        minLength={8}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm password"
        className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
      />
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex gap-2 mt-1">
        <button
          type="button"
          onClick={goHome}
          className="flex-1 text-sm font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl px-4 py-2.5 transition-colors"
        >
          Skip
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 text-sm font-semibold bg-[#8B2E4A] text-white rounded-xl px-4 py-2.5 hover:bg-[#72253C] shadow-[0_2px_6px_rgba(139,46,74,0.22)] disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
