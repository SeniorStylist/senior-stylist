'use client'

// P55 — public gift form: presets 25/50/100 + free amount ($5–$500), optional
// "From" name, Stripe Checkout redirect. Senior-friendly sizing (18px inputs,
// ≥52px targets — the wizard's conventions).

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { usePortalT, type PortalLang } from '@/lib/portal-i18n'
import { formatMoney } from '@/lib/format'

const PRESETS_CENTS = [2500, 5000, 10000]

interface Props {
  token: string
  lang: PortalLang
  firstName: string
  success: boolean
}

export function GiftClient({ token, lang, firstName, success }: Props) {
  const t = usePortalT(lang)
  const [presetCents, setPresetCents] = useState<number | null>(5000)
  const [customInput, setCustomInput] = useState('')
  const [gifterName, setGifterName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (success) {
    return (
      <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-md)] p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="text-base font-semibold text-stone-800">{t('gift.successTitle')}</p>
        <p className="text-sm text-stone-500 mt-1">{t('gift.successBody', { name: firstName })}</p>
        <a
          href={`/gift/${encodeURIComponent(token)}`}
          className="inline-block mt-5 text-sm font-semibold text-[#8B2E4A] hover:underline"
        >
          {t('gift.sendAnother')}
        </a>
      </div>
    )
  }

  const customCents = (() => {
    const n = Number(customInput.replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(n) || n <= 0) return null
    return Math.round(n * 100)
  })()
  const amountCents = presetCents ?? customCents
  const amountValid = amountCents !== null && amountCents >= 500 && amountCents <= 50_000

  const onSubmit = async () => {
    if (!amountValid || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/gift/${encodeURIComponent(token)}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents, gifterName: gifterName.trim() || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.data?.checkoutUrl) {
        setError(typeof j.error === 'string' ? j.error : 'Something went wrong — please try again.')
        return
      }
      window.location.href = j.data.checkoutUrl
    } catch {
      setError('Network error — please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-md)] p-5 flex flex-col gap-4">
      <div>
        <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide mb-2">{t('gift.amount')}</p>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS_CENTS.map((cents) => (
            <button
              key={cents}
              type="button"
              onClick={() => { setPresetCents(cents); setCustomInput('') }}
              className={cn(
                'min-h-[52px] rounded-xl border text-lg font-semibold transition-colors',
                presetCents === cents
                  ? 'border-[#8B2E4A] bg-[#F9EFF2] text-[#8B2E4A]'
                  : 'border-stone-200 text-stone-700 hover:bg-stone-50',
              )}
            >
              {formatMoney(cents)}
            </button>
          ))}
        </div>
        <label className="block mt-2">
          <span className="sr-only">{t('gift.custom')}</span>
          <input
            type="text"
            inputMode="decimal"
            value={customInput}
            onChange={(e) => { setCustomInput(e.target.value); setPresetCents(null) }}
            placeholder={t('gift.custom')}
            className="w-full min-h-[52px] rounded-xl border border-stone-200 px-4 text-[18px] focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
          />
        </label>
        {customInput && presetCents === null && !amountValid && (
          <p role="alert" className="mt-1.5 text-xs text-amber-700">{t('gift.custom')}</p>
        )}
      </div>

      <label className="block">
        <span className="text-xs font-semibold text-stone-600 uppercase tracking-wide">{t('gift.from')}</span>
        <input
          type="text"
          value={gifterName}
          onChange={(e) => setGifterName(e.target.value)}
          maxLength={200}
          placeholder={t('gift.fromPlaceholder')}
          className="mt-1.5 w-full min-h-[52px] rounded-xl border border-stone-200 px-4 text-[18px] focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
        />
      </label>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!amountValid || submitting}
        className="min-h-[52px] w-full bg-[#8B2E4A] text-white text-base font-semibold rounded-2xl shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {submitting ? t('gift.sending') : t('gift.send')}
      </button>

      <p className="text-[11px] text-stone-400 text-center leading-snug">{t('gift.secure')}</p>
    </div>
  )
}
