'use client'

// P50 — family-portal autopay opt-in card. The family can flip automatic
// payment on/off themselves (the API restricts portal writes to the enabled
// flag + default card; billing method semantics stay staff-owned) with an
// explicit confirm step and an "you'll get an email confirmation" note —
// the consent email fires server-side on every flip.

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { makePortalT, type PortalLang } from '@/lib/portal-i18n'
import { cn } from '@/lib/utils'

interface AutopayState {
  autopayEnabled: boolean
  cards: { id: string; brand: string | null; last4: string | null; isDefault: boolean }[]
}

export function AutopayCard({
  residentId,
  lang = 'en',
  initialEnabled = false,
}: {
  residentId: string
  lang?: PortalLang
  initialEnabled?: boolean
}) {
  const { toast } = useToast()
  const t = makePortalT(lang)
  const [enabled, setEnabled] = useState(initialEnabled)
  const [cards, setCards] = useState<AutopayState['cards']>([])
  const [loaded, setLoaded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/payments/autopay?residentId=${residentId}`)
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.data) {
        setEnabled(!!j.data.autopayEnabled)
        setCards(j.data.cards ?? [])
      }
    } finally {
      setLoaded(true)
    }
  }, [residentId])

  useEffect(() => {
    void load()
  }, [load])

  const defaultCard = cards.find((c) => c.isDefault) ?? cards[0] ?? null
  const cardLabel = defaultCard
    ? `${(defaultCard.brand ?? 'Card').toUpperCase()} •••• ${defaultCard.last4 ?? ''}`
    : null
  const hasCard = cards.length > 0

  const save = async (next: boolean) => {
    setSaving(true)
    try {
      const res = await fetch('/api/payments/autopay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId, autopayEnabled: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || t('autopay.saveFailed'))
        return
      }
      setEnabled(next)
      setConfirming(false)
      toast.success(t('autopay.saved'))
    } catch {
      toast.error(t('autopay.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <RefreshCw size={16} className="text-[#8B2E4A]" />
          <h2 className="text-sm font-semibold text-stone-900">{t('autopay.title')}</h2>
        </div>
        <span
          className={cn(
            'text-[10.5px] font-semibold rounded-full px-2.5 py-1',
            enabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-stone-100 text-stone-500',
          )}
        >
          {enabled ? t('autopay.on') : t('autopay.off')}
        </span>
      </div>
      <p className="text-xs text-stone-500 leading-relaxed">{t('autopay.hint')}</p>
      {enabled && cardLabel && (
        <p className="text-xs font-medium text-stone-600 mt-2">{t('autopay.chargesTo', { card: cardLabel })}</p>
      )}

      {!loaded ? (
        <div className="skeleton rounded-xl h-10 w-full mt-3" />
      ) : confirming ? (
        <div className="mt-3 rounded-xl bg-[#F9EFF2] border border-rose-100 p-4">
          <p className="text-sm font-semibold text-stone-900">
            {enabled ? t('autopay.confirmOff') : t('autopay.confirmOn')}
          </p>
          {!enabled && cardLabel && (
            <p className="text-xs text-stone-600 mt-1">{t('autopay.chargesTo', { card: cardLabel })}</p>
          )}
          <p className="text-xs text-stone-500 mt-1">{t('autopay.emailNote')}</p>
          <div className="flex flex-col gap-2 mt-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save(!enabled)}
              className="w-full bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-3 min-h-[48px] shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] disabled:opacity-60"
            >
              {saving ? t('common.loading') : t('autopay.confirmYes')}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setConfirming(false)}
              className="w-full bg-white text-stone-600 border border-stone-200 text-sm font-semibold rounded-xl px-5 py-3 min-h-[48px] hover:bg-stone-50 disabled:opacity-60"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : enabled ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="w-full mt-3 bg-white text-stone-600 border border-stone-200 text-sm font-semibold rounded-xl px-5 py-3 min-h-[48px] hover:bg-stone-50"
        >
          {t('autopay.turnOff')}
        </button>
      ) : hasCard ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="w-full mt-3 bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-3 min-h-[48px] shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C]"
        >
          {t('autopay.turnOn')}
        </button>
      ) : (
        <p className="text-xs text-stone-400 mt-3">{t('autopay.needCard')}</p>
      )}
    </section>
  )
}
