'use client'

import { useState } from 'react'
import {
  BillingFacility,
  BillingInvoice,
  BillingResident,
  DisabledActionButton,
  SendDedupModal,
  computeResidentTotals,
  formatDollars,
  formatInvoiceDate,
  formatSentVia,
  formatShortDate,
} from './billing-shared'
import { ExpandableSection } from './expandable-section'

export function IPView({
  facility,
  residents,
  invoices,
  onRefresh,
  title = 'Residents',
  defaultOpen = true,
}: {
  facility: BillingFacility
  residents: BillingResident[]
  invoices: BillingInvoice[]
  onRefresh: () => void
  title?: string
  defaultOpen?: boolean
}) {
  const [sendAllLoading, setSendAllLoading] = useState(false)
  const [rowSending, setRowSending] = useState<Record<string, boolean>>({})
  const [rowWarning, setRowWarning] = useState<{
    residentId: string
    poaEmail: string
    lastSentAt: string
  } | null>(null)

  const eligibleCount = residents.filter(
    (r) => r.poaEmail && (r.qbOutstandingBalanceCents ?? 0) > 0
  ).length

  async function handleSendAll() {
    if (
      !confirm(
        `Send billing reminders to ${eligibleCount} resident${eligibleCount === 1 ? '' : 's'} with outstanding balances?`
      )
    )
      return
    setSendAllLoading(true)
    try {
      const res = await fetch(
        `/api/billing/send-statement/facility/${facility.id}/all-residents`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true }),
        }
      )
      const body = await res.json()
      if (!res.ok) {
        alert(body?.error ?? 'Failed to send')
        return
      }
      const { sent, skipped } = body.data ?? {}
      alert(
        `Sent ${sent ?? 0} reminder${(sent ?? 0) === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}.`
      )
      onRefresh()
    } catch {
      alert('Network error — please try again.')
    } finally {
      setSendAllLoading(false)
    }
  }

  async function handleResidentSend(residentId: string, poaEmail: string, force = false) {
    setRowSending((prev) => ({ ...prev, [residentId]: true }))
    setRowWarning(null)
    try {
      const res = await fetch(`/api/billing/send-statement/resident/${residentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: poaEmail, force }),
      })
      const body = await res.json()
      if (body.warning) {
        setRowWarning({ residentId, poaEmail, lastSentAt: body.lastSentAt })
        return
      }
      if (!res.ok) {
        alert(body?.error ?? 'Failed to send')
        return
      }
      onRefresh()
    } catch {
      alert('Network error — please try again.')
    } finally {
      setRowSending((prev) => ({ ...prev, [residentId]: false }))
    }
  }

  const residentWord = residents.length === 1 ? 'resident' : 'residents'
  const meta =
    residents.length === 0
      ? 'No residents yet'
      : `${residents.length} ${residentWord}${eligibleCount > 0 ? ` · ${eligibleCount} with balance` : ''}`

  return (
    <>
      {rowWarning && (
        <SendDedupModal
          lastSentAt={rowWarning.lastSentAt}
          onConfirm={() => {
            const { residentId, poaEmail } = rowWarning
            setRowWarning(null)
            handleResidentSend(residentId, poaEmail, true)
          }}
          onCancel={() => setRowWarning(null)}
        />
      )}

      <ExpandableSection title={title} meta={meta} defaultOpen={defaultOpen}>
        {residents.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-stone-500">
            No residents set up for this facility yet.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-end gap-2 px-5 py-2.5 bg-stone-50 border-b border-stone-100">
              {eligibleCount > 0 ? (
                <button
                  type="button"
                  disabled={sendAllLoading}
                  onClick={handleSendAll}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold bg-[#8B2E4A] text-white hover:bg-[#72253C] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 ease-out active:scale-[0.97]"
                >
                  {sendAllLoading ? 'Sending…' : `Send All (${eligibleCount})`}
                </button>
              ) : null}
              <DisabledActionButton
                label="Send via QB"
                title="Available after QB production approval"
              />
            </div>

            <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-stone-100 bg-stone-50">
              <div className="col-span-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Resident
              </div>
              <div className="col-span-1 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Room
              </div>
              <div className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Last Service
              </div>
              <div className="col-span-1 text-xs font-semibold text-stone-500 uppercase tracking-wide text-right">
                Billed
              </div>
              <div className="col-span-1 text-xs font-semibold text-stone-500 uppercase tracking-wide text-right">
                Paid
              </div>
              <div className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide text-right">
                Outstanding
              </div>
              <div className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide text-right">
                Last Sent
              </div>
            </div>

            {residents.map((r) => {
              const t = computeResidentTotals(r, invoices)
              const outstandingClass =
                t.outstandingCents > 0
                  ? 'text-sm font-semibold text-amber-700 text-right'
                  : 'text-sm text-stone-500 text-right'
              const isSending = rowSending[r.id] ?? false
              const canSend = !!r.poaEmail

              return (
                <div
                  key={r.id}
                  className="md:grid md:grid-cols-12 md:gap-4 md:items-center flex flex-col gap-1.5 px-5 py-3.5 border-b border-stone-50 last:border-0"
                >
                  <div className="md:col-span-3 text-sm font-medium text-stone-900">
                    {r.name}
                  </div>
                  <div className="md:col-span-1 text-sm text-stone-500">
                    {r.roomNumber ?? '—'}
                  </div>
                  <div className="md:col-span-2 text-sm text-stone-500">
                    {formatInvoiceDate(t.lastServiceDate)}
                  </div>
                  <div className="md:col-span-1 text-sm font-semibold text-stone-700 md:text-right">
                    {formatDollars(t.billedCents)}
                  </div>
                  <div className="md:col-span-1 text-sm text-stone-600 md:text-right">
                    {formatDollars(t.paidCents)}
                  </div>
                  <div className={outstandingClass}>{formatDollars(t.outstandingCents)}</div>
                  <div className="md:col-span-2 md:text-right flex md:justify-end items-center gap-2">
                    <div className="text-xs text-stone-500">
                      {t.lastSentAt ? (
                        <>
                          {formatShortDate(t.lastSentAt.slice(0, 10))}{' '}
                          <span className="text-stone-400">
                            · {formatSentVia(t.lastSentVia)}
                          </span>
                        </>
                      ) : (
                        <span className="text-stone-400">— never</span>
                      )}
                    </div>
                    {canSend ? (
                      <button
                        type="button"
                        disabled={isSending}
                        onClick={() => handleResidentSend(r.id, r.poaEmail!, false)}
                        className="inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-semibold bg-[#8B2E4A] text-white hover:bg-[#72253C] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 ease-out active:scale-[0.97]"
                      >
                        {isSending ? '…' : t.lastSentAt ? 'Resend' : 'Send'}
                      </button>
                    ) : (
                      <span className="text-xs text-stone-300" title="No POA email on file">
                        —
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </ExpandableSection>
    </>
  )
}
