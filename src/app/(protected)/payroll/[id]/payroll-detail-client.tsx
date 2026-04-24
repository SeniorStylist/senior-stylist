'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { computeNetPay } from '@/lib/payroll'

interface DetailStylist {
  id: string
  name: string
  stylistCode: string
  color: string
}

interface DetailDeduction {
  id: string
  payItemId: string
  deductionType: string
  amountCents: number
  note: string | null
  createdAt: string
}

interface DetailItem {
  id: string
  payPeriodId: string
  stylistId: string
  facilityId: string
  payType: string
  grossRevenueCents: number
  commissionRate: number
  commissionAmountCents: number
  hoursWorked: string | null
  hourlyRateCents: number | null
  flatAmountCents: number | null
  netPayCents: number
  notes: string | null
  qbBillId: string | null
  qbBillSyncToken: string | null
  qbSyncError: string | null
  stylist: DetailStylist
  deductions: DetailDeduction[]
}

interface DetailPeriod {
  id: string
  facilityId: string
  periodType: string
  startDate: string
  endDate: string
  status: string
  notes: string | null
  qbSyncedAt: string | null
  qbSyncError: string | null
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-teal-50 text-teal-700' },
  processing: { label: 'Processing', className: 'bg-amber-50 text-amber-700' },
  paid: { label: 'Paid', className: 'bg-emerald-50 text-emerald-700' },
}

const DEDUCTION_LABEL: Record<string, string> = {
  cash_kept: 'Cash Kept',
  supplies: 'Supplies',
  advance: 'Advance',
  other: 'Other',
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`)
  const e = new Date(`${end}T00:00:00`)
  const sameYear = s.getFullYear() === e.getFullYear()
  const left = format(s, sameYear ? 'MMM d' : 'MMM d, yyyy')
  const right = format(e, 'MMM d, yyyy')
  return `${left} – ${right}`
}

export function PayrollDetailClient({
  period,
  initialItems,
  hasQuickBooks,
  hasExpenseAccount,
}: {
  period: DetailPeriod
  initialItems: DetailItem[]
  hasQuickBooks: boolean
  hasExpenseAccount: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [currentStatus, setCurrentStatus] = useState(period.status)
  const [items, setItems] = useState<DetailItem[]>(initialItems)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [savingItemId, setSavingItemId] = useState<string | null>(null)
  const [confirmPaid, setConfirmPaid] = useState(false)
  const [advancingStatus, setAdvancingStatus] = useState(false)
  const [addingDeductionForId, setAddingDeductionForId] = useState<string | null>(null)
  const [qbSyncedAt, setQbSyncedAt] = useState<string | null>(period.qbSyncedAt)
  const [qbPushing, setQbPushing] = useState(false)
  const [qbStatusPolling, setQbStatusPolling] = useState(false)
  const [qbToast, setQbToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const showQbToast = (kind: 'ok' | 'err', text: string) => {
    setQbToast({ kind, text })
    setTimeout(() => setQbToast(null), 5000)
  }

  const anySynced = items.some((it) => it.qbBillId)
  const anyQbError = items.some((it) => it.qbSyncError)

  const handlePushToQb = async () => {
    if (qbPushing) return
    setQbPushing(true)
    try {
      const res = await fetch(`/api/quickbooks/sync-bill/${period.id}`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) {
        showQbToast('err', typeof j.error === 'string' ? j.error : 'Push failed')
        return
      }
      const { synced, failed } = j.data
      if (failed > 0) {
        showQbToast('err', `Pushed ${synced}, ${failed} failed — see details below`)
      } else {
        showQbToast('ok', `Pushed ${synced} Bill(s) to QuickBooks`)
      }
      setQbSyncedAt(new Date().toISOString())
      router.refresh()
    } finally {
      setQbPushing(false)
    }
  }

  const handleSyncStatus = async () => {
    if (qbStatusPolling) return
    setQbStatusPolling(true)
    try {
      const res = await fetch(`/api/quickbooks/sync-status/${period.id}`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) {
        showQbToast('err', typeof j.error === 'string' ? j.error : 'Status sync failed')
        return
      }
      if (j.data.periodUpdated) {
        showQbToast('ok', 'All Bills paid in QBO — period marked paid')
        setCurrentStatus('paid')
      } else {
        const outstanding = (j.data.items as Array<{ qbBalance: number }>).reduce(
          (s, i) => s + i.qbBalance,
          0,
        )
        showQbToast('ok', `QBO checked — outstanding balance $${outstanding.toFixed(2)}`)
      }
    } finally {
      setQbStatusPolling(false)
    }
  }

  const isPaid = currentStatus === 'paid'
  const totalNet = useMemo(() => items.reduce((s, it) => s + it.netPayCents, 0), [items])

  const advanceStatus = async (target: 'processing' | 'paid') => {
    if (advancingStatus) return
    if (target === 'paid' && !confirmPaid) {
      setConfirmPaid(true)
      setTimeout(() => setConfirmPaid(false), 5000)
      return
    }
    setAdvancingStatus(true)
    try {
      const res = await fetch(`/api/pay-periods/${period.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: target }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        toast.error(typeof j.error === 'string' ? j.error : 'Failed to update status')
        return
      }
      setCurrentStatus(target)
      setConfirmPaid(false)
      if (target === 'paid') {
        setExpandedId(null)
        setAddingDeductionForId(null)
      }
    } finally {
      setAdvancingStatus(false)
    }
  }

  const updateItemLocal = (itemId: string, patch: Partial<DetailItem>) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it)))
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="mb-4">
        <Link href="/payroll" className="text-xs text-stone-500 hover:text-stone-700">
          ← Payroll
        </Link>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-serif text-stone-900">
              {formatRange(period.startDate, period.endDate)}
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                (STATUS_BADGE[currentStatus] ?? STATUS_BADGE.open).className
              }`}
            >
              {(STATUS_BADGE[currentStatus] ?? STATUS_BADGE.open).label}
            </span>
          </div>
          <p className="text-sm text-stone-500 mt-1">
            {items.length} {items.length === 1 ? 'stylist' : 'stylists'} ·{' '}
            <span className="font-semibold text-stone-900">{formatDollars(totalNet)}</span> net
            payout
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`/api/pay-periods/${period.id}/export`}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold bg-stone-100 text-stone-800 hover:bg-stone-200 transition-all duration-150"
          >
            Export CSV
          </a>
          {currentStatus === 'open' && (
            <Button onClick={() => advanceStatus('processing')} loading={advancingStatus}>
              Mark Processing
            </Button>
          )}
          {currentStatus === 'processing' && (
            <Button
              onClick={() => advanceStatus('paid')}
              loading={advancingStatus}
              className={confirmPaid ? 'bg-red-600 hover:bg-red-700' : undefined}
            >
              {confirmPaid ? 'Click again to confirm' : 'Mark Paid'}
            </Button>
          )}
        </div>
      </div>

      {isPaid && (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 mb-4 text-sm text-emerald-800">
          This pay period is marked as paid and locked — no further edits allowed.
        </div>
      )}

      {hasQuickBooks && currentStatus !== 'open' && (
        <div className="rounded-2xl border border-stone-200 bg-white p-4 md:p-5 mb-4">
          {qbToast && (
            <div
              className={`mb-3 px-3 py-2 rounded-xl text-sm font-medium ${
                qbToast.kind === 'ok'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}
            >
              {qbToast.text}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-800">QuickBooks Online</h3>
              {qbSyncedAt ? (
                <p className="text-xs text-stone-500 mt-0.5">
                  Last synced {format(new Date(qbSyncedAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
              ) : (
                <p className="text-xs text-stone-500 mt-0.5">
                  Not yet pushed to QuickBooks.
                </p>
              )}
              {!hasExpenseAccount && (
                <p className="text-xs text-red-600 mt-1">
                  Select a QuickBooks expense account in Settings → Integrations before pushing.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {!anySynced ? (
                <button
                  onClick={handlePushToQb}
                  disabled={qbPushing || !hasExpenseAccount}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                  style={{ backgroundColor: '#8B2E4A' }}
                >
                  {qbPushing ? 'Pushing…' : 'Push to QuickBooks'}
                </button>
              ) : (
                <>
                  <button
                    onClick={handleSyncStatus}
                    disabled={qbStatusPolling}
                    className="px-4 py-2 rounded-xl text-sm font-semibold border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 transition-all disabled:opacity-50"
                  >
                    {qbStatusPolling ? 'Checking…' : 'Sync Payment Status'}
                  </button>
                  <button
                    onClick={handlePushToQb}
                    disabled={qbPushing || !hasExpenseAccount}
                    className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                    style={{ backgroundColor: '#8B2E4A' }}
                  >
                    {qbPushing ? 'Re-pushing…' : anyQbError ? 'Retry Sync' : 'Re-push'}
                  </button>
                </>
              )}
            </div>
          </div>
          {anyQbError && (
            <div className="mt-3 rounded-xl bg-red-50 border border-red-200 p-3">
              <p className="text-xs font-semibold text-red-700 mb-1">Sync errors</p>
              <ul className="text-xs text-red-700 space-y-0.5">
                {items
                  .filter((it) => it.qbSyncError)
                  .map((it) => (
                    <li key={it.id}>
                      <span className="font-medium">{it.stylist.name}:</span> {it.qbSyncError}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="rounded-[18px] border border-stone-200 bg-white overflow-hidden shadow-[var(--shadow-sm)]">
        <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_0.7fr_1fr_1fr_1fr_32px] gap-4 px-5 py-3 border-b border-stone-200 bg-stone-50/60 text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
          <div>Stylist</div>
          <div>Pay Type</div>
          <div>Gross Revenue</div>
          <div>Rate</div>
          <div>Base</div>
          <div>Deductions</div>
          <div>Net Pay</div>
          <div />
        </div>

        {items.map((item) => {
          const expanded = expandedId === item.id
          const deductionsTotal = item.deductions.reduce((s, d) => s + d.amountCents, 0)
          const basePay =
            item.payType === 'commission'
              ? item.commissionAmountCents
              : item.payType === 'hourly'
                ? Math.round(parseFloat(item.hoursWorked ?? '0') * (item.hourlyRateCents ?? 0))
                : (item.flatAmountCents ?? 0)

          return (
            <div key={item.id} className="border-b border-stone-100 last:border-b-0">
              <button
                onClick={() => {
                  if (isPaid) return
                  setExpandedId((id) => (id === item.id ? null : item.id))
                }}
                disabled={isPaid}
                className="group w-full text-left md:grid md:grid-cols-[2fr_1fr_1fr_0.7fr_1fr_1fr_1fr_32px] md:gap-4 flex flex-col gap-1.5 px-5 py-3.5 hover:bg-[#F9EFF2] transition-colors duration-[120ms] ease-out disabled:cursor-default disabled:hover:bg-transparent"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: item.stylist.color }}
                  />
                  <span className="text-sm font-medium text-stone-900">{item.stylist.name}</span>
                  <span className="text-[11px] text-stone-400">{item.stylist.stylistCode}</span>
                </div>
                <div className="text-sm text-stone-600 capitalize">{item.payType}</div>
                <div className="text-sm text-stone-600">{formatDollars(item.grossRevenueCents)}</div>
                <div className="text-sm text-stone-600">{item.commissionRate}%</div>
                <div className="text-sm text-stone-600">{formatDollars(basePay)}</div>
                <div className="text-sm text-stone-600">{formatDollars(deductionsTotal)}</div>
                <div className="text-sm font-semibold text-stone-900">
                  {formatDollars(item.netPayCents)}
                </div>
                <div className="hidden md:flex items-center justify-end text-stone-400">
                  {!isPaid && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={expanded ? 'rotate-90 transition-transform' : 'transition-transform'}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  )}
                </div>
              </button>

              {expanded && !isPaid && (
                <ItemEditor
                  item={item}
                  saving={savingItemId === item.id}
                  addingDeduction={addingDeductionForId === item.id}
                  onOpenAddDeduction={() => setAddingDeductionForId(item.id)}
                  onCloseAddDeduction={() => setAddingDeductionForId(null)}
                  onSave={async (patch) => {
                    setSavingItemId(item.id)
                    try {
                      const res = await fetch(
                        `/api/pay-periods/${period.id}/items/${item.id}`,
                        {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(patch),
                        },
                      )
                      const json = await res.json()
                      if (!res.ok) {
                        toast.error(typeof json.error === 'string' ? json.error : 'Failed to save')
                        return
                      }
                      const updated = json.data.item
                      updateItemLocal(item.id, {
                        payType: updated.payType,
                        hoursWorked: updated.hoursWorked,
                        hourlyRateCents: updated.hourlyRateCents,
                        flatAmountCents: updated.flatAmountCents,
                        netPayCents: updated.netPayCents,
                        notes: updated.notes,
                      })
                      setExpandedId(null)
                    } finally {
                      setSavingItemId(null)
                    }
                  }}
                  onAddDeduction={async (payload) => {
                    const res = await fetch(
                      `/api/pay-periods/${period.id}/items/${item.id}/deductions`,
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      },
                    )
                    const json = await res.json()
                    if (!res.ok) {
                      toast.error(typeof json.error === 'string' ? json.error : 'Failed to add deduction')
                      return false
                    }
                    updateItemLocal(item.id, {
                      deductions: [...item.deductions, json.data.deduction],
                      netPayCents: json.data.item.netPayCents,
                    })
                    return true
                  }}
                  onDeleteDeduction={async (dedId) => {
                    const res = await fetch(
                      `/api/pay-periods/${period.id}/items/${item.id}/deductions/${dedId}`,
                      { method: 'DELETE' },
                    )
                    const json = await res.json()
                    if (!res.ok) {
                      toast.error(typeof json.error === 'string' ? json.error : 'Failed to delete')
                      return
                    }
                    updateItemLocal(item.id, {
                      deductions: item.deductions.filter((d) => d.id !== dedId),
                      netPayCents: json.data.item.netPayCents,
                    })
                  }}
                />
              )}
            </div>
          )
        })}

        {items.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-stone-500">
            No stylists assigned to this period.
          </div>
        )}
      </div>
    </div>
  )
}

function ItemEditor({
  item,
  saving,
  addingDeduction,
  onOpenAddDeduction,
  onCloseAddDeduction,
  onSave,
  onAddDeduction,
  onDeleteDeduction,
}: {
  item: DetailItem
  saving: boolean
  addingDeduction: boolean
  onOpenAddDeduction: () => void
  onCloseAddDeduction: () => void
  onSave: (patch: {
    payType?: string
    hoursWorked?: number
    hourlyRateCents?: number | null
    flatAmountCents?: number | null
    notes?: string | null
  }) => Promise<void>
  onAddDeduction: (payload: {
    deductionType: string
    amountCents: number
    note?: string
  }) => Promise<boolean>
  onDeleteDeduction: (dedId: string) => Promise<void>
}) {
  const [payType, setPayType] = useState<string>(item.payType)
  const [hoursWorked, setHoursWorked] = useState<string>(item.hoursWorked ?? '')
  const [hourlyRateDollars, setHourlyRateDollars] = useState<string>(
    item.hourlyRateCents != null ? (item.hourlyRateCents / 100).toFixed(2) : '',
  )
  const [flatDollars, setFlatDollars] = useState<string>(
    item.flatAmountCents != null ? (item.flatAmountCents / 100).toFixed(2) : '',
  )
  const [notes, setNotes] = useState<string>(item.notes ?? '')

  const [dedType, setDedType] = useState<string>('cash_kept')
  const [dedAmount, setDedAmount] = useState<string>('')
  const [dedNote, setDedNote] = useState<string>('')
  const [addingNow, setAddingNow] = useState(false)

  const previewBase = useMemo(() => {
    return computeNetPay(
      {
        payType,
        commissionAmountCents: item.commissionAmountCents,
        hoursWorked: hoursWorked || null,
        hourlyRateCents: hourlyRateDollars ? Math.round(parseFloat(hourlyRateDollars) * 100) : null,
        flatAmountCents: flatDollars ? Math.round(parseFloat(flatDollars) * 100) : null,
      },
      item.deductions,
    )
  }, [
    payType,
    hoursWorked,
    hourlyRateDollars,
    flatDollars,
    item.commissionAmountCents,
    item.deductions,
  ])

  const handleSave = async () => {
    const patch: Parameters<typeof onSave>[0] = { payType, notes: notes || null }
    if (payType === 'hourly') {
      patch.hoursWorked = hoursWorked ? parseFloat(hoursWorked) : 0
      patch.hourlyRateCents = hourlyRateDollars ? Math.round(parseFloat(hourlyRateDollars) * 100) : 0
      patch.flatAmountCents = null
    } else if (payType === 'flat') {
      patch.flatAmountCents = flatDollars ? Math.round(parseFloat(flatDollars) * 100) : 0
      patch.hoursWorked = 0
      patch.hourlyRateCents = null
    } else {
      patch.hoursWorked = 0
      patch.hourlyRateCents = null
      patch.flatAmountCents = null
    }
    await onSave(patch)
  }

  const handleAddDeduction = async () => {
    if (addingNow) return
    const amountNum = parseFloat(dedAmount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) return
    setAddingNow(true)
    const ok = await onAddDeduction({
      deductionType: dedType,
      amountCents: Math.round(amountNum * 100),
      note: dedNote.trim() || undefined,
    })
    setAddingNow(false)
    if (ok) {
      setDedAmount('')
      setDedNote('')
      setDedType('cash_kept')
      onCloseAddDeduction()
    }
  }

  return (
    <div className="bg-stone-50 px-5 py-4 border-t border-stone-100">
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
            Pay Calculation
          </div>
          <div className="flex flex-col gap-1.5 mb-3">
            <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
              Pay Type
            </label>
            <select
              value={payType}
              onChange={(e) => setPayType(e.target.value)}
              className="bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
            >
              <option value="commission">Commission</option>
              <option value="hourly">Hourly</option>
              <option value="flat">Flat</option>
            </select>
          </div>

          {payType === 'commission' && (
            <div className="text-sm text-stone-600 bg-white border border-stone-200 rounded-xl px-3 py-2">
              <div>Gross revenue: {formatDollars(item.grossRevenueCents)}</div>
              <div>Commission rate: {item.commissionRate}%</div>
              <div className="mt-1 font-semibold text-stone-900">
                Commission: {formatDollars(item.commissionAmountCents)}
              </div>
            </div>
          )}

          {payType === 'hourly' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                  Hours Worked
                </label>
                <input
                  type="number"
                  step="0.25"
                  min="0"
                  value={hoursWorked}
                  onChange={(e) => setHoursWorked(e.target.value)}
                  className="bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                  Hourly Rate ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={hourlyRateDollars}
                  onChange={(e) => setHourlyRateDollars(e.target.value)}
                  className="bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
                />
              </div>
            </div>
          )}

          {payType === 'flat' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                Flat Amount ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={flatDollars}
                onChange={(e) => setFlatDollars(e.target.value)}
                className="bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5 mt-3">
            <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              className="bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 resize-none"
            />
          </div>

          <div className="mt-3 px-3 py-2 bg-white border border-stone-200 rounded-xl flex items-center justify-between">
            <div className="text-xs text-stone-500">Preview net pay</div>
            <div className="text-sm font-semibold text-[#8B2E4A]">{formatDollars(previewBase)}</div>
          </div>

          <div className="mt-3 flex justify-end">
            <Button onClick={handleSave} loading={saving} size="sm">
              Save
            </Button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              Deductions
            </div>
            {!addingDeduction && (
              <button
                onClick={onOpenAddDeduction}
                className="text-xs font-semibold text-[#8B2E4A] hover:text-[#72253C]"
              >
                + Add Deduction
              </button>
            )}
          </div>

          <div className="space-y-2">
            {item.deductions.length === 0 && !addingDeduction && (
              <div className="text-xs text-stone-400 italic">No deductions for this stylist.</div>
            )}
            {item.deductions.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-2 bg-white border border-stone-200 rounded-xl px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 shrink-0">
                    {DEDUCTION_LABEL[d.deductionType] ?? d.deductionType}
                  </span>
                  <span className="text-sm text-stone-900 font-medium shrink-0">
                    {formatDollars(d.amountCents)}
                  </span>
                  {d.note && (
                    <span className="text-xs text-stone-500 truncate" title={d.note}>
                      {d.note}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => onDeleteDeduction(d.id)}
                  className="text-stone-400 hover:text-red-600 shrink-0"
                  aria-label="Delete deduction"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {addingDeduction && (
            <div className="mt-3 bg-white border border-stone-200 rounded-xl p-3 space-y-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                  Type
                </label>
                <select
                  value={dedType}
                  onChange={(e) => setDedType(e.target.value)}
                  className="bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
                >
                  <option value="cash_kept">Cash Kept</option>
                  <option value="supplies">Supplies</option>
                  <option value="advance">Advance</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                  Amount ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={dedAmount}
                  onChange={(e) => setDedAmount(e.target.value)}
                  className="bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                  Note (optional)
                </label>
                <input
                  type="text"
                  value={dedNote}
                  onChange={(e) => setDedNote(e.target.value)}
                  maxLength={500}
                  className="bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={onCloseAddDeduction}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleAddDeduction} loading={addingNow}>
                  Add
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
