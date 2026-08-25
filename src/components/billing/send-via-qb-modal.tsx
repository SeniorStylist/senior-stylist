'use client'

// "Send via QB" — creates real QuickBooks invoices from a month's completed,
// unpaid, not-yet-invoiced bookings (one per resident, or one facility-level
// invoice for facility-billed accounts), optionally emailed by QuickBooks.
// Shared by ip-view (per_resident) and billing-client (facility).

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { useSendConfirm } from '@/components/ui/send-confirm-dialog'
import { formatDollars } from '@/lib/format'

interface PushedInvoice {
  residentId: string | null
  residentName: string | null
  qbInvoiceId: string
  docNumber: string | null
  bookings: number
  amountCents: number
  emailed: boolean
  error?: string
}

interface PushResult {
  invoices: PushedInvoice[]
  totalCents: number
  skippedNoEmail: number
  nothingToBill: boolean
  errors: string[]
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function SendViaQbModal({
  open,
  onClose,
  facilityId,
  mode,
  facilityName,
  onDone,
}: {
  open: boolean
  onClose: () => void
  facilityId: string
  mode: 'per_resident' | 'facility'
  facilityName: string
  onDone: () => void
}) {
  const { toast } = useToast()
  const { confirmSend, dialog: sendConfirmDialog } = useSendConfirm()
  const [month, setMonth] = useState(currentMonth())
  const [sendEmail, setSendEmail] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<PushResult | null>(null)

  async function handlePush() {
    if (running) return
    if (sendEmail) {
      const ok = await confirmSend({
        channel: 'email',
        recipient:
          mode === 'facility'
            ? `${facilityName} (billing contact)`
            : 'each resident’s family email on file',
        summary: `QuickBooks will email the ${month} invoice${mode === 'per_resident' ? 's' : ''}`,
      })
      if (!ok) return
    }
    setRunning(true)
    setResult(null)
    try {
      const res = await fetch('/api/quickbooks/push-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId, month, mode, send: sendEmail }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error ?? 'Send via QB failed')
        return
      }
      const data = j.data as PushResult
      setResult(data)
      if (data.nothingToBill) {
        toast.info('Nothing to bill — no completed, unpaid appointments in that month that aren’t already invoiced.')
      } else if (data.errors.length > 0) {
        toast.error(
          `${data.invoices.length} invoice(s) created, ${data.errors.length} problem(s): ${data.errors[0]}`,
        )
      } else {
        const emailedCount = data.invoices.filter((i) => i.emailed).length
        toast.success(
          `${data.invoices.length} QuickBooks invoice(s) created — ${formatDollars(data.totalCents)}${
            sendEmail ? ` · ${emailedCount} emailed` : ''
          }`,
        )
      }
      onDone()
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setRunning(false)
    }
  }

  function handleClose() {
    if (running) return
    setResult(null)
    onClose()
  }

  return (
    <>
      {sendConfirmDialog}
      <Modal open={open} onClose={handleClose} title="Send via QuickBooks">
        <div className="space-y-4">
          <p className="text-sm text-stone-600">
            {mode === 'per_resident'
              ? 'Creates one QuickBooks invoice per resident from that month’s completed, unpaid appointments that aren’t already on an invoice.'
              : `Creates one facility-level QuickBooks invoice for ${facilityName} from that month’s completed, unpaid appointments that aren’t already on an invoice.`}
          </p>

          <label className="block">
            <span className="block text-xs font-semibold text-stone-600 mb-1.5">Month</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50"
            />
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="mt-0.5 accent-[#8B2E4A]"
            />
            <span className="text-sm text-stone-700">
              Email the invoice{mode === 'per_resident' ? 's' : ''} from QuickBooks
              <span className="block text-xs text-stone-400 mt-0.5">
                {mode === 'per_resident'
                  ? 'Sent to each resident’s family email on file — residents without one are skipped.'
                  : 'Sent to the facility’s billing contact email.'}
              </span>
            </span>
          </label>

          {result && !result.nothingToBill && (
            <div className="rounded-xl border border-stone-100 bg-stone-50 p-3 max-h-48 overflow-y-auto space-y-1">
              {result.invoices.map((inv) => (
                <div key={inv.qbInvoiceId} className="flex items-center justify-between text-xs">
                  <span className="text-stone-600 truncate">
                    {inv.residentName ?? facilityName}
                    {inv.docNumber ? ` · #${inv.docNumber}` : ''}
                    {inv.emailed ? ' · ✉ sent' : ''}
                  </span>
                  <span className="font-semibold text-stone-700 shrink-0 ml-2">
                    {formatDollars(inv.amountCents)}
                  </span>
                </div>
              ))}
              {result.errors.map((e, i) => (
                <div key={i} className="text-xs text-red-600">
                  {e}
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleClose}
              disabled={running}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              {result ? 'Done' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={handlePush}
              disabled={running || !/^\d{4}-\d{2}$/.test(month)}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#8B2E4A] hover:bg-[#72253C] disabled:opacity-50"
            >
              {running
                ? 'Creating invoices…'
                : sendEmail
                  ? 'Create & email'
                  : 'Create invoices'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
