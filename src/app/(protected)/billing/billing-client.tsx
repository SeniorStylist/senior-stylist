'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BillingSummary,
  DisabledActionButton,
  SendDedupModal,
  StatCard,
  formatDollars,
  revShareLabel,
} from './views/billing-shared'
import { IPView } from './views/ip-view'
import { RFMSView } from './views/rfms-view'
import { HybridView } from './views/hybrid-view'

interface FacilityOption {
  id: string
  name: string
  facilityCode: string | null
}

export function BillingClient({
  initialFacilityId,
  facilityOptions,
  isMaster,
}: {
  initialFacilityId: string
  facilityOptions: FacilityOption[]
  isMaster: boolean
}) {
  const [facilityId, setFacilityId] = useState(initialFacilityId)
  const [refreshKey, setRefreshKey] = useState(0)
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Send Statement state
  const [sendLoading, setSendLoading] = useState(false)
  const [sendWarning, setSendWarning] = useState<{ lastSentAt: string } | null>(null)
  const [sendEmailOverride, setSendEmailOverride] = useState('')

  useEffect(() => {
    if (!facilityId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/billing/summary/${facilityId}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then((body) => {
        if (cancelled) return
        setSummary(body.data as BillingSummary)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message)
        setSummary(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [facilityId, refreshKey])

  const handleRefresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  const totals = useMemo(() => {
    if (!summary) return { billed: 0, received: 0, outstanding: 0 }
    const billed = (summary.invoices ?? []).reduce((s, i) => s + (i.amountCents ?? 0), 0)
    const received = (summary.payments ?? []).reduce((s, p) => s + (p.amountCents ?? 0), 0)
    const outstanding = summary.facility.qbOutstandingBalanceCents ?? 0
    return { billed, received, outstanding }
  }, [summary])

  const paymentType = summary?.facility.paymentType ?? null
  const showRevShareNote =
    paymentType === 'rfms' || paymentType === 'facility' || paymentType === 'hybrid'

  async function handleSendStatement(force = false) {
    if (!summary) return
    const to = summary.facility.contactEmail ?? sendEmailOverride
    if (!to) return
    setSendLoading(true)
    setSendWarning(null)
    try {
      const res = await fetch(`/api/billing/send-statement/facility/${facilityId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, force }),
      })
      const body = await res.json()
      if (body.warning) {
        setSendWarning({ lastSentAt: body.lastSentAt })
        return
      }
      if (!res.ok) {
        alert(body?.error ?? 'Failed to send')
        return
      }
      handleRefresh()
    } catch {
      alert('Network error — please try again.')
    } finally {
      setSendLoading(false)
    }
  }

  if (!facilityId) {
    return (
      <div className="p-4 md:p-8 max-w-6xl mx-auto">
        <h1
          className="text-2xl md:text-3xl text-stone-900"
          style={{ fontFamily: 'DM Serif Display, serif' }}
        >
          Billing
        </h1>
        <div className="mt-6 bg-white rounded-2xl border border-stone-100 shadow-sm p-10 text-center">
          <p className="text-sm text-stone-500">No facility available.</p>
        </div>
      </div>
    )
  }

  const contactEmail = summary?.facility.contactEmail ?? null
  const sendToEmail = contactEmail ?? sendEmailOverride

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      {sendWarning && (
        <SendDedupModal
          lastSentAt={sendWarning.lastSentAt}
          onConfirm={() => {
            setSendWarning(null)
            handleSendStatement(true)
          }}
          onCancel={() => setSendWarning(null)}
        />
      )}

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <h1
            className="text-2xl md:text-3xl text-stone-900"
            style={{ fontFamily: 'DM Serif Display, serif' }}
          >
            Billing
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            {summary?.facility.name ?? '—'}
            {summary?.facility.facilityCode ? (
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-md bg-stone-100 text-stone-500 font-mono text-[11px]">
                {summary.facility.facilityCode}
              </span>
            ) : null}
          </p>
        </div>
        {isMaster && facilityOptions.length > 1 ? (
          <select
            value={facilityId}
            onChange={(e) => setFacilityId(e.target.value)}
            className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 focus:outline-none"
          >
            {facilityOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.facilityCode ? `${f.facilityCode} · ${f.name}` : f.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="animate-pulse bg-stone-100 rounded-2xl h-24" />
          <div className="animate-pulse bg-stone-100 rounded-2xl h-64" />
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-10 text-center">
          <p className="text-sm text-red-600">Error loading billing: {error}</p>
        </div>
      ) : !summary ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-10 text-center">
          <p className="text-sm text-stone-500">No data.</p>
        </div>
      ) : summary.invoices.length + summary.payments.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-10 text-center">
          <p className="text-sm text-stone-500">
            No billing data yet. Import historical data from the Super Admin panel.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <StatCard label="Total Billed" value={formatDollars(totals.billed)} />
              <StatCard label="Total Received" value={formatDollars(totals.received)} />
              <StatCard
                label="Outstanding"
                value={formatDollars(totals.outstanding)}
                highlight={totals.outstanding > 0 ? 'amber' : 'default'}
              />
            </div>
            {showRevShareNote ? (
              <p className="mt-3 text-xs text-stone-500">
                {revShareLabel(summary.facility.qbRevShareType)}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-2 mb-4">
            {!contactEmail ? (
              <input
                type="email"
                value={sendEmailOverride}
                onChange={(e) => setSendEmailOverride(e.target.value)}
                placeholder="Recipient email…"
                className="rounded-xl border border-stone-200 px-3 py-1.5 text-sm text-stone-900 w-56 focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 focus:outline-none"
              />
            ) : null}
            <button
              type="button"
              disabled={sendLoading || !sendToEmail}
              onClick={() => handleSendStatement(false)}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold bg-[#8B2E4A] text-white hover:bg-[#72253C] disabled:opacity-40 disabled:cursor-not-allowed"
              title={!sendToEmail ? 'Enter a recipient email above' : undefined}
            >
              {sendLoading ? 'Sending…' : 'Send Statement'}
            </button>
            <DisabledActionButton
              label="Send via QB"
              title="Available after QB production approval"
            />
          </div>

          {paymentType === 'ip' ? (
            <IPView
              facility={summary.facility}
              residents={summary.residents}
              invoices={summary.invoices}
              onRefresh={handleRefresh}
            />
          ) : paymentType === 'hybrid' ? (
            <HybridView
              facility={summary.facility}
              residents={summary.residents}
              invoices={summary.invoices}
              payments={summary.payments}
              onRefresh={handleRefresh}
            />
          ) : (
            <RFMSView
              facility={summary.facility}
              residents={summary.residents}
              invoices={summary.invoices}
              payments={summary.payments}
            />
          )}
        </>
      )}
    </div>
  )
}
