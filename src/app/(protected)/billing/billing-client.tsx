'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BillingSummary,
  DisabledActionButton,
  SendDedupModal,
  StatCard,
  formatDollars,
} from './views/billing-shared'
import { IPView } from './views/ip-view'
import { RFMSView } from './views/rfms-view'
import { HybridView } from './views/hybrid-view'
import { useCountUp } from '@/hooks/use-count-up'
import { useToast } from '@/components/ui/toast'
import {
  btnBase,
  btnHubInteractive,
  cardHover,
  successFlash,
  transitionBase,
} from '@/lib/animations'

interface FacilityOption {
  id: string
  name: string
  facilityCode: string | null
}

interface CrossFacilitySummary {
  totalOutstandingCents: number
  collectedThisMonthCents: number
  invoicedThisMonthCents: number
  facilitiesOverdueCount: number
}

function paymentTypeLabel(pt: string | null | undefined): string {
  if (pt === 'ip') return 'IP'
  if (pt === 'rfms' || pt === 'facility') return 'RFMS'
  if (pt === 'hybrid') return 'Hybrid'
  return pt ?? '—'
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

  const [sendLoading, setSendLoading] = useState(false)
  const [sendWarning, setSendWarning] = useState<{ lastSentAt: string } | null>(null)
  const [sendEmailOverride, setSendEmailOverride] = useState('')

  const [crossSummary, setCrossSummary] = useState<CrossFacilitySummary | null>(null)
  const [crossLoading, setCrossLoading] = useState(isMaster)

  const [pendingRevShare, setPendingRevShare] = useState<string | null>(null)
  const [revShareSaving, setRevShareSaving] = useState(false)

  const { toast } = useToast()

  useEffect(() => {
    if (!isMaster) return
    let cancelled = false
    setCrossLoading(true)
    fetch('/api/billing/cross-facility-summary')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((body) => {
        if (cancelled) return
        setCrossSummary(body.data as CrossFacilitySummary)
      })
      .catch(() => {
        if (cancelled) return
        setCrossSummary(null)
      })
      .finally(() => {
        if (!cancelled) setCrossLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isMaster])

  useEffect(() => {
    if (!facilityId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setPendingRevShare(null)
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

  const billedAnimated = useCountUp(totals.billed)
  const receivedAnimated = useCountUp(totals.received)
  const outstandingAnimated = useCountUp(totals.outstanding)

  const crossOutstandingAnimated = useCountUp(crossSummary?.totalOutstandingCents ?? 0)
  const crossCollectedAnimated = useCountUp(crossSummary?.collectedThisMonthCents ?? 0)
  const crossInvoicedAnimated = useCountUp(crossSummary?.invoicedThisMonthCents ?? 0)
  const crossOverdueAnimated = useCountUp(crossSummary?.facilitiesOverdueCount ?? 0)

  const paymentType = summary?.facility.paymentType ?? null
  const showRevShareRow =
    paymentType === 'rfms' || paymentType === 'facility' || paymentType === 'hybrid'

  const currentRevShare = summary?.facility.qbRevShareType ?? 'we_deduct'
  const effectiveRevShare = pendingRevShare ?? currentRevShare
  const revShareDirty = pendingRevShare !== null && pendingRevShare !== currentRevShare

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
        toast(body?.error ?? 'Failed to send', 'error')
        return
      }
      toast('Statement sent', 'success')
      handleRefresh()
    } catch {
      toast('Network error — please try again', 'error')
    } finally {
      setSendLoading(false)
    }
  }

  async function handleSaveRevShare() {
    if (!summary || !pendingRevShare) return
    setRevShareSaving(true)
    try {
      const res = await fetch(`/api/facilities/${facilityId}/rev-share`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revShareType: pendingRevShare }),
      })
      const body = await res.json()
      if (!res.ok) {
        toast(body?.error ?? 'Could not save', 'error')
        return
      }
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              facility: { ...prev.facility, qbRevShareType: pendingRevShare },
            }
          : prev
      )
      setPendingRevShare(null)
      toast('Saved', 'success')
    } catch {
      toast('Could not save', 'error')
    } finally {
      setRevShareSaving(false)
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

      <h1
        className="text-2xl md:text-3xl text-stone-900 mb-6"
        style={{ fontFamily: 'DM Serif Display, serif' }}
      >
        Billing
      </h1>

      {isMaster ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {crossLoading ? (
            <>
              <div className="skeleton-shimmer rounded-2xl h-20" />
              <div className="skeleton-shimmer rounded-2xl h-20" />
              <div className="skeleton-shimmer rounded-2xl h-20" />
              <div className="skeleton-shimmer rounded-2xl h-20" />
            </>
          ) : crossSummary ? (
            <>
              <div
                className={`bg-white rounded-2xl border border-stone-100 shadow-sm p-4 ${cardHover}`}
              >
                <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-1">
                  Total Outstanding
                </div>
                <div
                  className={
                    crossSummary.totalOutstandingCents > 0
                      ? 'text-xl font-bold text-amber-700'
                      : 'text-xl font-bold text-stone-900'
                  }
                >
                  {formatDollars(crossOutstandingAnimated)}
                </div>
              </div>
              <div
                className={`bg-emerald-50 rounded-2xl border border-emerald-100 shadow-sm p-4 ${cardHover}`}
              >
                <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide mb-1">
                  Collected This Month
                </div>
                <div className="text-xl font-bold text-emerald-800">
                  {formatDollars(crossCollectedAnimated)}
                </div>
              </div>
              <div
                className={`bg-white rounded-2xl border border-stone-100 shadow-sm p-4 ${cardHover}`}
              >
                <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-1">
                  Invoiced This Month
                </div>
                <div className="text-xl font-bold text-stone-900">
                  {formatDollars(crossInvoicedAnimated)}
                </div>
              </div>
              <div
                className={`bg-white rounded-2xl border border-stone-100 shadow-sm p-4 ${cardHover}`}
              >
                <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-1">
                  Facilities Overdue
                </div>
                <div
                  className={
                    crossSummary.facilitiesOverdueCount > 0
                      ? 'text-xl font-bold text-red-600'
                      : 'text-xl font-bold text-stone-900'
                  }
                >
                  {crossOverdueAnimated}
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {isMaster && facilityOptions.length > 1 ? (
        <div className="mb-4">
          <select
            value={facilityId}
            onChange={(e) => setFacilityId(e.target.value)}
            className={`rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 focus:outline-none ${transitionBase}`}
          >
            {facilityOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.facilityCode ? `${f.facilityCode} · ${f.name}` : f.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton-shimmer rounded-2xl h-24" />
          <div className="skeleton-shimmer rounded-2xl h-64" />
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
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6 mb-4">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2
                    className="text-xl md:text-2xl text-stone-900 truncate"
                    style={{ fontFamily: 'DM Serif Display, serif' }}
                  >
                    {summary.facility.name}
                  </h2>
                  {summary.facility.facilityCode ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-stone-100 text-stone-500 font-mono text-[11px]">
                      {summary.facility.facilityCode}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center rounded-full bg-stone-100 text-stone-700 px-2 py-0.5 text-xs font-semibold">
                    {paymentTypeLabel(paymentType)}
                  </span>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                {!contactEmail ? (
                  <input
                    type="email"
                    value={sendEmailOverride}
                    onChange={(e) => setSendEmailOverride(e.target.value)}
                    placeholder="Recipient email…"
                    className={`rounded-xl border border-stone-200 px-3 py-1.5 text-sm text-stone-900 w-56 focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 focus:outline-none ${transitionBase}`}
                  />
                ) : null}
                <button
                  type="button"
                  disabled={sendLoading || !sendToEmail}
                  onClick={() => handleSendStatement(false)}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold bg-[#8B2E4A] text-white hover:bg-[#72253C] disabled:opacity-40 disabled:cursor-not-allowed ${btnBase}`}
                  title={!sendToEmail ? 'Enter a recipient email above' : undefined}
                >
                  {sendLoading ? (
                    <>
                      <svg
                        className="animate-spin h-3.5 w-3.5 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      Sending…
                    </>
                  ) : (
                    'Send Statement'
                  )}
                </button>
                <DisabledActionButton
                  label="Send via QB"
                  title="Available after QB production approval"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
              <StatCard label="Total Billed" value={formatDollars(billedAnimated)} />
              <StatCard label="Total Received" value={formatDollars(receivedAnimated)} />
              <StatCard
                label="Outstanding"
                value={formatDollars(outstandingAnimated)}
                highlight={totals.outstanding > 0 ? 'amber' : 'default'}
              />
            </div>

            {showRevShareRow ? (
              <div className="mt-5 pt-5 border-t border-stone-100">
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
                  Revenue share collected by:
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingRevShare('we_deduct')}
                    disabled={revShareSaving}
                    className={`${btnHubInteractive} rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed ${
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
                    className={`${btnHubInteractive} rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed ${
                      effectiveRevShare === 'facility_deducts'
                        ? 'bg-[#8B2E4A] text-white'
                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                    }`}
                  >
                    Facility
                  </button>
                  {revShareDirty ? (
                    <button
                      type="button"
                      onClick={handleSaveRevShare}
                      disabled={revShareSaving}
                      className={`${successFlash} ${btnBase} rounded-xl px-4 py-2 text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed`}
                    >
                      {revShareSaving ? 'Saving…' : 'Save'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
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
