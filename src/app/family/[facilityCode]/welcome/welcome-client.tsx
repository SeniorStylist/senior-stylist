'use client'

// P50-C7 — the first-login setup wizard. Senior-friendly: one thing per
// screen, 18px+ text, ≥52px buttons, every step skippable, no dead ends.
// Steps: save a card (Stripe Elements — the phone-browser form offers the
// native camera card scan) → autopay opt-in (only when a card was just
// saved) → visit rhythm. Finish/skip stamps onboarded_at so the flow never
// shows again.

import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useToast } from '@/components/ui/toast'
import { usePortalT, type PortalLang } from '@/lib/portal-i18n'
import { cn } from '@/lib/utils'

const AddCardForm = dynamic(
  () => import('@/components/payments/add-card-form').then((m) => m.AddCardForm),
  { ssr: false },
)

type Step = 'card' | 'autopay' | 'rhythm' | 'done'

interface Props {
  facilityCode: string
  lang: PortalLang
  residentId: string
  residentName: string
  stripeConfigured: boolean
}

export function WelcomeClient({ facilityCode, lang, residentId, residentName, stripeConfigured }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const t = usePortalT(lang)
  const [step, setStep] = useState<Step>(stripeConfigured ? 'card' : 'rhythm')
  const [cardSaved, setCardSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const completedRef = useRef(false)

  const base = `/family/${encodeURIComponent(facilityCode)}`
  const steps: Step[] = stripeConfigured ? ['card', 'autopay', 'rhythm'] : ['rhythm']
  const stepIndex = step === 'done' ? steps.length : steps.indexOf(step)

  // Idempotent server-side; the ref just avoids duplicate requests.
  const markComplete = useCallback(() => {
    if (completedRef.current) return
    completedRef.current = true
    fetch('/api/portal/onboarding-complete', { method: 'POST' }).catch(() => {})
  }, [])

  const finish = (to: 'home' | 'request') => {
    markComplete()
    router.push(to === 'request' ? `${base}/request` : base)
    router.refresh()
  }

  const skipAll = () => finish('home')

  const enableAutopay = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/payments/autopay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId, autopayEnabled: true }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || t('autopay.saveFailed'))
        return
      }
      toast.success(t('autopay.saved'))
      setStep('rhythm')
    } catch {
      toast.error(t('common.networkError'))
    } finally {
      setSaving(false)
    }
  }

  const pickRhythm = async (freq: 'weekly' | 'biweekly' | 'monthly' | null) => {
    if (freq === null) {
      setStep('done')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/portal/residents/${residentId}/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitFrequency: freq }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        toast.error(j.error || t('common.networkError'))
        return
      }
      setStep('done')
    } catch {
      toast.error(t('common.networkError'))
    } finally {
      setSaving(false)
    }
  }

  const bigButton =
    'w-full text-white font-semibold rounded-2xl px-5 py-3.5 min-h-[52px] bg-[#8B2E4A] shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] disabled:opacity-60 portal-cta-cap'
  const softButton =
    'w-full text-stone-600 font-semibold rounded-2xl px-5 py-3.5 min-h-[52px] bg-white border border-stone-200 hover:bg-stone-50 disabled:opacity-60 portal-cta-cap'

  return (
    <div className="page-enter flex flex-col gap-4">
      <header className="text-center">
        <h1 className="text-2xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
          {step === 'done' ? t('welcome.done.title') : t('welcome.title')}
        </h1>
        {step !== 'done' && <p className="text-sm text-stone-500 mt-1">{t('welcome.subtitle')}</p>}
      </header>

      {/* progress dots */}
      {steps.length > 1 && step !== 'done' && (
        <div className="flex justify-center gap-2" aria-hidden="true">
          {steps.map((s, i) => (
            <span
              key={s}
              className={cn('w-2.5 h-2.5 rounded-full', i <= stepIndex ? 'bg-[#8B2E4A]' : 'bg-stone-200')}
            />
          ))}
        </div>
      )}

      {step === 'card' && (
        <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
          <h2 className="font-semibold text-stone-900" style={{ fontSize: 18 }}>
            {t('welcome.stepCard.title', { name: residentName })}
          </h2>
          <p className="text-sm text-stone-500 mt-1 mb-4">{t('welcome.stepCard.hint')}</p>
          {cardSaved ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-center">
              <p className="text-sm font-semibold text-emerald-800">{t('welcome.cardSaved')}</p>
            </div>
          ) : (
            <AddCardForm
              residentId={residentId}
              lang={lang}
              onSaved={() => {
                setCardSaved(true)
                setStep('autopay')
              }}
              onCancel={() => setStep('rhythm')}
            />
          )}
          {!cardSaved && (
            <button type="button" onClick={() => setStep('rhythm')} className={cn(softButton, 'mt-3')}>
              {t('welcome.skipStep')}
            </button>
          )}
        </section>
      )}

      {step === 'autopay' && (
        <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
          <h2 className="font-semibold text-stone-900" style={{ fontSize: 18 }}>
            {t('welcome.stepAutopay.title')}
          </h2>
          <p className="text-sm text-stone-500 mt-1 mb-1">{t('welcome.stepAutopay.hint')}</p>
          <p className="text-xs text-stone-400 mb-4">{t('autopay.emailNote')}</p>
          <div className="flex flex-col gap-2">
            <button type="button" disabled={saving} onClick={() => void enableAutopay()} className={bigButton}>
              {saving ? t('common.loading') : t('welcome.stepAutopay.yes')}
            </button>
            <button type="button" disabled={saving} onClick={() => setStep('rhythm')} className={softButton}>
              {t('welcome.skipStep')}
            </button>
          </div>
        </section>
      )}

      {step === 'rhythm' && (
        <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
          <h2 className="font-semibold text-stone-900" style={{ fontSize: 18 }}>
            {t('welcome.stepRhythm.title', { name: residentName })}
          </h2>
          <p className="text-sm text-stone-500 mt-1 mb-4">{t('welcome.stepRhythm.hint')}</p>
          <div className="flex flex-col gap-2">
            {(['weekly', 'biweekly', 'monthly'] as const).map((freq) => (
              <button
                key={freq}
                type="button"
                disabled={saving}
                onClick={() => void pickRhythm(freq)}
                className={bigButton}
              >
                {t(`welcome.rhythm.${freq}`)}
              </button>
            ))}
            <button type="button" disabled={saving} onClick={() => void pickRhythm(null)} className={softButton}>
              {t('welcome.rhythm.notSure')}
            </button>
          </div>
        </section>
      )}

      {step === 'done' && (
        <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-sm text-stone-500 mb-4">{t('welcome.done.hint')}</p>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => finish('request')} className={bigButton}>
              {t('welcome.done.request')}
            </button>
            <button type="button" onClick={() => finish('home')} className={softButton}>
              {t('welcome.done.home')}
            </button>
          </div>
        </section>
      )}

      {step !== 'done' && (
        <button type="button" onClick={skipAll} className="text-sm text-stone-400 hover:text-stone-600 underline mx-auto">
          {t('welcome.skipAll')}
        </button>
      )}
    </div>
  )
}
