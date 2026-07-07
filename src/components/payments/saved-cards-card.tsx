'use client'

// Saved cards (Card-On-File) card. Lists a resident's vaulted cards and lets the
// user add or remove one. Reused on the admin resident-detail page (pass `role`
// for billing-role gating) and the family-portal billing page (omit `role` — the
// API authorizes via the portal session).

import { canSeeBilling } from '@/lib/client-roles'
import { makePortalT, type PortalLang } from '@/lib/portal-i18n'
import { useCallback, useEffect, useState } from 'react'
import { CreditCard, Plus, Trash2 } from 'lucide-react'
import { AddCardForm } from './add-card-form'
import { useToast } from '@/components/ui/toast'

interface SavedCard {
  id: string
  brand: string | null
  last4: string | null
  expMonth: number | null
  expYear: number | null
  isDefault: boolean
}


export function SavedCardsCard({ residentId, role, lang = 'en' }: { residentId: string; role?: string; lang?: PortalLang }) {
  const { toast } = useToast()
  const t = makePortalT(lang)
  const [cards, setCards] = useState<SavedCard[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/payments/methods?residentId=${residentId}`)
      const j = await res.json().catch(() => ({}))
      if (res.ok) setCards(j.data.cards ?? [])
    } finally {
      setLoading(false)
    }
  }, [residentId])

  useEffect(() => {
    void load()
  }, [load])

  if (role !== undefined && !canSeeBilling(role)) return null

  async function remove(id: string) {
    const res = await fetch('/api/payments/methods', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ residentId, paymentMethodId: id }),
    })
    if (res.ok) {
      toast.success(t('cards.removed'))
      void load()
    } else {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error || t('cards.removeFailed'))
    }
  }

  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CreditCard size={16} className="text-[#8B2E4A]" />
          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">{t('cards.title')}</p>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-sm font-semibold text-[#8B2E4A]"
          >
            <Plus size={14} /> {t('cards.add')}
          </button>
        )}
      </div>

      {adding ? (
        <AddCardForm
          residentId={residentId}
          lang={lang}
          onSaved={() => {
            setAdding(false)
            void load()
          }}
          onCancel={() => setAdding(false)}
        />
      ) : loading ? (
        <div className="skeleton rounded-xl h-12 w-full" />
      ) : cards.length === 0 ? (
        <p className="text-sm text-stone-500">{t('cards.none')}</p>
      ) : (
        <ul className="space-y-2">
          {cards.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-xl border border-stone-100 px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-stone-900 capitalize">{c.brand || 'Card'}</span>
                <span className="text-stone-500">•••• {c.last4 || '????'}</span>
                {c.expMonth && c.expYear && (
                  <span className="text-[11px] text-stone-400">
                    {t('cards.exp')} {String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}
                  </span>
                )}
                {c.isDefault && (
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                    {t('cards.default')}
                  </span>
                )}
              </div>
              <button
                onClick={() => remove(c.id)}
                className="text-stone-400 hover:text-rose-600 transition-colors"
                aria-label={t('cards.removeAria')}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
