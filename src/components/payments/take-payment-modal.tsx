'use client'

// In-app "Take Payment" modal (Part B). A stylist / admin / bookkeeper collects a
// card payment on their phone via the Stripe Payment Element. Money lands in the
// Senior Stylist platform account; the payment is tied to the chosen booking(s).
// Optionally saves the card for future Card-On-File charges.

import { useState } from 'react'
import { type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { getStripePromise } from './stripe-browser'
import { tapToPayAvailable, initTerminal, connectLocalReader, collectTerminalPayment } from '@/lib/tap-to-pay'

interface TakePaymentModalProps {
  open: boolean
  onClose: () => void
  residentId: string
  residentName: string
  defaultAmountCents: number
  bookingIds?: string[]
  onPaid?: () => void
}

export function TakePaymentModal(props: TakePaymentModalProps) {
  const { open, onClose, residentId, residentName, defaultAmountCents, bookingIds } = props
  const { toast } = useToast()
  const [amount, setAmount] = useState((defaultAmountCents / 100).toFixed(2))
  const [saveCard, setSaveCard] = useState(false)
  const [starting, setStarting] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null)
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)
  // F7 — Tap to Pay (native + flag-gated; hidden everywhere else)
  const [tapping, setTapping] = useState(false)

  function reset() {
    setClientSecret(null)
    setStripePromise(null)
    setPaymentIntentId(null)
    setAmount((defaultAmountCents / 100).toFixed(2))
    setSaveCard(false)
  }

  async function start() {
    const amountCents = Math.round(parseFloat(amount) * 100)
    if (!Number.isFinite(amountCents) || amountCents < 50) {
      toast.error('Enter an amount of at least $0.50')
      return
    }
    setStarting(true)
    try {
      const res = await fetch('/api/payments/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId, amountCents, bookingIds, savePaymentMethod: saveCard }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Could not start payment')
        return
      }
      setClientSecret(j.data.clientSecret)
      setPaymentIntentId(j.data.paymentIntentId)
      setStripePromise(getStripePromise(j.data.publishableKey))
    } finally {
      setStarting(false)
    }
  }

  function close() {
    reset()
    onClose()
  }

  // F7 — Tap to Pay: card_present PI → phone's built-in reader collects + confirms
  // → the existing idempotent finalize (confirm POST; webhook backstop).
  async function tapToPay() {
    const amountCents = Math.round(parseFloat(amount) * 100)
    if (!Number.isFinite(amountCents) || amountCents < 50) {
      toast.error('Enter an amount of at least $0.50')
      return
    }
    setTapping(true)
    try {
      const res = await fetch('/api/payments/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId, amountCents, bookingIds, terminal: true }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Could not start payment')
        return
      }
      await initTerminal()
      await connectLocalReader()
      await collectTerminalPayment(j.data.clientSecret)
      await fetch('/api/payments/intent/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentIntentId: j.data.paymentIntentId }),
      }).catch(() => {})
      toast.success('Payment collected')
      props.onPaid?.()
      close()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Tap to Pay failed')
    } finally {
      setTapping(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title={`Take payment — ${residentName}`}>
      <div className="p-1 space-y-4">
        {!clientSecret ? (
          <>
            <label className="block">
              <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Amount</span>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-stone-500">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.50"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full text-lg border border-stone-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50"
                />
              </div>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} className="accent-[#8B2E4A] w-4 h-4" />
              <span className="text-stone-700">Save this card for automatic future payments</span>
            </label>
            <Button onClick={start} loading={starting} className="w-full">
              Continue to card
            </Button>
            {tapToPayAvailable() && (
              <Button onClick={tapToPay} loading={tapping} variant="secondary" className="w-full">
                📳 Tap to Pay on this phone
              </Button>
            )}
          </>
        ) : stripePromise ? (
          <Elements
            stripe={stripePromise}
            options={{ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#8B2E4A' } } }}
          >
            <PayFields
              amountLabel={`$${(Math.round(parseFloat(amount) * 100) / 100).toFixed(2)}`}
              paymentIntentId={paymentIntentId!}
              onPaid={() => {
                toast.success('Payment collected')
                props.onPaid?.()
                close()
              }}
            />
          </Elements>
        ) : null}
      </div>
    </Modal>
  )
}

function PayFields({
  amountLabel,
  paymentIntentId,
  onPaid,
}: {
  amountLabel: string
  paymentIntentId: string
  onPaid: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const { toast } = useToast()
  const [paying, setPaying] = useState(false)

  async function pay(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setPaying(true)
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' })
      if (error) {
        toast.error(error.message || 'Payment failed')
        return
      }
      if (paymentIntent?.status !== 'succeeded') {
        toast.error(`Payment ${paymentIntent?.status ?? 'not completed'}`)
        return
      }
      // Finalize server-side (webhook is a backstop).
      await fetch('/api/payments/intent/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentIntentId }),
      }).catch(() => {})
      onPaid()
    } catch {
      toast.error('Payment failed')
    } finally {
      setPaying(false)
    }
  }

  return (
    <form onSubmit={pay} className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      <Button type="submit" loading={paying} disabled={!stripe} className="w-full">
        Pay {amountLabel}
      </Button>
    </form>
  )
}
