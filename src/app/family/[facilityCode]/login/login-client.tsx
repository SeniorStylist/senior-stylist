'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { usePortalT, type PortalLang } from '@/lib/portal-i18n'

interface Props {
  facilityCode: string
  lang: PortalLang
}

export function LoginClient({ facilityCode, lang }: Props) {
  const router = useRouter()
  const t = usePortalT(lang)
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
        setError(j.error ?? t('common.error'))
        return
      }
      setLinkSent(true)
    } catch {
      setError(t('common.networkError'))
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
        setError(j.error ?? t('login.invalidCreds'))
        return
      }
      router.push(`/family/${encodeURIComponent(facilityCode)}`)
      router.refresh()
    } catch {
      setError(t('common.networkError'))
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
        <p className="text-base font-semibold text-stone-800">{t('login.checkEmail')}</p>
        <p className="text-sm text-stone-500 mt-1">{t('login.linkSent', { email })}</p>
        <p className="text-xs text-stone-500 mt-3">{t('login.linkExpiry')}</p>
        <button
          type="button"
          onClick={() => {
            setLinkSent(false)
            setEmail('')
          }}
          className="mt-5 text-xs font-semibold text-[#8B2E4A] hover:underline"
        >
          {t('login.sendAnother')}
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="flex border-b border-stone-100 px-2">
        {(['link', 'password'] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => {
              setTab(tabKey)
              setError(null)
            }}
            className={cn(
              'relative px-4 py-3 text-sm font-semibold transition-colors duration-150',
              tab === tabKey ? 'text-[#8B2E4A] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#8B2E4A]' : 'text-stone-500 hover:text-stone-800',
            )}
          >
            {tabKey === 'link' ? t('login.tabLink') : t('login.tabPassword')}
          </button>
        ))}
      </div>

      <div className="p-5">
        {tab === 'link' ? (
          <form onSubmit={onRequestLink} className="flex flex-col gap-3">
            <label htmlFor="login-link-email" className="text-xs font-semibold text-stone-600">{t('login.email')}</label>
            <input
              id="login-link-email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
            />
            <p className="text-xs text-stone-500 -mt-1">{t('login.linkHint')}</p>
            {error && <div role="alert" className="text-xs text-red-600">{error}</div>}
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-3 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] disabled:opacity-60 disabled:cursor-not-allowed mt-1"
            >
              {submitting ? t('login.sending') : t('login.sendLink')}
            </button>
          </form>
        ) : (
          <form onSubmit={onPasswordLogin} className="flex flex-col gap-3">
            <label htmlFor="login-pw-email" className="text-xs font-semibold text-stone-600">{t('login.email')}</label>
            <input
              id="login-pw-email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
            />
            <label htmlFor="login-password" className="text-xs font-semibold text-stone-600 mt-1">{t('login.password')}</label>
            <input
              id="login-password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
            />
            {error && <div role="alert" className="text-xs text-red-600">{error}</div>}
            <button
              type="submit"
              disabled={submitting || !email.trim() || password.length < 8}
              className="bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-3 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] disabled:opacity-60 disabled:cursor-not-allowed mt-1"
            >
              {submitting ? t('login.signingIn') : t('login.signIn')}
            </button>
            <p className="text-xs text-stone-500 text-center mt-1">{t('login.forgot')}</p>
          </form>
        )}
      </div>
      <div className="border-t border-stone-100 px-5 py-3 text-center">
        <p className="text-xs text-stone-500">
          {t('login.newHere')}{' '}
          <Link
            href={`/family/${encodeURIComponent(facilityCode)}/signup`}
            className="font-semibold text-[#8B2E4A] hover:underline"
          >
            {t('login.createAccount')}
          </Link>
        </p>
      </div>
    </div>
  )
}
