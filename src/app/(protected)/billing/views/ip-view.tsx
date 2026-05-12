'use client'

import { useMemo, useState } from 'react'
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
import { transitionBase } from '@/lib/animations'
import { useToast } from '@/components/ui/toast'
import { Avatar } from '@/components/ui/avatar'
import { openPeek } from '@/lib/peek-drawer'

type SortKey = 'name' | 'room' | 'lastService' | 'billed' | 'outstanding'
type SortDir = 'asc' | 'desc'

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
  const { toast } = useToast()
  const [sendAllLoading, setSendAllLoading] = useState(false)
  const [rowSending, setRowSending] = useState<Record<string, boolean>>({})
  const [rowWarning, setRowWarning] = useState<{
    residentId: string
    poaEmail: string
    lastSentAt: string
  } | null>(null)

  const [sortKey, setSortKey] = useState<SortKey>('outstanding')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const eligibleCount = residents.filter(
    (r) => r.poaEmail && (r.qbOutstandingBalanceCents ?? 0) > 0
  ).length

  const sortedRows = useMemo(() => {
    const rows = residents.map((r) => ({ r, t: computeResidentTotals(r, invoices) }))
    const cmp = (a: (typeof rows)[0], b: (typeof rows)[0]): number => {
      let x: string | number | null
      let y: string | number | null
      switch (sortKey) {
        case 'name':
          x = a.r.name
          y = b.r.name
          break
        case 'room':
          x = a.r.roomNumber
          y = b.r.roomNumber
          break
        case 'lastService':
          x = a.t.lastServiceDate
          y = b.t.lastServiceDate
          break
        case 'billed':
          x = a.t.billedCents
          y = b.t.billedCents
          break
        case 'outstanding':
          x = a.t.outstandingCents
          y = b.t.outstandingCents
          break
      }
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      const dir = sortDir === 'asc' ? 1 : -1
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return (
        String(x).localeCompare(String(y), undefined, { numeric: sortKey === 'room' }) * dir
      )
    }
    return rows.sort(cmp)
  }, [residents, invoices, sortKey, sortDir])

  function handleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir('desc')
    }
  }

  function SortHeader({
    label,
    k,
    align = 'left',
  }: {
    label: string
    k: SortKey
    align?: 'left' | 'right'
  }) {
    const isActive = sortKey === k
    const arrow = !isActive ? '↕' : sortDir === 'asc' ? '↑' : '↓'
    return (
      <button
        type="button"
        onClick={() => handleSort(k)}
        className={`${transitionBase} text-xs font-semibold text-stone-500 uppercase tracking-wide inline-flex items-center gap-1 hover:text-stone-700 ${
          align === 'right' ? 'justify-end w-full' : ''
        }`}
      >
        {label}
        <span className={isActive ? 'text-stone-700' : 'text-stone-300'}>{arrow}</span>
      </button>
    )
  }

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
        toast.error(body?.error ?? 'Failed to send')
        return
      }
      const { sent, skipped } = body.data ?? {}
      toast.success(
        `Sent ${sent ?? 0} reminder${(sent ?? 0) === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}.`
      )
      onRefresh()
    } catch {
      toast.error('Network error — please try again.')
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
        toast.error(body?.error ?? 'Failed to send')
        return
      }
      onRefresh()
    } catch {
      toast.error('Network error — please try again.')
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
          <div data-tour="billing-invoice-list">
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

            <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-stone-200 bg-stone-50/60">
              <div className="col-span-3">
                <SortHeader label="Resident" k="name" />
              </div>
              <div className="col-span-1">
                <SortHeader label="Room" k="room" />
              </div>
              <div className="col-span-2">
                <SortHeader label="Last Service" k="lastService" />
              </div>
              <div className="col-span-1 text-right">
                <SortHeader label="Billed" k="billed" align="right" />
              </div>
              <div className="col-span-1 text-[11px] font-semibold text-stone-400 uppercase tracking-wide text-right">
                Paid
              </div>
              <div className="col-span-2 text-right">
                <SortHeader label="Outstanding" k="outstanding" align="right" />
              </div>
              <div className="col-span-2 text-[11px] font-semibold text-stone-400 uppercase tracking-wide text-right">
                Last Sent
              </div>
            </div>

            {sortedRows.map(({ r, t }) => {
              const outstandingClass =
                t.outstandingCents > 0
                  ? 'text-sm font-semibold text-amber-700 text-right balance-attention'
                  : 'text-sm text-stone-500 text-right'
              const isSending = rowSending[r.id] ?? false
              const canSend = !!r.poaEmail

              const rowTintClass = t.outstandingCents > 0
                ? 'bg-amber-50/40 hover:bg-amber-50/70'
                : 'hover:bg-[#F9EFF2]'
              return (
                <div
                  key={r.id}
                  className={`group md:grid md:grid-cols-12 md:gap-4 md:items-center flex flex-col gap-1.5 px-5 py-3.5 border-b border-stone-50 last:border-0 transition-colors duration-[120ms] ease-out ${rowTintClass}`}
                >
                  <div className="md:col-span-3 flex items-center gap-3 min-w-0">
                    <Avatar name={r.name} size="md" />
                    <button
                      type="button"
                      onClick={() => openPeek({ type: 'resident', id: r.id })}
                      className="text-left min-w-0 hover:underline hover:text-[#8B2E4A] transition-colors"
                    >
                      <span className="text-[13.5px] font-semibold text-stone-900 leading-snug truncate block">
                        {r.name}
                      </span>
                    </button>
                  </div>
                  <div className="md:col-span-1 text-[11.5px] text-stone-500 leading-snug">
                    {r.roomNumber ?? '—'}
                  </div>
                  <div className="md:col-span-2 text-[11.5px] text-stone-500 leading-snug">
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
          </div>
        )}
      </ExpandableSection>
    </>
  )
}
