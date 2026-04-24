'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SignOutButton } from './sign-out-button'
import Image from 'next/image'

type PageState = 'loading' | 'idle' | 'submitting' | 'submitted' | 'already_pending'

export default function UnauthorizedPage() {
  const [pageState, setPageState] = useState<PageState>('loading')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<'stylist' | 'admin'>('stylist')
  const [userId, setUserId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUserEmail(user.email ?? null)
        setUserId(user.id)
        setFullName(user.user_metadata?.full_name ?? '')
      }
      setPageState('idle')
    }
    init()
  }, [])

  const handleSubmit = async () => {
    if (!userEmail) return
    setPageState('submitting')
    setErrorMsg(null)

    try {
      const res = await fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          fullName: fullName.trim() || undefined,
          userId: userId ?? undefined,
          role,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setErrorMsg(json.error ?? 'Something went wrong. Please try again.')
        setPageState('idle')
        return
      }
      setPageState(json.data?.alreadyExists ? 'already_pending' : 'submitted')
    } catch {
      setErrorMsg('Something went wrong. Please try again.')
      setPageState('idle')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="bg-white rounded-2xl shadow-xl border border-stone-100 p-8 w-full max-w-sm">

        {/* Loading */}
        {pageState === 'loading' && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-stone-200 border-t-[#8B2E4A] rounded-full animate-spin" />
          </div>
        )}

        {/* Submitted / Already pending */}
        {(pageState === 'submitted' || pageState === 'already_pending') && (
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 bg-emerald-50">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-stone-900 mb-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
              {pageState === 'already_pending' ? 'Request already sent' : 'Request sent!'}
            </h1>
            <p className="text-sm text-stone-500 mt-2">
              {pageState === 'already_pending'
                ? 'You already have a pending request. Waiting for administrator approval.'
                : 'Your administrator will review it shortly. Refresh this page once approved.'}
            </p>
            <div className="mt-6 space-y-3">
              <button
                onClick={() => window.location.reload()}
                className="block w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                style={{ backgroundColor: '#8B2E4A' }}
              >
                Refresh
              </button>
              <SignOutButton />
            </div>
          </div>
        )}

        {/* Idle / Submitting */}
        {(pageState === 'idle' || pageState === 'submitting') && (
          <>
            {/* Icon */}
            <div className="flex justify-center mb-4">
              <Image src="/seniorstylistlogo.jpg" alt="Senior Stylist" width={140} height={56} className="mx-auto mb-2" />
            </div>

            <h1 className="text-xl font-bold text-stone-900 text-center mb-1" style={{ fontFamily: "'DM Serif Display', serif" }}>
              Request access
            </h1>

            {userEmail && (
              <p className="text-xs text-stone-400 text-center mb-5">
                Signed in as <span className="font-medium text-stone-600">{userEmail}</span>
              </p>
            )}

            <div className="space-y-4">
              {/* Name input */}
              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-1">Your name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                />
              </div>

              {/* Role selector */}
              <div>
                <label className="block text-xs font-semibold text-stone-600 mb-2">I am a…</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole('stylist')}
                    className={`px-4 py-3 rounded-xl border-2 text-sm font-semibold text-left transition-all ${
                      role === 'stylist'
                        ? 'border-[#8B2E4A] bg-rose-50 text-[#8B2E4A]'
                        : 'border-stone-200 text-stone-600 hover:border-stone-300'
                    }`}
                  >
                    <span className="block text-base mb-0.5">✂️</span>
                    Stylist
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('admin')}
                    className={`px-4 py-3 rounded-xl border-2 text-sm font-semibold text-left transition-all ${
                      role === 'admin'
                        ? 'border-[#8B2E4A] bg-rose-50 text-[#8B2E4A]'
                        : 'border-stone-200 text-stone-600 hover:border-stone-300'
                    }`}
                  >
                    <span className="block text-base mb-0.5">🏢</span>
                    Admin
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={!userEmail || pageState === 'submitting'}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60 active:scale-[0.98]"
                style={{ backgroundColor: '#8B2E4A' }}
              >
                {!userEmail ? 'Loading…' : pageState === 'submitting' ? 'Sending…' : 'Send Request'}
              </button>

              {errorMsg && (
                <p className="text-xs text-red-500 text-center">{errorMsg}</p>
              )}

              <SignOutButton />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
