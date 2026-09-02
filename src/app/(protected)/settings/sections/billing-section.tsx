'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { formatMoney } from '@/lib/format'
import type { PublicFacility } from '@/lib/sanitize'
import { HelpTip } from '@/components/ui/help-tip'

interface Props {
  facility: PublicFacility
  qbInvoiceSyncEnabled: boolean
}

export function BillingSection({ facility, qbInvoiceSyncEnabled }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // ─── QuickBooks ──────────────────────────────────────────────────────
  const hasQuickBooks = facility.hasQuickBooks
  const qbRealmId = (facility as { qbRealmId?: string | null }).qbRealmId ?? null
  const qbExpenseAccountIdInit =
    (facility as { qbExpenseAccountId?: string | null }).qbExpenseAccountId ?? ''
  const [qbExpenseAccountId, setQbExpenseAccountId] = useState(qbExpenseAccountIdInit)
  const [qbAccounts, setQbAccounts] = useState<
    Array<{ id: string; name: string; accountType: string; accountSubType: string | null }>
  >([])
  const [qbAccountsLoaded, setQbAccountsLoaded] = useState(false)
  const [qbSavingAccount, setQbSavingAccount] = useState(false)
  const [qbSyncing, setQbSyncing] = useState(false)
  const [qbCustomerSyncing, setQbCustomerSyncing] = useState(false)
  const [qbToast, setQbToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [qbConfirmDisconnect, setQbConfirmDisconnect] = useState(false)
  const [qbDisconnecting, setQbDisconnecting] = useState(false)
  // Sync history + undo (qb_sync_runs)
  type QbRun = {
    id: string
    action: string
    startedAt: string
    automated: boolean
    summary: Record<string, unknown>
    undoneAt: string | null
    undoSummary: Record<string, unknown> | null
  }
  const [qbRuns, setQbRuns] = useState<QbRun[]>([])
  const [qbRunsLoaded, setQbRunsLoaded] = useState(false)
  const [qbUndoConfirmId, setQbUndoConfirmId] = useState<string | null>(null)
  const [qbUndoingId, setQbUndoingId] = useState<string | null>(null)
  const [qbTesting, setQbTesting] = useState(false)
  const [qbTestResult, setQbTestResult] = useState<
    | { ok: true; companyName: string | null }
    | { ok: false; reason: string; message?: string }
    | null
  >(null)

  const qbInvoicesLastSyncedAt =
    (facility as { qbInvoicesLastSyncedAt?: string | null }).qbInvoicesLastSyncedAt ?? null
  const [qbInvoiceSyncing, setQbInvoiceSyncing] = useState(false)
  const [qbInvoiceConfirmFull, setQbInvoiceConfirmFull] = useState(false)

  function showQbToast(kind: 'ok' | 'err', text: string) {
    setQbToast({ kind, text })
    setTimeout(() => setQbToast(null), 4000)
  }

  async function loadQbAccounts() {
    setQbAccountsLoaded(false)
    try {
      const res = await fetch('/api/quickbooks/accounts')
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        showQbToast('err', j.error ?? 'Failed to load accounts')
        return
      }
      const j = await res.json()
      setQbAccounts(j.data?.accounts ?? [])
    } finally {
      setQbAccountsLoaded(true)
    }
  }

  async function handleSaveExpenseAccount() {
    setQbSavingAccount(true)
    try {
      const res = await fetch('/api/facility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qbExpenseAccountId: qbExpenseAccountId || null }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        showQbToast('err', j.error ?? 'Save failed')
        return
      }
      showQbToast('ok', 'Expense account saved')
      router.refresh()
    } finally {
      setQbSavingAccount(false)
    }
  }

  async function handleSyncVendors() {
    setQbSyncing(true)
    try {
      const res = await fetch('/api/quickbooks/sync-vendors', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) {
        showQbToast('err', j.error ?? 'Sync failed')
        return
      }
      const { created, updated, skipped, errors } = j.data
      const bits = [`${created} created`, `${updated} updated`, `${skipped} unchanged`]
      if (errors.length > 0) bits.push(`${errors.length} error(s)`)
      showQbToast(errors.length > 0 ? 'err' : 'ok', `Vendors: ${bits.join(', ')}`)
    } finally {
      setQbSyncing(false)
    }
  }

  async function handleSyncCustomers() {
    if (qbCustomerSyncing) return
    setQbCustomerSyncing(true)
    try {
      const res = await fetch(`/api/quickbooks/sync-customers/${facility.id}`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        showQbToast('err', j.error ?? 'Customer sync failed')
        return
      }
      const { matchedExisting, createdInQb, skipped, errors } = j.data
      const bits = [`${matchedExisting} matched`, `${createdInQb} created`, `${skipped} skipped`]
      if (errors.length > 0) bits.push(`${errors.length} error(s)`)
      showQbToast(errors.length > 0 ? 'err' : 'ok', `Customers: ${bits.join(', ')}`)
    } catch {
      showQbToast('err', 'Network error — customer sync may not have run')
    } finally {
      setQbCustomerSyncing(false)
    }
  }

  async function handleQbInvoiceSync(fullSync: boolean) {
    if (qbInvoiceSyncing) return
    setQbInvoiceSyncing(true)
    try {
      const res = await fetch(`/api/quickbooks/sync-invoices/${facility.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullSync }),
      })
      const j = await res.json()
      if (!res.ok) {
        showQbToast('err', j.error ?? 'Invoice sync failed')
        return
      }
      const { created, updated, skipped, errors } = j.data
      const bits = [`${created} created`, `${updated} updated`, `${skipped} unchanged`]
      if (errors.length > 0) bits.push(`${errors.length} error(s)`)

      // Chain the payment/credit pull (best-effort — 503s while the flag is off).
      let payBit = ''
      try {
        const payRes = await fetch(`/api/quickbooks/sync-payments/${facility.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullSync }),
        })
        const payJson = await payRes.json().catch(() => ({}))
        if (payRes.ok && payJson.data) {
          payBit = ` · Payments: ${payJson.data.created} new, ${payJson.data.creditsUpserted} credits`
        }
      } catch {
        // invoice sync already succeeded — ignore
      }

      showQbToast(errors.length > 0 ? 'err' : 'ok', `Invoices: ${bits.join(', ')}${payBit}`)
      router.refresh()
    } finally {
      setQbInvoiceSyncing(false)
      setQbInvoiceConfirmFull(false)
    }
  }

  async function handleTestConnection() {
    if (qbTesting) return
    setQbTesting(true)
    setQbTestResult(null)
    try {
      const res = await fetch('/api/quickbooks/status')
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setQbTestResult({ ok: false, reason: 'error', message: j.error ?? 'Request failed' })
        return
      }
      const d = j.data ?? {}
      if (d.connected && d.ok) {
        setQbTestResult({ ok: true, companyName: d.companyName ?? null })
      } else if (d.connected) {
        setQbTestResult({ ok: false, reason: d.reason ?? 'error', message: d.message })
      } else {
        setQbTestResult({ ok: false, reason: 'not_connected' })
      }
    } catch {
      setQbTestResult({ ok: false, reason: 'error', message: 'Network error' })
    } finally {
      setQbTesting(false)
    }
  }

  async function loadQbRuns() {
    try {
      const res = await fetch(`/api/quickbooks/runs?facilityId=${facility.id}`)
      const j = await res.json().catch(() => ({}))
      if (res.ok) setQbRuns(j.data?.runs ?? [])
    } catch {
      // history is informational — never block the card on it
    } finally {
      setQbRunsLoaded(true)
    }
  }

  function runLabel(r: QbRun): string {
    const s = r.summary ?? {}
    const n = (k: string) => Number(s[k] ?? 0)
    switch (r.action) {
      case 'push_invoice':
        return `Send via QB — ${String(s.month ?? '')}: ${n('invoices')} invoice(s), ${formatMoney(n('totalCents'))}`
      case 'sync_customers':
        return `Sync Customers: ${n('matchedExisting')} matched, ${n('createdInQb')} created`
      case 'sync_payments':
        return `Payment sync: ${n('created')} new, ${n('upgraded')} upgraded, ${n('creditsUpserted')} credit(s)`
      case 'sync_invoices':
        return `Invoice sync: ${n('created')} new, ${n('updated')} updated`
      default:
        return r.action
    }
  }

  function undoDescription(action: string): string {
    switch (action) {
      case 'push_invoice':
        return 'Voids these invoices in QuickBooks and frees the appointments to be billed again. Invoices that already have a payment applied are left alone.'
      case 'sync_customers':
        return 'Deactivates the QuickBooks customers this run created. Matched customers are untouched.'
      case 'sync_payments':
        return 'Removes the payments and credits this sync pulled in, un-stamps existing ones, and rewinds the sync so the next run re-covers the same window.'
      case 'sync_invoices':
        return 'Restores every invoice balance from before this pull and rewinds the sync. Money collected on the site stays honored.'
      default:
        return ''
    }
  }

  async function handleUndoRun(id: string) {
    if (qbUndoingId) return
    setQbUndoingId(id)
    try {
      const res = await fetch(`/api/quickbooks/runs/${id}/undo`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        showQbToast('err', j.error ?? 'Undo failed')
        return
      }
      const { reversed, skipped, errors, completed } = j.data
      const bits = [`${reversed} reversed`]
      if (skipped > 0) bits.push(`${skipped} skipped`)
      if (errors.length > 0) bits.push(`${errors.length} error(s): ${errors[0]}`)
      if (!completed) bits.push('not fully undone — fix the cause and press Undo again')
      showQbToast(completed ? 'ok' : 'err', `Undo: ${bits.join(', ')}`)
      await loadQbRuns()
      router.refresh()
    } catch {
      showQbToast('err', 'Network error — undo may not have run')
    } finally {
      setQbUndoingId(null)
      setQbUndoConfirmId(null)
    }
  }

  async function handleDisconnectQb() {
    setQbDisconnecting(true)
    try {
      const res = await fetch('/api/quickbooks/disconnect', { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        showQbToast('err', j.error ?? 'Disconnect failed')
        return
      }
      showQbToast('ok', 'Disconnected from QuickBooks')
      router.refresh()
    } finally {
      setQbDisconnecting(false)
      setQbConfirmDisconnect(false)
    }
  }

  // Auto-load QB accounts when section mounts and QB is connected
  useEffect(() => {
    if (!hasQuickBooks) return
    if (!qbAccountsLoaded) loadQbAccounts()
    if (!qbRunsLoaded) loadQbRuns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasQuickBooks])

  // Surface ?qb=... toast (QuickBooks OAuth callback)
  useEffect(() => {
    const qbFlag = searchParams.get('qb')
    if (!qbFlag) return
    if (qbFlag === 'connected') showQbToast('ok', 'QuickBooks connected')
    else if (qbFlag === 'error') {
      const reason = searchParams.get('reason') ?? 'unknown'
      showQbToast('err', `QuickBooks connect failed: ${decodeURIComponent(reason)}`)
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('qb')
    url.searchParams.delete('reason')
    window.history.replaceState(null, '', url.toString())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Stripe ──────────────────────────────────────────────────────────
  const [stripePublishableKey, setStripePublishableKey] = useState(facility.stripePublishableKey ?? '')
  const [stripeSecretKey, setStripeSecretKey] = useState('')
  const hasStripeSecret = facility.hasStripeSecret
  const [savingStripe, setSavingStripe] = useState(false)
  const [savedStripe, setSavedStripe] = useState(false)
  const [stripeError, setStripeError] = useState('')

  async function handleSaveStripe() {
    setSavingStripe(true)
    setStripeError('')
    try {
      const res = await fetch('/api/facility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stripePublishableKey: stripePublishableKey || undefined,
          stripeSecretKey: stripeSecretKey || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        setStripeError(j.error ?? 'Failed to save')
        return
      }
      setSavedStripe(true)
      setTimeout(() => setSavedStripe(false), 2000)
      router.refresh()
    } finally {
      setSavingStripe(false)
    }
  }

  // ─── Automatic payment (COF) ──────────────────────────────────────────
  const [autopayMode, setAutopayMode] = useState((facility.autopayMode as string | null) ?? 'manual')
  const [autopayCadence, setAutopayCadence] = useState((facility.autopaySweepCadence as string | null) ?? 'off')
  const [savingAutopay, setSavingAutopay] = useState(false)
  const [savedAutopay, setSavedAutopay] = useState(false)

  async function handleSaveAutopay() {
    setSavingAutopay(true)
    try {
      const res = await fetch('/api/facility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autopayMode, autopaySweepCadence: autopayCadence }),
      })
      if (res.ok) {
        setSavedAutopay(true)
        setTimeout(() => setSavedAutopay(false), 2000)
        router.refresh()
      }
    } finally {
      setSavingAutopay(false)
    }
  }

  // ─── Revenue Share ────────────────────────────────────────────────────
  const paymentType = facility.paymentType ?? 'facility'
  const showRevShareRow = paymentType === 'rfms' || paymentType === 'facility' || paymentType === 'hybrid'
  const currentRevShare =
    (facility as { qbRevShareType?: string | null }).qbRevShareType ?? 'we_deduct'
  const revSharePct = (facility as { revSharePercentage?: number | null }).revSharePercentage ?? null
  const [pendingRevShare, setPendingRevShare] = useState<string | null>(null)
  const [revShareSaving, setRevShareSaving] = useState(false)
  const [revShareToast, setRevShareToast] = useState<string | null>(null)
  const effectiveRevShare = pendingRevShare ?? currentRevShare
  const revShareDirty = pendingRevShare !== null && pendingRevShare !== currentRevShare

  async function handleSaveRevShare() {
    if (!pendingRevShare) return
    setRevShareSaving(true)
    try {
      const res = await fetch(`/api/facilities/${facility.id}/rev-share`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revShareType: pendingRevShare }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setRevShareToast(j?.error ?? 'Could not save')
        setTimeout(() => setRevShareToast(null), 3000)
        return
      }
      setPendingRevShare(null)
      setRevShareToast('Saved')
      setTimeout(() => setRevShareToast(null), 2000)
      router.refresh()
    } finally {
      setRevShareSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* QuickBooks card */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
        {qbToast && (
          <div
            className={cn(
              'mb-4 px-3 py-2 rounded-xl text-sm font-medium',
              qbToast.kind === 'ok'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-red-50 border border-red-200 text-red-700',
            )}
          >
            {qbToast.text}
          </div>
        )}
        <div className="flex items-center gap-2 mb-2" data-tour="settings-quickbooks">
          <h3 className="text-sm font-semibold text-stone-800">QuickBooks Online</h3>
          {hasQuickBooks && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              ✓ Connected
            </span>
          )}
          <HelpTip
            tourId="master-quickbooks-setup"
            label="QuickBooks Online"
            description="Connect this facility's QuickBooks account. Once connected: payroll pushes as Bills, residents sync as customers, and Send via QB creates invoices. Nightly invoice + payment pull activates after Intuit production approval."
          />
        </div>
        <p className="text-xs text-stone-500 mb-4">
          Sync payroll bills and vendor records directly to your QuickBooks Online account.
        </p>

        {/* P56 (Josh) — Intuit's OAuth flow opens in a NEW tab so the app
            stays where it was; the callback lands the new tab back on
            /settings?section=billing&qb=connected with the toast. Safe:
            OAuth state lives in the oauth_states table, not this tab. */}
        {!hasQuickBooks && (
          <a
            href="/api/quickbooks/connect"
            target="_blank"
            rel="noopener noreferrer"
            data-tour="settings-qb-connect-btn"
            className="inline-block px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ backgroundColor: '#8B2E4A' }}
          >
            Connect QuickBooks
          </a>
        )}

        {hasQuickBooks && (
          <div className="space-y-4">
            {qbRealmId && (
              <div className="text-xs text-stone-500">
                <span className="font-semibold text-stone-600">Realm ID:</span>{' '}
                <span className="font-mono">{qbRealmId}</span>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1.5">
                Expense Account <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <select
                  value={qbExpenseAccountId}
                  onChange={(e) => setQbExpenseAccountId(e.target.value)}
                  disabled={!qbAccountsLoaded}
                  className="flex-1 px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A] disabled:opacity-50"
                >
                  <option value="">{qbAccountsLoaded ? 'Select an expense account…' : 'Loading…'}</option>
                  {qbAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.accountSubType ? ` (${a.accountSubType})` : ''}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleSaveExpenseAccount}
                  disabled={qbSavingAccount || qbExpenseAccountId === qbExpenseAccountIdInit}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
                  style={{ backgroundColor: '#8B2E4A' }}
                >
                  {qbSavingAccount ? 'Saving…' : 'Save'}
                </button>
              </div>
              <p className="text-xs text-stone-400 mt-1.5">
                Payroll Bills will book to this account. Required before pushing pay periods.
              </p>
            </div>

            {qbTestResult && (
              qbTestResult.ok ? (
                <div className="px-3 py-2 rounded-xl text-sm font-medium bg-emerald-50 border border-emerald-200 text-emerald-800">
                  ✓ Connected to {qbTestResult.companyName ?? 'QuickBooks'}
                </div>
              ) : (
                <div className="px-3 py-2 rounded-xl text-sm bg-amber-50 border border-amber-200 text-amber-800">
                  <span className="font-semibold">
                    {qbTestResult.reason === 'reconnect_needed'
                      ? 'Connection broken — QuickBooks needs to be reconnected.'
                      : 'Connection test failed.'}
                  </span>{' '}
                  {qbTestResult.reason === 'reconnect_needed' ? (
                    <a
                      href="/api/quickbooks/connect"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-[#8B2E4A] underline"
                    >
                      Reconnect QuickBooks
                    </a>
                  ) : (
                    qbTestResult.message && (
                      <span className="text-amber-700">{qbTestResult.message}</span>
                    )
                  )}
                </div>
              )
            )}

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleTestConnection}
                disabled={qbTesting}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 transition-all disabled:opacity-50"
              >
                {qbTesting ? 'Testing…' : 'Test connection'}
              </button>
              <button
                onClick={handleSyncVendors}
                disabled={qbSyncing}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 transition-all disabled:opacity-50"
              >
                {qbSyncing ? 'Syncing…' : 'Sync Vendors'}
              </button>
              <button
                onClick={handleSyncCustomers}
                disabled={qbCustomerSyncing}
                title="Link residents to QuickBooks customers (creates missing sub-customers under this facility)"
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 transition-all disabled:opacity-50"
              >
                {qbCustomerSyncing ? 'Syncing…' : 'Sync Customers'}
              </button>
              {!qbConfirmDisconnect ? (
                <button
                  onClick={() => setQbConfirmDisconnect(true)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold border border-red-200 text-red-700 hover:bg-red-50 transition-all"
                >
                  Disconnect
                </button>
              ) : (
                <div
                  className="flex items-center gap-2"
                  onMouseLeave={() => setQbConfirmDisconnect(false)}
                >
                  <span className="text-sm text-stone-600">Disconnect?</span>
                  <button
                    onClick={handleDisconnectQb}
                    disabled={qbDisconnecting}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-all disabled:opacity-50"
                  >
                    {qbDisconnecting ? 'Disconnecting…' : 'Yes'}
                  </button>
                  <button
                    onClick={() => setQbConfirmDisconnect(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-stone-200 text-stone-600 hover:bg-stone-50 transition-all"
                  >
                    No
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-stone-100 pt-4 mt-4">
              <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
                Invoice Sync
              </h3>
              {!qbInvoiceSyncEnabled ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                  Invoice sync coming soon — awaiting Intuit production approval.
                </div>
              ) : (
                <>
                  <p className="text-xs text-stone-500 mb-3">
                    Last synced:{' '}
                    {qbInvoicesLastSyncedAt
                      ? new Date(qbInvoicesLastSyncedAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      : 'never'}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleQbInvoiceSync(false)}
                      disabled={qbInvoiceSyncing}
                      className="px-4 py-2 rounded-xl text-sm font-semibold border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 transition-all disabled:opacity-50"
                    >
                      {qbInvoiceSyncing ? 'Syncing…' : 'Sync now'}
                    </button>
                    <button
                      onClick={() => setQbInvoiceConfirmFull(true)}
                      disabled={qbInvoiceSyncing}
                      className="px-4 py-2 rounded-xl text-sm font-semibold border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 transition-all disabled:opacity-50"
                    >
                      Full re-sync
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Sync history + per-run undo (qb_sync_runs) */}
            <div className="border-t border-stone-100 pt-4 mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                  Sync history
                </h3>
                <button
                  type="button"
                  onClick={loadQbRuns}
                  className="text-[11px] text-stone-400 hover:text-stone-600"
                >
                  Refresh
                </button>
              </div>
              <p className="text-[11.5px] text-stone-400 mb-3">
                Every QuickBooks operation is recorded here and can be undone — invoices are voided in
                QuickBooks (never deleted), and anything with a payment already applied is left alone.
                Card payments collected on the site (card on file, in-app, family portal) are recorded in
                QuickBooks automatically against the same invoices; a refund voids the QuickBooks payment.
              </p>
              {!qbRunsLoaded ? (
                <p className="text-xs text-stone-400">Loading…</p>
              ) : qbRuns.length === 0 ? (
                <p className="text-xs text-stone-400">No QuickBooks activity yet.</p>
              ) : (
                <ul className="divide-y divide-stone-100 rounded-xl border border-stone-100 overflow-hidden">
                  {qbRuns.map((r) => {
                    const when = new Date(r.startedAt).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                    const confirming = qbUndoConfirmId === r.id
                    const undoing = qbUndoingId === r.id
                    const undoErrors = (r.undoSummary?.errors as string[] | undefined) ?? []
                    const undoIncomplete = !r.undoneAt && undoErrors.length > 0
                    return (
                      <li key={r.id} className="px-3 py-2.5 text-xs flex flex-col gap-1.5 bg-white">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-stone-700 font-medium truncate">{runLabel(r)}</div>
                            <div className="text-stone-400">
                              {when}
                              {r.automated ? ' · nightly' : ''}
                              {r.undoneAt
                                ? ` · undone ${new Date(r.undoneAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                                : ''}
                            </div>
                            {undoIncomplete && (
                              <div className="text-amber-700 mt-0.5">
                                Undo didn’t finish: {undoErrors[0]} — press Undo again to retry.
                              </div>
                            )}
                          </div>
                          {r.undoneAt ? (
                            <span className="shrink-0 text-[10.5px] font-semibold px-2.5 py-1 rounded-full bg-stone-100 text-stone-500">
                              Undone
                            </span>
                          ) : confirming ? null : (
                            <button
                              type="button"
                              onClick={() => setQbUndoConfirmId(r.id)}
                              disabled={!!qbUndoingId}
                              className="shrink-0 text-[11px] font-semibold text-[#8B2E4A] hover:underline disabled:opacity-40"
                            >
                              Undo
                            </button>
                          )}
                        </div>
                        {confirming && (
                          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 flex flex-col gap-2">
                            <span className="text-amber-800">{undoDescription(r.action)}</span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleUndoRun(r.id)}
                                disabled={undoing}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#8B2E4A] text-white hover:bg-[#72253C] disabled:opacity-50"
                              >
                                {undoing ? 'Undoing…' : 'Yes, undo this'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setQbUndoConfirmId(null)}
                                disabled={undoing}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-50"
                              >
                                Keep
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {qbInvoiceConfirmFull && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[85dvh] overflow-y-auto p-6">
            <h3
              className="text-xl text-stone-900 mb-2"
              style={{ fontFamily: 'DM Serif Display, serif' }}
            >
              Full re-sync
            </h3>
            <p className="text-sm text-stone-600 mb-5">
              This will re-import all invoices from QuickBooks and ignore the incremental sync
              cursor. Continue?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setQbInvoiceConfirmFull(false)}
                disabled={qbInvoiceSyncing}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleQbInvoiceSync(true)}
                disabled={qbInvoiceSyncing}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#8B2E4A] hover:bg-[#72253C] disabled:opacity-50"
              >
                {qbInvoiceSyncing ? 'Running…' : 'Run full re-sync'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stripe card */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)] space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-stone-800 mb-1">Stripe</h3>
          <p className="text-xs text-stone-500">
            Legacy — family-portal payments always run through the Senior Stylist platform account now; a facility-level key is no longer used for checkout. Leave these blank unless support asks otherwise.
          </p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Publishable Key</label>
          <input
            type="text"
            value={stripePublishableKey}
            onChange={(e) => setStripePublishableKey(e.target.value)}
            placeholder="pk_live_…"
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A] font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Secret Key</label>
          <input
            type="password"
            value={stripeSecretKey}
            onChange={(e) => setStripeSecretKey(e.target.value)}
            placeholder={hasStripeSecret ? 'Stored securely — enter a new key to replace' : 'sk_live_…'}
            autoComplete="new-password"
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A] font-mono"
          />
          {hasStripeSecret && !stripeSecretKey && (
            <p className="mt-1.5 text-[11px] text-emerald-700 flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
              Secret key configured
            </p>
          )}
        </div>
        {stripeError && <p className="text-red-600 text-xs">{stripeError}</p>}
        <div>
          <button
            onClick={handleSaveStripe}
            disabled={savingStripe}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ backgroundColor: '#8B2E4A' }}
          >
            {savedStripe ? 'Saved!' : savingStripe ? 'Saving…' : 'Save Keys'}
          </button>
        </div>
      </div>

      {/* Automatic payment (COF) card */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
        <h3 className="text-sm font-semibold text-stone-800 mb-1">Automatic payment</h3>
        <p className="text-xs text-stone-500 mb-4">
          Controls how Card-On-File residents are charged for services. Per-resident card &amp;
          auto-pay setup lives on each resident&apos;s page.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">When to collect</span>
            <select
              value={autopayMode}
              onChange={(e) => setAutopayMode(e.target.value)}
              className="mt-1 w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50"
            >
              <option value="manual">Manual only (Collect-now button)</option>
              <option value="on_completion">Automatically when a service is completed</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Catch-up sweep</span>
            <select
              value={autopayCadence}
              onChange={(e) => setAutopayCadence(e.target.value)}
              className="mt-1 w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50"
            >
              <option value="off">Off</option>
              <option value="nightly">Every night</option>
              <option value="biweekly">Every two weeks</option>
              <option value="monthly">Every month</option>
            </select>
          </label>
        </div>
        <button
          onClick={handleSaveAutopay}
          disabled={savingAutopay}
          className="mt-4 px-4 py-2 rounded-lg bg-[#8B2E4A] text-white text-sm font-semibold disabled:opacity-50"
        >
          {savedAutopay ? 'Saved!' : savingAutopay ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Revenue Share card */}
      {showRevShareRow && (
        <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-sm font-semibold text-stone-800">Revenue Share</h3>
            {revSharePct != null && (
              <span className="text-xs text-stone-500">
                Current rate: <span className="font-semibold text-stone-700">{revSharePct}%</span>
              </span>
            )}
          </div>
          <p className="text-xs text-stone-500 mb-4">
            Choose who deducts the revenue share from facility payments.
          </p>
          {revShareToast && (
            <div className="mb-3 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-50 border border-emerald-200 text-emerald-800">
              {revShareToast}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPendingRevShare('we_deduct')}
              disabled={revShareSaving}
              className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed transition-colors ${
                effectiveRevShare === 'we_deduct'
                  ? 'bg-[#8B2E4A] text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              Senior Stylist
            </button>
            <button
              type="button"
              onClick={() => setPendingRevShare('facility_deducts')}
              disabled={revShareSaving}
              className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed transition-colors ${
                effectiveRevShare === 'facility_deducts'
                  ? 'bg-[#8B2E4A] text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              Facility
            </button>
            {revShareDirty && (
              <button
                type="button"
                onClick={handleSaveRevShare}
                disabled={revShareSaving}
                className="rounded-xl px-4 py-2 text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {revShareSaving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
          {revSharePct != null && revSharePct > 0 ? (
            <div className="text-xs text-stone-600 mt-3 leading-relaxed bg-stone-50 rounded-lg p-3">
              <div className="font-semibold text-stone-700 mb-0.5">
                At {revSharePct}% revenue share ({effectiveRevShare === 'we_deduct' ? 'we deduct' : 'facility deducts'}):
              </div>
              <div className="text-stone-500">
                On a 10,000 payment → {formatMoney(Math.round(10000 * (100 - revSharePct)))} to Senior Stylist, {formatMoney(Math.round(10000 * revSharePct))} to facility
              </div>
            </div>
          ) : (
            <div className="text-xs text-stone-400 mt-3 italic">No revenue share configured</div>
          )}
        </div>
      )}
    </div>
  )
}
