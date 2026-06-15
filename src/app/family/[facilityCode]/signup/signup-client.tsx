'use client'

import { useState } from 'react'
import Link from 'next/link'

interface Props {
  facilityCode: string
  facilityName: string
}

type Step = 'form' | 'auto_approved' | 'pending'

export function SignupClient({ facilityCode, facilityName }: Props) {
  const [step, setStep] = useState<Step>('form')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')

  const loginUrl = `/family/${encodeURIComponent(facilityCode)}/login`

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/portal/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          fullName: fullName.trim(),
          facilityCode,
          phone: phone.trim() || null,
          dateOfBirth: dateOfBirth || null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 409) {
          setError('You already have portal access. Sign in instead.')
          return
        }
        setError(j.error ?? 'Something went wrong. Please try again.')
        return
      }
      setStep(j.status === 'auto_approved' ? 'auto_approved' : 'pending')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 'auto_approved') {
    return (
      <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="text-base font-semibold text-stone-800">Welcome to {facilityName}!</p>
        <p className="text-sm text-stone-500 mt-2">
          We found your account. A sign-in link is on its way to <span className="font-medium text-stone-700">{email}</span>.
        </p>
        <p className="text-xs text-stone-400 mt-2">Link expires in 72 hours. Check your spam folder if you don&apos;t see it.</p>
        <Link
          href={loginUrl}
          className="mt-5 inline-block text-sm font-semibold text-[#8B2E4A] hover:underline"
        >
          Go to sign-in page
        </Link>
      </div>
    )
  }

  if (step === 'pending') {
    return (
      <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className="text-base font-semibold text-stone-800">Request received</p>
        <p className="text-sm text-stone-500 mt-2">
          We couldn&apos;t automatically match your name to a resident. The facility team will review your request and send you an email when access is granted.
        </p>
        <p className="text-xs text-stone-400 mt-3">This usually takes 1–2 business days.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] overflow-hidden">
      <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-stone-600" htmlFor="fullName">
            Your full name <span className="text-red-500">*</span>
          </label>
          <input
            id="fullName"
            type="text"
            required
            autoFocus
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Jane Smith"
            maxLength={200}
            className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
          />
          <p className="text-xs text-stone-400">Enter the name the facility has on file for you (POA/guardian).</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-stone-600" htmlFor="email">
            Email address <span className="text-red-500">*</span>
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            maxLength={320}
            className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-stone-600" htmlFor="phone">
            Phone number <span className="text-stone-400 font-normal">(optional)</span>
          </label>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
            maxLength={30}
            className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-stone-600" htmlFor="dateOfBirth">
            Date of birth <span className="text-stone-400 font-normal">(optional)</span>
          </label>
          <input
            id="dateOfBirth"
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
            {error.includes('already have portal access') && (
              <span> <Link href={loginUrl} className="font-semibold underline">Sign in →</Link></span>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !email.trim() || !fullName.trim()}
          className="bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-3 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] disabled:opacity-60 disabled:cursor-not-allowed mt-1"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>

        <p className="text-center text-xs text-stone-400">
          Already have an account?{' '}
          <Link href={loginUrl} className="font-semibold text-[#8B2E4A] hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  )
}
