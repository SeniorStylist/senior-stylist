'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  facilityCode: string
}

export function LoginClient({ facilityCode }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<'link' | 'password'>('link')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [linkSent, setLinkSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onRequestLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/portal/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), facilityCode }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? 'Something went wrong. Please try again.')
        return
      }
      setLinkSent(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const onPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, facilityCode }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error ?? 'Invalid email or password')
        return
      }
      router.push(`/family/${encodeURIComponent(facilityCode)}`)
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (linkSent) {
    return (
      <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13" />
            <path d="M22 2L15 22 11 13 2 9 22 2z" />
          </svg>
        </div>
        <p className="text-base font-semibold text-stone-800">Check your email</p>
        <p className="text-sm text-stone-500 mt-1">
          If <span className="font-medium text-stone-700">{email}</span> is on file, we&apos;ve sent a sign-in link.
        </p>
        <p className="text-xs text-stone-400 mt-3">Link expires in 72 hours.</p>
        <button
          type="button"
          onClick={() => {
            setLinkSent(false)
            setEmail('')
          }}
          className="mt-5 text-xs font-semibold text-[#8B2E4A] hover:underline"
        >
          Send another link
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="flex border-b border-stone-100 px-2">
        {(['link', 'password'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t)
              setError(null)
            }}
            className={cn(
              'relative px-4 py-3 text-sm font-semibold transition-colors duration-150',
              tab === t ? 'text-[#8B2E4A] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#8B2E4A]' : 'text-stone-500 hover:text-stone-800',
            )}
          >
            {t === 'link' ? 'Email me a link' : 'Sign in with password'}
          </button>
        ))}
      </div>

      <div className="p-5">
        {tab === 'link' ? (
          <form onSubmit={onRequestLink} className="flex flex-col gap-3">
            <label className="text-xs font-semibold text-stone-600">Email address</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
            />
            <p className="text-xs text-stone-400 -mt-1">
              We&apos;ll send a one-time link to sign in. No password needed.
            </p>
            {error && <div className="text-xs text-red-600">{error}</div>}
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-3 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] disabled:opacity-60 disabled:cursor-not-allowed mt-1"
            >
              {submitting ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        ) : (
          <form onSubmit={onPasswordLogin} className="flex flex-col gap-3">
            <label className="text-xs font-semibold text-stone-600">Email address</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
            />
            <label className="text-xs font-semibold text-stone-600 mt-1">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
            />
            {error && <div className="text-xs text-red-600">{error}</div>}
            <button
              type="submit"
              disabled={submitting || !email.trim() || password.length < 8}
              className="bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-3 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] disabled:opacity-60 disabled:cursor-not-allowed mt-1"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="text-xs text-stone-400 text-center mt-1">
              Forgot your password? Use the email link tab to sign in.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
