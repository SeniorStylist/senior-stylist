'use client'

// Add-a-card form (Card-On-File). Fetches a SetupIntent, renders the Stripe
// Payment Element (card data goes straight into Stripe's iframe — never our DOM
// or servers), confirms it, then persists the vaulted card via /api/payments/methods.
//
// Used on the family-portal billing page (POA self-service) and the admin resident
// detail page (phone/in-person setup). Stripe.js is loaded lazily so it never
// enters the bundle for users who don't open the form.

import { useEffect, useState } from 'react'
import { type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { getStripePromise } from './stripe-browser'
import { makePortalT, type PortalLang } from '@/lib/portal-i18n'

interface AddCardFormProps {
  residentId: string
  lang?: PortalLang
  onSaved?: () => void
  onCancel?: () => void
}

export function AddCardForm({ residentId, lang = 'en', onSaved, onCancel }: AddCardFormProps) {
  const { toast } = useToast()
  const t = makePortalT(lang)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/payments/setup-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ residentId }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || t('cards.setupFailed'))
        if (cancelled) return
        setClientSecret(json.data.clientSecret)
        setStripePromise(getStripePromise(json.data.publishableKey))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('cards.setupFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [residentId])

  if (loading) {
    return <div className="skeleton rounded-2xl h-40 w-full" />
  }
  if (error || !clientSecret || !stripePromise) {
    return (
      <div className="rounded-2xl border border-stone-100 bg-white p-5 text-sm text-stone-600">
        {error || t('cards.notConfigured')}
        {onCancel && (
          <button onClick={onCancel} className="mt-3 block text-[#8B2E4A] font-semibold">
            {t('common.close')}
          </button>
        )}
      </div>
    )
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret, locale: lang, appearance: { theme: 'stripe', variables: { colorPrimary: '#8B2E4A' } } }}
    >
      <CardFields
        residentId={residentId}
        lang={lang}
        onSaved={() => {
          toast.success(t('cards.saved'))
          onSaved?.()
        }}
        onCancel={onCancel}
      />
    </Elements>
  )
}

function CardFields({ residentId, lang = 'en', onSaved, onCancel }: AddCardFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const { toast } = useToast()
  const t = makePortalT(lang)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    try {
      const { error, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
      })
      if (error) {
        toast.error(error.message || t('cards.saveFailed'))
        return
      }
      if (setupIntent?.status !== 'succeeded') {
        toast.error(t('cards.setupIncomplete'))
        return
      }
      // Persist immediately (webhook is a backstop).
      const res = await fetch('/api/payments/methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId, setupIntentId: setupIntent.id }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error || t('cards.authorizedNotSaved'))
        return
      }
      onSaved?.()
    } catch {
      toast.error(t('cards.saveFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      <p className="text-[11px] text-stone-400 leading-snug">{t('cards.disclaimer')}</p>
      <div className="flex items-center gap-2">
        <Button type="submit" loading={submitting} disabled={!stripe}>
          {t('cards.saveCard')}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </form>
  )
}
