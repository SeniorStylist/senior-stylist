'use client'

// Add-a-card form (Card-On-File). Fetches a SetupIntent, renders the Stripe
// Payment Element (card data goes straight into Stripe's iframe — never our DOM
// or servers), confirms it, then persists the vaulted card via /api/payments/methods.
//
// Used on the family-portal billing page (POA self-service) and the admin resident
// detail page (phone/in-person setup). Stripe.js is loaded lazily so it never
// enters the bundle for users who don't open the form.

import { useEffect, useState } from 'react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

interface AddCardFormProps {
  residentId: string
  onSaved?: () => void
  onCancel?: () => void
}

// Cache the Stripe.js singleton per publishable key across mounts.
let stripePromiseCache: { key: string; promise: Promise<Stripe | null> } | null = null
function getStripePromise(key: string): Promise<Stripe | null> {
  if (!stripePromiseCache || stripePromiseCache.key !== key) {
    stripePromiseCache = { key, promise: loadStripe(key) }
  }
  return stripePromiseCache.promise
}

export function AddCardForm({ residentId, onSaved, onCancel }: AddCardFormProps) {
  const { toast } = useToast()
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
        if (!res.ok) throw new Error(json.error || 'Could not start card setup')
        if (cancelled) return
        setClientSecret(json.data.clientSecret)
        setStripePromise(getStripePromise(json.data.publishableKey))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not start card setup')
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
        {error || 'Card payments are not configured for this facility.'}
        {onCancel && (
          <button onClick={onCancel} className="mt-3 block text-[#8B2E4A] font-semibold">
            Close
          </button>
        )}
      </div>
    )
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#8B2E4A' } } }}
    >
      <CardFields
        residentId={residentId}
        onSaved={() => {
          toast.success('Card saved')
          onSaved?.()
        }}
        onCancel={onCancel}
      />
    </Elements>
  )
}

function CardFields({ residentId, onSaved, onCancel }: AddCardFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const { toast } = useToast()
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
        toast.error(error.message || 'Could not save card')
        return
      }
      if (setupIntent?.status !== 'succeeded') {
        toast.error('Card setup did not complete')
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
        toast.error(json.error || 'Card authorized but could not be saved')
        return
      }
      onSaved?.()
    } catch {
      toast.error('Could not save card')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      <p className="text-[11px] text-stone-400 leading-snug">
        Your card is stored securely by Stripe. Senior Stylist never sees or stores your full card
        number. You authorize Senior Stylist to charge this card for services rendered.
      </p>
      <div className="flex items-center gap-2">
        <Button type="submit" loading={submitting} disabled={!stripe}>
          Save card
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
