'use client'

// P50 — "family handed me their card at the chair" vaulting modal. Opened from
// daily-log rows (the one card-management surface stylists can reach — they
// have no /residents/[id] access). Wraps the shared AddCardForm; the API's
// stylist branch scopes it to residents at facilities where the stylist works.
// Vaulting charges nothing — the card is stored by Stripe for future COF.
//
// P60 — the card can now also carry the family's autopay request. Before this,
// a card saved here NEVER enabled autopay: staff were told "we'll charge it
// automatically", the switch stayed off, and nothing ever charged.

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { AddCardForm } from './add-card-form'

export function AddCardModal({
  open,
  onClose,
  residentId,
  residentName,
}: {
  open: boolean
  onClose: () => void
  residentId: string
  residentName: string
}) {
  const [cardCount, setCardCount] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)
  // Default OFF — autopay is the family's decision, never a staff assumption.
  const [autopayRequested, setAutopayRequested] = useState(false)
  const [autopayOn, setAutopayOn] = useState(false)
  const [autopayNote, setAutopayNote] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setSaved(false)
      setCardCount(null)
      setAutopayRequested(false)
      setAutopayOn(false)
      setAutopayNote(null)
      return
    }
    let cancelled = false
    fetch(`/api/payments/methods?residentId=${residentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.data?.cards) setCardCount(j.data.cards.length)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, residentId])

  // Runs right after the card is vaulted. `consentAttested` is what lets a
  // staff/stylist actor flip autopay at all — the route drops the flag without
  // it — and it rides the SAME save request, so an attested card costs one
  // `paymentSetup` token rather than two. The server helper still emails/texts
  // the family the notice either way.
  function handleSaved(result?: { autopayEnabled?: boolean; autopayError?: string; autopayIdle?: boolean }) {
    setSaved(true)
    if (!autopayRequested) return
    if (result?.autopayEnabled) {
      setAutopayOn(true)
      // Per-resident autopay is on, but the facility still collects by hand —
      // saying "automatic payment is on" alone would recreate the very
      // everyone-thinks-it-is-on-and-nothing-charges gap this flow closes.
      if (result.autopayIdle) {
        setAutopayNote(
          'this facility still collects by hand — ask your admin to switch Settings → Billing to charge when a visit is completed.',
        )
      }
    } else {
      setAutopayNote(
        result?.autopayError ?? 'Automatic payment could not be turned on — set it on the resident’s page.',
      )
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Save a card — ${residentName}`}>
      <div className="space-y-3">
        {cardCount !== null && cardCount > 0 && !saved && (
          <p className="text-xs text-stone-500">
            {cardCount} card{cardCount === 1 ? '' : 's'} already on file — this adds another.
          </p>
        )}
        {saved ? (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-center">
            <p className="text-sm font-semibold text-emerald-800">Card saved ✓</p>
            <p className="text-xs text-emerald-700 mt-1">
              {autopayOn
                ? 'Automatic payment is on. The family gets an email or text confirming both. Nothing was charged.'
                : 'The family gets an email confirmation. Nothing was charged.'}
            </p>
            {autopayNote && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 text-left">
                Card saved, but {autopayNote}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-3 bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-2.5 hover:bg-[#72253C]"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-stone-500">
              The card goes straight into Stripe&apos;s secure form — it&apos;s never stored by the salon,
              and nothing is charged now.
            </p>

            <label className="flex items-start gap-2.5 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autopayRequested}
                onChange={(e) => setAutopayRequested(e.target.checked)}
                className="mt-0.5 accent-[#8B2E4A] w-4 h-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-stone-800">
                  The family asked us to keep this card on file for automatic payment
                </span>
                <span className="block text-[11px] text-stone-500 mt-0.5 leading-snug">
                  Only tick this if they said so. The family gets an email or text confirming
                  automatic payment is on.
                </span>
              </span>
            </label>

            <AddCardForm
              residentId={residentId}
              enableAutopay={autopayRequested}
              consentAttested={autopayRequested}
              onSaved={handleSaved}
              onCancel={onClose}
            />
          </>
        )}
      </div>
    </Modal>
  )
}
