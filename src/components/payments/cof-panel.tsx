'use client'

// Admin/billing "Automatic payment" (COF) panel for a resident: toggle auto-pay,
// choose the method, collect the balance now, or send the payor a pay-link.
// Billing-role gated. Pairs with <SavedCardsCard> (which manages the cards).

import { canSeeBilling } from '@/lib/client-roles'
import { useCallback, useEffect, useState } from 'react'
import { Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useSendConfirm } from '@/components/ui/send-confirm-dialog'
import { TakePaymentModal } from './take-payment-modal'

interface AutopayState {
  autopayEnabled: boolean
  autopayMethod: string | null
  outstandingCents: number
  availableCreditCents: number
  cards: { id: string; brand: string | null; last4: string | null; isDefault: boolean }[]
}

const METHODS: { value: string; label: string }[] = [
  { value: 'salon_then_card', label: 'Salon account, then card' },
  { value: 'card', label: 'Saved card only' },
  { value: 'salon_account', label: 'Salon account only' },
]


function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function CofPanel({
  residentId,
  residentName,
  role,
  poaEmail,
  poaPhone,
}: {
  residentId: string
  residentName: string
  role: string
  poaEmail?: string | null
  poaPhone?: string | null
}) {
  const { toast } = useToast()
  const { confirmSend, dialog } = useSendConfirm()
  const [takeOpen, setTakeOpen] = useState(false)
  const [state, setState] = useState<AutopayState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [sending, setSending] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [method, setMethod] = useState('salon_then_card')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/payments/autopay?residentId=${residentId}`)
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        setState(j.data)
        setEnabled(j.data.autopayEnabled)
        setMethod(j.data.autopayMethod ?? 'salon_then_card')
      }
    } finally {
      setLoading(false)
    }
  }, [residentId])

  useEffect(() => {
    void load()
  }, [load])

  if (!canSeeBilling(role)) return null
  if (loading || !state) return <div className="skeleton rounded-2xl h-32 w-full" />

  const hasCard = state.cards.length > 0
  const channel = poaEmail && poaPhone ? 'both' : poaEmail ? 'email' : 'sms'
  const recipient = poaEmail || poaPhone || 'the payor'

  async function saveAutopay() {
    setSaving(true)
    try {
      const res = await fetch('/api/payments/autopay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId, autopayEnabled: enabled, autopayMethod: method }),
      })
      if (res.ok) {
        toast.success('Auto-pay settings saved')
        void load()
      } else {
        toast.error('Could not save settings')
      }
    } finally {
      setSaving(false)
    }
  }

  async function collectNow() {
    if (!state) return
    const amountCents = state.outstandingCents
    if (amountCents <= 0) {
      toast.info('No balance to collect')
      return
    }
    setCollecting(true)
    try {
      // One key per collect attempt — a retried/double-fired request must not
      // double-charge the saved card (Stripe dedupes on the idempotency key).
      const idempotencyKey = crypto.randomUUID()
      const res = await fetch('/api/payments/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId, amountCents, method, idempotencyKey }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Could not collect')
        return
      }
      const r = j.data.result
      if (r.ok) {
        toast.success(`Collected ${dollars(r.collectedCents)}`)
      } else if (j.data.payLink?.sent) {
        toast.info(`Couldn't charge (${r.reason}). Sent a payment link instead.`)
      } else {
        toast.error(`Couldn't collect: ${r.reason}`)
      }
      void load()
    } finally {
      setCollecting(false)
    }
  }

  async function sendLink() {
    if (!(await confirmSend({
      channel,
      recipient,
      summary: `Payment request for ${dollars(state?.outstandingCents ?? 0)} owed.`,
    }))) return
    setSending(true)
    try {
      const res = await fetch('/api/payments/request-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.data?.sent) toast.success('Payment link sent')
      else toast.error(j.data?.reason || j.error || 'Could not send link')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-2 mb-3">
        <Zap size={16} className="text-[#8B2E4A]" />
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Automatic payment</p>
      </div>

      <div className="flex items-center gap-4 text-sm mb-4">
        <div>
          <p className="text-[11px] text-stone-400 uppercase tracking-wide">Balance</p>
          <p className="font-semibold text-stone-900">{dollars(state.outstandingCents)}</p>
        </div>
        {state.availableCreditCents > 0 && (
          <div>
            <p className="text-[11px] text-stone-400 uppercase tracking-wide">Salon account</p>
            <p className="font-semibold text-emerald-700">{dollars(state.availableCreditCents)}</p>
          </div>
        )}
        <div>
          <p className="text-[11px] text-stone-400 uppercase tracking-wide">Card</p>
          <p className="font-semibold text-stone-900">
            {hasCard ? `${state.cards.find((c) => c.isDefault)?.brand ?? 'Card'} ••${state.cards.find((c) => c.isDefault)?.last4 ?? ''}` : 'None'}
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="accent-[#8B2E4A] w-4 h-4"
        />
        <span className="text-stone-800">Automatically collect for this resident</span>
      </label>

      <div className="flex items-center gap-2 mb-4">
        <label className="text-xs text-stone-500">Method</label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="text-sm border border-stone-200 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50"
        >
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <Button size="sm" variant="secondary" onClick={saveAutopay} loading={saving}>Save</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-stone-100">
        <Button size="sm" onClick={collectNow} loading={collecting} disabled={state.outstandingCents <= 0}>
          Collect now
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setTakeOpen(true)}>
          Take card payment
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={sendLink}
          loading={sending}
          disabled={(!poaEmail && !poaPhone) || state.outstandingCents <= 0}
        >
          Send payment link
        </Button>
      </div>
      {dialog}
      <TakePaymentModal
        open={takeOpen}
        onClose={() => setTakeOpen(false)}
        residentId={residentId}
        residentName={residentName}
        defaultAmountCents={state.outstandingCents > 0 ? state.outstandingCents : 0}
        onPaid={load}
      />
    </div>
  )
}
