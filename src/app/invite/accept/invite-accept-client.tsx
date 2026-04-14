'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  token: string
  facilityName: string
  inviteRole: string
  inviteEmail: string
}

export function InviteAcceptClient({ token, facilityName, inviteRole, inviteEmail }: Props) {
  const [email, setEmail] = useState(inviteEmail)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://senior-stylist.vercel.app'
  const callbackNext = encodeURIComponent(`/invite/accept?token=${token}`)

  const handleMagicLink = async () => {
    if (!email.trim()) return
    setLoading(true)
    setError(null)
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${appUrl}/auth/callback?next=${callbackNext}`,
        },
      })
      if (otpError) {
        setError(otpError.message)
      } else {
        setSent(true)
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setGoogleLoading(true)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${appUrl}/auth/callback?next=${callbackNext}`,
      },
    })
  }

  // "Check your email" state
  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="bg-white rounded-2xl shadow-xl border border-stone-100 p-10 w-full max-w-sm text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ backgroundColor: '#fdf2f4' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h1
            className="text-xl font-bold text-stone-900 mb-2"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Check your email
          </h1>
          <p className="text-sm text-stone-500 leading-relaxed">
            We sent a login link to{' '}
            <span className="font-semibold text-stone-700">{email}</span>.
            Click the link in the email to join{' '}
            <span className="font-semibold text-stone-700">{facilityName}</span>.
          </p>
          <button
            onClick={() => { setSent(false); setError(null) }}
            className="mt-6 text-sm font-semibold text-[#8B2E4A] hover:underline"
          >
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="bg-white rounded-2xl shadow-xl border border-stone-100 p-10 w-full max-w-sm text-center">
        {/* Logo */}
        <div className="mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ backgroundColor: '#0D2B2E' }}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M14 4C8.477 4 4 8.477 4 14s4.477 10 10 10 10-4.477 10-10S19.523 4 14 4z" fill="#C4687A" opacity="0.3"/>
              <path d="M14 8c-3.314 0-6 2.686-6 6s2.686 6 6 6 6-2.686 6-6-2.686-6-6-6z" fill="#C4687A"/>
              <path d="M14 11a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" fill="#0D2B2E"/>
            </svg>
          </div>
          <h1
            className="text-2xl font-bold text-stone-900"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Join {facilityName}
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            You've been invited as a <span className="font-semibold text-stone-700">{inviteRole}</span>
          </p>
        </div>

        {/* Magic link form */}
        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            onKeyDown={(e) => e.key === 'Enter' && handleMagicLink()}
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 transition-all"
          />
          <button
            onClick={handleMagicLink}
            disabled={loading || !email.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl hover:bg-[#72253C] active:scale-95 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M22 7l-10 7L2 7" />
              </svg>
            )}
            {loading ? 'Sending…' : 'Send magic link'}
          </button>
        </div>

        {error && (
          <p className="text-xs text-red-600 mt-2">{error}</p>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-stone-200" />
          <span className="text-xs text-stone-400 font-medium">or</span>
          <div className="flex-1 h-px bg-stone-200" />
        </div>

        {/* Google OAuth */}
        <button
          onClick={handleGoogle}
          disabled={googleLoading}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-stone-200 rounded-xl text-sm font-semibold text-stone-700 hover:bg-stone-50 hover:border-stone-300 active:scale-95 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
        >
          {googleLoading ? (
            <svg className="animate-spin h-4 w-4 text-stone-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.707A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
          )}
          {googleLoading ? 'Connecting…' : 'Continue with Google'}
        </button>

        <p className="text-xs text-stone-400 mt-6">
          For authorized facility staff only
        </p>
      </div>
    </div>
  )
}
