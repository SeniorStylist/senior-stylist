'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { PublicFacility } from '@/lib/sanitize'

interface Props {
  facility: PublicFacility
}

export function BillingSection({ facility }: Props) {
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
  const [qbToast, setQbToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [qbConfirmDisconnect, setQbConfirmDisconnect] = useState(false)
  const [qbDisconnecting, setQbDisconnecting] = useState(false)

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
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-semibold text-stone-800">QuickBooks Online</h3>
          {hasQuickBooks && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              ✓ Connected
            </span>
          )}
        </div>
        <p className="text-xs text-stone-500 mb-4">
          Sync payroll bills and vendor records directly to your QuickBooks Online account.
        </p>

        {!hasQuickBooks && (
          <a
            href="/api/quickbooks/connect"
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

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleSyncVendors}
                disabled={qbSyncing}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 transition-all disabled:opacity-50"
              >
                {qbSyncing ? 'Syncing…' : 'Sync Vendors'}
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
          </div>
        )}
      </div>

      {/* Stripe card */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)] space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-stone-800 mb-1">Stripe</h3>
          <p className="text-xs text-stone-500">
            Enter your Stripe keys to enable per-resident payment collection. These are stored securely and used for portal checkout sessions.
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
        </div>
      )}
    </div>
  )
}
