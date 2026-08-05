'use client'

// P50 — "family handed me their card at the chair" vaulting modal. Opened from
// daily-log rows (the one card-management surface stylists can reach — they
// have no /residents/[id] access). Wraps the shared AddCardForm; the API's
// stylist branch scopes it to residents at facilities where the stylist works.
// Vaulting charges nothing — the card is stored by Stripe for future COF.

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

  useEffect(() => {
    if (!open) {
      setSaved(false)
      setCardCount(null)
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
              The family gets an email confirmation. Nothing was charged.
            </p>
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
            <AddCardForm residentId={residentId} onSaved={() => setSaved(true)} onCancel={onClose} />
          </>
        )}
      </div>
    </Modal>
  )
}
