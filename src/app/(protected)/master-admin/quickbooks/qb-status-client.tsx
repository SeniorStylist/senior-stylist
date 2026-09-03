'use client'

// P48 — network-wide QuickBooks health. Chips follow the master-admin facility
// card vocabulary so this reads as part of the same system.
// 2026-09-02 — realm-level connections: the company card at the top connects
// ONCE for every facility, attaches stragglers, or disconnects the company.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/toast'
import { PageHeader } from '@/components/ui/page-header'
import { Plug } from 'lucide-react'
import { formatMoney } from '@/lib/format'
import type { QbConnectionInfo } from '@/lib/qb-connection'

export interface QbFacilityRow {
  id: string
  name: string
  facilityCode: string | null
  connected: boolean
  realmId: string | null
  hasExpenseAccount: boolean
  tokenExpiresAt: string | null
  lastInvoiceSyncAt: string | null
  lastSyncAction: string | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  lastSyncAt: string | null
  lastImportType: string | null
  lastImportFile: string | null
  lastImportAt: string | null
  openBalanceCents: number
}

export type CallbackNotice =
  | { kind: 'ok'; attached: number; skipped: number }
  | { kind: 'err'; reason: string }
  | null

type Health = 'healthy' | 'attention' | 'broken' | 'disconnected'

const STALE_MS = 48 * 60 * 60 * 1000

function health(r: QbFacilityRow, invoiceSyncEnabled: boolean): Health {
  if (!r.connected) return 'disconnected'
  if (r.lastSyncStatus === 'error') return 'broken'
  if (!r.hasExpenseAccount) return 'attention'
  if (invoiceSyncEnabled) {
    const last = r.lastInvoiceSyncAt ? new Date(r.lastInvoiceSyncAt).getTime() : 0
    if (!last || Date.now() - last > STALE_MS) return 'attention'
  }
  return 'healthy'
}

const CHIP: Record<Health, { label: string; cls: string; title: string }> = {
  healthy: {
    label: 'Healthy',
    cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    title: 'Connected, expense account set, syncing normally.',
  },
  attention: {
    label: 'Attention',
    cls: 'bg-amber-50 text-amber-700 border border-amber-200',
    title: 'Connected, but something needs setup — usually a missing expense account or a stale sync.',
  },
  broken: {
    label: 'Needs reconnect',
    cls: 'bg-rose-50 text-rose-700 border border-rose-200',
    title: 'The last QuickBooks call failed. The connection most likely needs re-authorizing.',
  },
  disconnected: {
    label: 'Not connected',
    cls: 'bg-stone-100 text-stone-400 border border-stone-200',
    title: 'This facility is not attached to a QuickBooks company.',
  },
}

const money = (cents: number) => formatMoney(cents) // P54 money style

function ago(iso: string | null): string {
  if (!iso) return 'Never'
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days > 1) return `${days}d ago`
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 1) return `${hours}h ago`
  const mins = Math.max(1, Math.floor(ms / 60_000))
  return `${mins}m ago`
}

function until(iso: string | null): string {
  if (!iso) return 'unknown'
  const days = Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return 'expired'
  if (days === 0) return 'today'
  return `in ${days} day${days === 1 ? '' : 's'}`
}

export function QbStatusClient({
  rows,
  connections,
  facilityFilter,
  invoiceSyncEnabled,
  callbackNotice,
}: {
  rows: QbFacilityRow[]
  connections: QbConnectionInfo[]
  facilityFilter: string | null
  invoiceSyncEnabled: boolean
  callbackNotice: CallbackNotice
}) {
  const { toast } = useToast()
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null)
  const [localRows, setLocalRows] = useState(rows)

  const liveConnections = connections.filter((c) => c.connected)
  const primary = liveConnections[0] ?? null
  const unattached = useMemo(() => localRows.filter((r) => !r.realmId), [localRows])

  const counts = useMemo(() => {
    const c = { healthy: 0, attention: 0, broken: 0, disconnected: 0 }
    for (const r of localRows) c[health(r, invoiceSyncEnabled)]++
    return c
  }, [localRows, invoiceSyncEnabled])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return localRows
      .filter((r) => (facilityFilter ? r.id === facilityFilter : true))
      .filter((r) => (onlyProblems ? health(r, invoiceSyncEnabled) !== 'healthy' : true))
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          (r.facilityCode ?? '').toLowerCase().includes(q),
      )
  }, [localRows, search, onlyProblems, facilityFilter, invoiceSyncEnabled])

  async function syncOne(id: string) {
    if (syncing) return
    setSyncing(id)
    try {
      const res = await fetch(`/api/quickbooks/sync-invoices/${id}`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof json.error === 'string' ? json.error : 'Sync failed')
        return
      }
      const d = json.data ?? {}
      toast.success(`Synced — ${d.created ?? 0} new, ${d.updated ?? 0} updated`)
      setLocalRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, lastInvoiceSyncAt: new Date().toISOString(), lastSyncStatus: 'success', lastSyncError: null }
            : r,
        ),
      )
    } catch {
      toast.error('Network error — try again.')
    } finally {
      setSyncing(null)
    }
  }

  async function attach(realmId: string, scope: 'all' | 'list', facilityIds?: string[]) {
    const key = scope === 'all' ? 'attach-all' : `attach-${facilityIds?.[0] ?? ''}`
    if (busy) return
    setBusy(key)
    try {
      const res = await fetch('/api/quickbooks/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ realmId, scope, facilityIds }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof json.error === 'string' ? json.error : 'Attach failed')
        return
      }
      const d = json.data ?? {}
      toast.success(
        `${d.attached ?? 0} attached${d.skipped ? ` · ${d.skipped} skipped (attached to a different QuickBooks company)` : ''}`,
      )
      const ids = new Set(scope === 'all' ? unattached.map((r) => r.id) : facilityIds ?? [])
      setLocalRows((prev) => prev.map((r) => (ids.has(r.id) ? { ...r, realmId, connected: true } : r)))
      router.refresh()
    } catch {
      toast.error('Network error — try again.')
    } finally {
      setBusy(null)
    }
  }

  async function disconnectCompany(realmId: string) {
    if (busy) return
    setBusy('disconnect')
    try {
      const res = await fetch('/api/quickbooks/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'company', realmId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof json.error === 'string' ? json.error : 'Disconnect failed')
        return
      }
      toast.success(`QuickBooks disconnected — ${json.data?.detached ?? 0} facilities detached`)
      setLocalRows((prev) => prev.map((r) => (r.realmId === realmId ? { ...r, realmId: null, connected: false } : r)))
      router.refresh()
    } catch {
      toast.error('Network error — try again.')
    } finally {
      setBusy(null)
      setConfirmDisconnect(null)
    }
  }

  return (
    <div className="page-enter max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <PageHeader
          icon={Plug}
          title="QuickBooks Status"
          subtitle="Connection health for every facility in the network"
        />
        <Link
          href="/master-admin"
          className="text-sm text-stone-500 hover:text-[#8B2E4A] transition-colors mt-2"
        >
          ← Master Admin
        </Link>
      </div>

      {callbackNotice?.kind === 'ok' && (
        <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="font-semibold">Connected to QuickBooks.</span> {callbackNotice.attached} facilit
          {callbackNotice.attached === 1 ? 'y' : 'ies'} attached
          {callbackNotice.skipped > 0
            ? ` · ${callbackNotice.skipped} skipped because they are attached to a different QuickBooks company`
            : ''}
          .
        </div>
      )}
      {callbackNotice?.kind === 'err' && (
        <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="font-semibold">QuickBooks connection failed:</span> {callbackNotice.reason}
        </div>
      )}

      {/* Company connection — one authorization for every facility */}
      <div className="mb-6 rounded-2xl border border-stone-200 bg-white p-5 shadow-[var(--shadow-sm)]">
        {primary ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-900">
                {primary.companyName ?? 'QuickBooks company'}{' '}
                <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 align-middle ml-1">
                  Connected
                </span>
              </p>
              <p className="text-[11.5px] text-stone-500 mt-1">
                Realm <span className="font-mono">{primary.realmId}</span> · connected {ago(primary.connectedAt)} ·{' '}
                {localRows.filter((r) => r.realmId === primary.realmId).length} of {localRows.length} facilities attached
                · authorization renews itself; reconnect needed {until(primary.refreshTokenExpiresAt)}
              </p>
              {primary.lastError && (
                <p className="text-[11.5px] text-rose-700 mt-1 line-clamp-2">Last error: {primary.lastError}</p>
              )}
              {liveConnections.length > 1 && (
                <p className="text-[11.5px] text-amber-700 mt-1">
                  {liveConnections.length} QuickBooks companies are connected — facilities attach to one each.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {unattached.length > 0 && (
                <button
                  type="button"
                  onClick={() => attach(primary.realmId, 'all')}
                  disabled={busy !== null}
                  className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#8B2E4A] text-white hover:bg-[#72253C] transition-colors disabled:opacity-50"
                >
                  {busy === 'attach-all' ? 'Attaching…' : `Attach the other ${unattached.length}`}
                </button>
              )}
              <a
                href={`/api/quickbooks/connect?scope=all&return=master`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold px-3 py-2 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
                title="Re-authorize with Intuit (use after 'Needs reconnect')"
              >
                Reconnect
              </a>
              {confirmDisconnect === primary.realmId ? (
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-stone-600">Disconnect every facility?</span>
                  <button
                    type="button"
                    onClick={() => disconnectCompany(primary.realmId)}
                    disabled={busy !== null}
                    className="px-3 py-1.5 rounded-lg font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {busy === 'disconnect' ? 'Disconnecting…' : 'Yes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDisconnect(null)}
                    className="px-3 py-1.5 rounded-lg font-semibold border border-stone-200 text-stone-600 hover:bg-stone-50"
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDisconnect(primary.realmId)}
                  className="text-xs font-semibold px-3 py-2 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
                >
                  Disconnect company
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-stone-900">No QuickBooks company connected</p>
              <p className="text-[11.5px] text-stone-500 mt-1">
                One authorization connects every facility in the network — sign in to Intuit as the admin of the
                real QuickBooks company.
              </p>
            </div>
            <a
              href="/api/quickbooks/connect?scope=all&return=master"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold px-4 py-2 rounded-xl bg-[#8B2E4A] text-white hover:bg-[#72253C] transition-colors"
            >
              Connect QuickBooks for all facilities
            </a>
          </div>
        )}
      </div>

      {!invoiceSyncEnabled && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Live invoice sync is off.</span> It unlocks once Intuit
          grants production approval and <code className="font-mono text-xs">QB_INVOICE_SYNC_ENABLED</code> is
          set to <code className="font-mono text-xs">true</code> in Vercel. Payroll push and vendor sync work
          today; invoices come in through the{' '}
          <Link href="/master-admin/imports/quickbooks" className="underline font-semibold">CSV importers</Link>.
        </div>
      )}

      {/* Summary chips double as filters-at-a-glance */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(['broken', 'attention', 'healthy', 'disconnected'] as Health[]).map((h) => (
          <span
            key={h}
            className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-full ${CHIP[h].cls}`}
            title={CHIP[h].title}
          >
            {counts[h]} {CHIP[h].label}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or FID…"
          className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50 focus:shadow-[0_0_0_3px_rgba(139,46,74,0.08)]"
        />
        <button
          type="button"
          onClick={() => setOnlyProblems((v) => !v)}
          className={`text-xs px-3 py-2 rounded-xl border transition-colors ${
            onlyProblems
              ? 'bg-[#8B2E4A] text-white border-[#8B2E4A] font-semibold'
              : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
          }`}
        >
          Needs attention only
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-stone-400 py-12 text-center">No facilities match.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visible.map((r) => {
            const h = health(r, invoiceSyncEnabled)
            return (
              <div
                key={r.id}
                className="bg-white rounded-2xl border border-stone-200 p-5 shadow-[var(--shadow-sm)]"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-900 truncate">
                      {r.facilityCode && (
                        <span className="font-mono text-xs text-stone-400 mr-1.5">{r.facilityCode}</span>
                      )}
                      {r.name}
                    </p>
                    {r.realmId && (
                      <p className="text-[11px] text-stone-400 font-mono mt-0.5 truncate">
                        Realm {r.realmId}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 text-[10.5px] font-semibold px-2.5 py-1 rounded-full ${CHIP[h].cls}`}
                    title={CHIP[h].title}
                  >
                    {CHIP[h].label}
                  </span>
                </div>

                {h === 'broken' && r.lastSyncError && (
                  <p className="text-[11.5px] text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 mb-3 line-clamp-2">
                    {r.lastSyncError}
                  </p>
                )}

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11.5px] mb-3">
                  <div>
                    <dt className="text-stone-400">Expense account</dt>
                    <dd className={r.hasExpenseAccount ? 'text-stone-700' : 'text-amber-700 font-semibold'}>
                      {r.hasExpenseAccount ? 'Set' : 'Not set — payroll push blocked'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-stone-400">Open balance</dt>
                    <dd className="text-stone-700 font-semibold">{money(r.openBalanceCents)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-400">Last invoice sync</dt>
                    <dd className="text-stone-700">{ago(r.lastInvoiceSyncAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-400">Last CSV import</dt>
                    <dd className="text-stone-700" title={r.lastImportFile ?? undefined}>
                      {ago(r.lastImportAt)}
                    </dd>
                  </div>
                </dl>

                <div className="flex flex-wrap gap-2">
                  {!r.realmId && primary && (
                    <button
                      type="button"
                      onClick={() => attach(primary.realmId, 'list', [r.id])}
                      disabled={busy !== null}
                      className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#8B2E4A] text-white hover:bg-[#72253C] transition-colors disabled:opacity-50"
                    >
                      {busy === `attach-${r.id}` ? 'Attaching…' : 'Attach to QuickBooks'}
                    </button>
                  )}
                  {r.connected && invoiceSyncEnabled && (
                    <button
                      type="button"
                      onClick={() => syncOne(r.id)}
                      disabled={syncing !== null}
                      className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#8B2E4A] text-white hover:bg-[#72253C] transition-colors disabled:opacity-50"
                    >
                      {syncing === r.id ? 'Syncing…' : 'Sync now'}
                    </button>
                  )}
                  {r.connected && !invoiceSyncEnabled && (
                    <span
                      title="Awaiting Intuit production approval"
                      className="text-xs font-semibold px-3 py-2 rounded-xl bg-stone-100 text-stone-400 cursor-not-allowed"
                    >
                      Sync now
                    </span>
                  )}
                  <Link
                    href={`/billing?facility=${r.id}`}
                    className="text-xs font-semibold px-3 py-2 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
                  >
                    Billing
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
