'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

interface Invoice {
  id: string
  invoiceNum: string
  invoiceDate: string
  amountCents: number
  openBalanceCents: number
  status: string
}

interface Props {
  facilityCode: string
  residentId: string
  residentName: string
  outstandingCents: number
  stripeAvailable: boolean
  paymentSuccess: boolean
  facilityPhone: string | null
  facilityEmail: string | null
  invoices: Invoice[]
}

function formatDollars(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents ?? 0) / 100)
}

function formatDate(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(dt)
}

export function BillingClient({
  facilityCode,
  residentId,
  residentName,
  outstandingCents,
  stripeAvailable,
  paymentSuccess,
  facilityPhone,
  facilityEmail,
  invoices,
}: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [amountInput, setAmountInput] = useState((outstandingCents / 100).toFixed(2))
  const [submitting, setSubmitting] = useState(false)
  const shownToastRef = useRef(false)

  useEffect(() => {
    if (paymentSuccess && !shownToastRef.current) {
      shownToastRef.current = true
      toast.success('Payment received — thank you!')
      router.replace(`/family/${encodeURIComponent(facilityCode)}/billing?residentId=${residentId}`)
    }
  }, [paymentSuccess, toast, router, facilityCode, residentId])

  const onPay = async () => {
    const amountCents = Math.round(parseFloat(amountInput) * 100)
    if (!Number.isFinite(amountCents) || amountCents < 50) {
      toast.error('Enter an amount of at least $0.50.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/portal/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId, amountCents }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error ?? 'Could not start checkout.')
        return
      }
      window.location.href = j.data.checkoutUrl
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const showPay = stripeAvailable && outstandingCents > 0

  return (
    <div className="page-enter flex flex-col gap-4">
      <header>
        <h1 className="text-2xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
          Billing
        </h1>
        <p className="text-sm text-stone-500 mt-1">For {residentName}</p>
      </header>

      <section
        className={cn(
          'rounded-2xl border p-5',
          outstandingCents > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50',
        )}
      >
        <p className="text-xs uppercase tracking-wide font-semibold opacity-80">
          {outstandingCents > 0 ? 'Outstanding balance' : 'Account balance'}
        </p>
        <p
          className={cn(
            'text-3xl font-semibold mt-1',
            outstandingCents > 0 ? 'text-amber-900 balance-attention' : 'text-emerald-900',
          )}
        >
          {formatDollars(outstandingCents)}
        </p>
      </section>

      {showPay && (
        <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
          <h2 className="text-sm font-semibold text-stone-900 mb-3">Pay online</h2>
          <label className="text-xs font-semibold text-stone-600 flex flex-col gap-1.5">
            Amount
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0.50"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="w-full rounded-xl border border-stone-200 pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
              />
            </div>
          </label>
          <button
            type="button"
            onClick={onPay}
            disabled={submitting}
            className="w-full mt-3 bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-3 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] disabled:opacity-60"
          >
            {submitting ? 'Loading…' : 'Pay with card'}
          </button>
          <p className="text-[11px] text-stone-400 text-center mt-2">Secure payment via Stripe.</p>
        </section>
      )}

      <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
        <h2 className="text-sm font-semibold text-stone-900 mb-2">Pay by check</h2>
        <p className="text-sm text-stone-600">Senior Stylist</p>
        <p className="text-sm text-stone-600">2833 Smith Ave Ste 152</p>
        <p className="text-sm text-stone-600">Baltimore, MD 21209</p>
        <p className="text-sm text-stone-500 mt-2">443-450-3344 · pmt@seniorstylist.com</p>
      </section>

      <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-stone-900">Invoices</h2>
          <a
            href={`/api/portal/statement/${residentId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-[#8B2E4A] hover:underline"
          >
            Download statement
          </a>
        </div>
        {invoices.length === 0 ? (
          <p className="text-sm text-stone-400">No invoices yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-stone-100">
            {invoices.map((inv) => (
              <li key={inv.id} className="py-3 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold text-stone-900">{formatDate(inv.invoiceDate)}</p>
                  <p className="text-[12px] text-stone-500 mt-0.5">Invoice #{inv.invoiceNum} · {formatDollars(inv.amountCents)}</p>
                </div>
                <span
                  className={cn(
                    'text-[10.5px] font-semibold rounded-full px-2.5 py-1 shrink-0',
                    inv.status === 'paid'
                      ? 'bg-emerald-50 text-emerald-700'
                      : inv.openBalanceCents > 0 && inv.openBalanceCents < inv.amountCents
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-amber-50 text-amber-800',
                  )}
                >
                  {inv.status === 'paid'
                    ? 'Paid'
                    : inv.openBalanceCents > 0 && inv.openBalanceCents < inv.amountCents
                    ? `${formatDollars(inv.openBalanceCents)} open`
                    : 'Open'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(facilityPhone || facilityEmail) && (
        <p className="text-xs text-stone-400 text-center">
          Questions about your bill? Contact the facility office
          {facilityPhone && <> at {facilityPhone}</>}
          {facilityEmail && <> · {facilityEmail}</>}.
        </p>
      )}
    </div>
  )
}
