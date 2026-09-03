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
  /**
   * Fired after the card is vaulted. P57 — receives the save route's payload so
   * a caller that asked for autopay in the SAME request can report whether the
   * server actually turned it on, instead of firing a second POST to find out.
   */
  onSaved?: (result?: { autopayEnabled?: boolean; autopayError?: string; autopayIdle?: boolean }) => void
  onCancel?: () => void
  /** P54 — signup wizard: 30-min single-use card token (no session yet). */
  signupToken?: string
  /** P54 — auto-enable per-visit autopay after the save (portal/signup only). */
  enableAutopay?: boolean
  /**
   * P57 — staff attestation that the FAMILY asked for the card to be kept on
   * file for automatic payment. The route honors `enableAutopay` for a
   * stylist/admin actor only when this rides the SAME request; without it the
   * modal had to fire a second POST, which burned two `paymentSetup` tokens
   * per card and capped a staff member at ~10 attested saves an hour.
   */
  consentAttested?: boolean
  /** P54 — fired when the SetupIntent fetch fails (wizard shows its quiet skip link). */
  onSetupError?: () => void
}

export function AddCardForm({ residentId, lang = 'en', onSaved, onCancel, signupToken, enableAutopay, consentAttested, onSetupError }: AddCardFormProps) {
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
          body: JSON.stringify({ residentId, ...(signupToken ? { signupToken } : {}) }),
        })
        const json = await res.json()
        if (!res.ok) {
          // P53 — 501/503 = not configured / not turned on yet: show the
          // TRANSLATED message instead of the raw English server string.
          if (res.status === 501 || res.status === 503) throw new Error(t('cards.notConfigured'))
          throw new Error(json.error || t('cards.setupFailed'))
        }
        if (cancelled) return
        setClientSecret(json.data.clientSecret)
        setStripePromise(getStripePromise(json.data.publishableKey))
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t('cards.setupFailed'))
          onSetupError?.()
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [residentId, signupToken])

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
        signupToken={signupToken}
        enableAutopay={enableAutopay}
        consentAttested={consentAttested}
        onSaved={(result) => {
          toast.success(t('cards.saved'))
          onSaved?.(result)
        }}
        onCancel={onCancel}
      />
    </Elements>
  )
}

function CardFields({ residentId, lang = 'en', onSaved, onCancel, signupToken, enableAutopay, consentAttested }: AddCardFormProps) {
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
        body: JSON.stringify({
          residentId,
          setupIntentId: setupIntent.id,
          ...(signupToken ? { signupToken } : {}),
          ...(enableAutopay ? { enableAutopay: true } : {}),
          ...(consentAttested ? { consentAttested: true } : {}),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error || t('cards.authorizedNotSaved'))
        return
      }
      onSaved?.(json?.data)
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
