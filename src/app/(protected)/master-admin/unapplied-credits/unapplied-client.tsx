'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/toast'

export interface CreditRowData {
  id: string
  txnType: string
  txnDate: string
  num: string | null
  amountCents: number
  openBalanceCents: number
  appliedCents: number
  appliedAt: string | null
  facilityId: string
  facilityName: string
  facilityCode: string | null
  residentId: string | null
  residentName: string | null
  roomNumber: string | null
}

interface InvoiceOption {
  id: string
  invoiceNum: string
  invoiceDate: string
  amountCents: number
  openBalanceCents: number
  residentId: string | null
  residentName: string | null
  isResidentMatch: boolean
}

interface MatchProposal {
  creditId: string
  facilityId: string
  facilityName: string
  facilityCode: string | null
  residentName: string | null
  txnDate: string
  num: string | null
  remainingCents: number
  confidence: 'exact' | 'fifo'
  invoices: { id: string; invoiceNum: string; invoiceDate: string; openBalanceCents: number }[]
}

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(iso: string): string {
  return new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function UnappliedClient({
  rows,
  importedAt,
  initialFacilityFilter,
}: {
  rows: CreditRowData[]
  importedAt: string | null
  initialFacilityFilter: string | null
}) {
  const router = useRouter()
  const { toast } = useToast()

  const [facilityFilter, setFacilityFilter] = useState<string | null>(initialFacilityFilter)
  const [showApplied, setShowApplied] = useState(false)

  // Manual apply expansion
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [invoiceOptions, setInvoiceOptions] = useState<InvoiceOption[] | null>(null)
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set())
  const [showAllFacilityInvoices, setShowAllFacilityInvoices] = useState(false)
  const [applying, setApplying] = useState(false)

  // Auto-match
  const [matchLoading, setMatchLoading] = useState(false)
  const [proposals, setProposals] = useState<MatchProposal[] | null>(null)
  const [checkedProposals, setCheckedProposals] = useState<Set<string>>(new Set())
  const [matchApplying, setMatchApplying] = useState(false)

  const visibleRows = useMemo(() => {
    let list = rows
    if (facilityFilter) list = list.filter((r) => r.facilityId === facilityFilter)
    return list
  }, [rows, facilityFilter])

  const groups = useMemo(() => {
    const out: { facilityId: string; name: string; code: string | null; rows: CreditRowData[]; subtotal: number }[] = []
    for (const r of visibleRows) {
      let g = out[out.length - 1]
      if (!g || g.facilityId !== r.facilityId) {
        g = { facilityId: r.facilityId, name: r.facilityName, code: r.facilityCode, rows: [], subtotal: 0 }
        out.push(g)
      }
      g.rows.push(r)
      g.subtotal += Math.max(0, r.openBalanceCents - r.appliedCents)
    }
    return out
  }, [visibleRows])

  const totalRemainingCents = visibleRows.reduce((s, r) => s + Math.max(0, r.openBalanceCents - r.appliedCents), 0)
  const openCount = visibleRows.filter((r) => r.openBalanceCents - r.appliedCents > 0).length
  const appliedCount = visibleRows.length - openCount
  const filterFacilityName = facilityFilter
    ? rows.find((r) => r.facilityId === facilityFilter)?.facilityName ?? null
    : null

  async function toggleExpand(credit: CreditRowData) {
    if (expandedId === credit.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(credit.id)
    setInvoiceOptions(null)
    setSelectedInvoiceIds(new Set())
    setShowAllFacilityInvoices(false)
    setInvoicesLoading(true)
    try {
      const res = await fetch(`/api/super-admin/unapplied-credits/invoices?creditId=${credit.id}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Failed to load invoices')
      setInvoiceOptions(j.data.invoices as InvoiceOption[])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load invoices', 'error')
      setExpandedId(null)
    } finally {
      setInvoicesLoading(false)
    }
  }

  async function handleManualApply(credit: CreditRowData) {
    if (selectedInvoiceIds.size === 0 || applying) return
    setApplying(true)
    try {
      const res = await fetch('/api/super-admin/unapplied-credits/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creditId: credit.id, invoiceIds: Array.from(selectedInvoiceIds) }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Apply failed')
      toast(`Applied ${dollars(j.data.appliedCents)} across ${j.data.allocations.length} invoice${j.data.allocations.length === 1 ? '' : 's'}`, 'success')
      setExpandedId(null)
      router.refresh()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Apply failed', 'error')
    } finally {
      setApplying(false)
    }
  }

  async function handleAutoMatch() {
    if (matchLoading) return
    setMatchLoading(true)
    try {
      const res = await fetch('/api/super-admin/unapplied-credits/auto-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: false, ...(facilityFilter ? { facilityId: facilityFilter } : {}) }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Auto-match failed')
      const props = j.data.proposals as MatchProposal[]
      if (props.length === 0) {
        toast('No exact-amount matches found — apply credits manually below', 'info')
        return
      }
      setProposals(props)
      setCheckedProposals(new Set(props.map((p) => p.creditId)))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Auto-match failed', 'error')
    } finally {
      setMatchLoading(false)
    }
  }

  async function handleApplyMatches() {
    if (!proposals || checkedProposals.size === 0 || matchApplying) return
    setMatchApplying(true)
    try {
      const res = await fetch('/api/super-admin/unapplied-credits/auto-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apply: true,
          creditIds: Array.from(checkedProposals),
          ...(facilityFilter ? { facilityId: facilityFilter } : {}),
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Apply failed')
      toast(`Applied ${j.data.appliedCount} credit${j.data.appliedCount === 1 ? '' : 's'} — ${dollars(j.data.appliedTotalCents)}`, 'success')
      setProposals(null)
      router.refresh()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Apply failed', 'error')
    } finally {
      setMatchApplying(false)
    }
  }

  const selectedSum = invoiceOptions
    ? invoiceOptions.filter((i) => selectedInvoiceIds.has(i.id)).reduce((s, i) => s + i.openBalanceCents, 0)
    : 0

  return (
    <div className="page-enter min-h-screen bg-stone-50 p-6">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/master-admin/imports/quickbooks"
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 mb-6"
        >
          <span>←</span> Back to QuickBooks Imports
        </Link>

        <h1
          className="text-2xl font-normal mb-1"
          style={{ fontFamily: "'DM Serif Display', serif", color: '#8B2E4A' }}
        >
          Unapplied Credits
        </h1>
        <p className="text-sm text-stone-500 mb-1">
          Payments QuickBooks received that were never applied to an invoice. Apply them here —
          automatically when amounts line up, or by picking invoices manually.
        </p>
        <p className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
          Applying here updates <strong>website balances only</strong>. Mirror each application inside
          QuickBooks (open the customer → Receive Payment → apply the credit) — the next Invoice History
          import syncs balances from QB and will revert anything not mirrored there.
        </p>
        {importedAt && (
          <p className="text-[11.5px] text-stone-400 mb-6">
            Snapshot imported {formatDate(importedAt)} — re-run Step 5 after applying credits in QuickBooks to refresh this list.
          </p>
        )}

        {facilityFilter && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-[10.5px] font-semibold px-2.5 py-1 rounded-full bg-rose-50 text-[#8B2E4A] border border-rose-100">
              {filterFacilityName ?? 'Filtered facility'}
            </span>
            <button
              type="button"
              onClick={() => setFacilityFilter(null)}
              className="text-xs text-stone-500 underline hover:text-stone-700"
            >
              Show all facilities
            </button>
          </div>
        )}

        {visibleRows.length === 0 ? (
          <div className="rounded-[18px] border border-stone-200 bg-white shadow-[var(--shadow-sm)] p-8 text-center">
            <p className="text-sm font-semibold text-stone-700 mb-1">No unapplied credits</p>
            <p className="text-xs text-stone-500">
              Either everything is applied, or the Step 5 import hasn&apos;t been run yet.{' '}
              <Link href="/master-admin/imports/quickbooks#step-5" className="text-[#8B2E4A] font-semibold">
                Run the import →
              </Link>
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-[18px] border border-rose-100 bg-rose-50 px-5 py-4 mb-6 flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <span className="text-xl font-bold text-[#8B2E4A]">{dollars(totalRemainingCents)}</span>
                <span className="text-xs text-stone-500 ml-2">still unapplied</span>
              </div>
              <div className="text-xs text-stone-500">
                {openCount} open credit{openCount === 1 ? '' : 's'} across {groups.filter((g) => g.subtotal > 0).length} facilit{groups.filter((g) => g.subtotal > 0).length === 1 ? 'y' : 'ies'}
                {appliedCount > 0 && <> · {appliedCount} applied on site</>}
              </div>
              <button
                type="button"
                onClick={handleAutoMatch}
                disabled={matchLoading || openCount === 0}
                className="ml-auto text-xs font-semibold px-4 py-2 rounded-xl bg-[#8B2E4A] text-white shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:-translate-y-[1px] hover:shadow-[0_4px_10px_rgba(139,46,74,0.28)] disabled:opacity-40 disabled:shadow-none disabled:translate-y-0 transition-all"
              >
                {matchLoading ? 'Matching…' : '✨ Auto-match'}
              </button>
            </div>

            {appliedCount > 0 && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={() => setShowApplied((v) => !v)}
                  className="text-xs font-semibold text-stone-500 hover:text-stone-700"
                >
                  {showApplied ? '▾ Hide' : '▸ Show'} applied credits ({appliedCount})
                </button>
              </div>
            )}

            <div className="space-y-4">
              {groups.map((g) => {
                const groupRows = g.rows.filter((r) => showApplied || r.openBalanceCents - r.appliedCents > 0)
                if (groupRows.length === 0) return null
                return (
                  <div key={g.facilityId} className="rounded-[18px] border border-stone-200 bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 bg-stone-50/60 border-b border-stone-100">
                      <div className="flex items-center gap-2 min-w-0">
                        {g.code && <span className="text-stone-400 font-mono text-xs shrink-0">{g.code}</span>}
                        <span className="text-[13.5px] font-semibold text-stone-900 truncate">{g.name}</span>
                      </div>
                      <span className="text-sm font-bold text-[#8B2E4A] shrink-0 ml-3">{dollars(g.subtotal)}</span>
                    </div>
                    <div className="divide-y divide-stone-50">
                      {groupRows.map((r) => {
                        const remaining = r.openBalanceCents - r.appliedCents
                        const fullyApplied = remaining <= 0
                        const expanded = expandedId === r.id
                        return (
                          <div key={r.id}>
                            <div className="grid grid-cols-[90px_1fr_auto] md:grid-cols-[100px_1fr_110px_110px_84px] items-center gap-3 px-5 py-2.5 hover:bg-[#F9EFF2] transition-colors duration-[120ms]">
                              <span className="text-xs text-stone-500">{formatDate(r.txnDate)}</span>
                              <span className="text-xs text-stone-700 truncate">
                                {r.residentName
                                  ? <>{r.residentName}{r.roomNumber && <span className="text-stone-400"> · Rm {r.roomNumber}</span>}</>
                                  : <span className="text-stone-400">Facility-level payment</span>}
                                {r.num && <span className="text-stone-400 font-mono text-[11px] ml-1.5">#{r.num}</span>}
                                {fullyApplied && (
                                  <span className="ml-2 text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    ✓ Applied{r.appliedAt ? ` ${formatDate(r.appliedAt)}` : ''}
                                  </span>
                                )}
                                {!fullyApplied && r.appliedCents > 0 && (
                                  <span className="ml-2 text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                    partially applied
                                  </span>
                                )}
                              </span>
                              <span className="hidden md:block text-xs text-stone-400 text-right">
                                {r.amountCents !== r.openBalanceCents && <>of {dollars(r.amountCents)}</>}
                              </span>
                              <span className={`text-xs font-semibold text-right ${fullyApplied ? 'text-stone-400 line-through' : 'text-stone-900'}`}>
                                {dollars(fullyApplied ? r.openBalanceCents : remaining)}
                              </span>
                              <span className="hidden md:flex justify-end">
                                {!fullyApplied && (
                                  <button
                                    type="button"
                                    onClick={() => void toggleExpand(r)}
                                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
                                  >
                                    {expanded ? 'Close' : 'Apply…'}
                                  </button>
                                )}
                              </span>
                            </div>

                            {expanded && (
                              <div className="px-5 pb-4 pt-1 bg-stone-50/40 border-t border-stone-100">
                                {invoicesLoading ? (
                                  <p className="text-xs text-stone-400 py-3 animate-pulse">Loading open invoices…</p>
                                ) : invoiceOptions && invoiceOptions.length === 0 ? (
                                  <p className="text-xs text-stone-400 py-3">No open invoices at this facility.</p>
                                ) : invoiceOptions ? (
                                  <>
                                    <p className="text-[11px] text-stone-500 pt-2 pb-1.5">
                                      Pick the invoice{remaining > 0 ? 's' : ''} this {dollars(remaining)} payment covers — oldest first.
                                    </p>
                                    <div className="space-y-1 max-h-64 overflow-y-auto">
                                      {invoiceOptions
                                        .filter((inv) => inv.isResidentMatch || showAllFacilityInvoices || !r.residentId)
                                        .map((inv) => (
                                          <label
                                            key={inv.id}
                                            className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-white border border-stone-100 cursor-pointer hover:border-rose-200 transition-colors"
                                          >
                                            <input
                                              type="checkbox"
                                              className="accent-[#8B2E4A]"
                                              checked={selectedInvoiceIds.has(inv.id)}
                                              onChange={(e) => {
                                                setSelectedInvoiceIds((prev) => {
                                                  const next = new Set(prev)
                                                  if (e.target.checked) next.add(inv.id)
                                                  else next.delete(inv.id)
                                                  return next
                                                })
                                              }}
                                            />
                                            <span className="text-xs text-stone-700 flex-1 truncate">
                                              <span className="font-mono text-[11px] text-stone-400 mr-1.5">{inv.invoiceNum}</span>
                                              {formatDate(inv.invoiceDate)}
                                              {!inv.isResidentMatch && inv.residentName && (
                                                <span className="text-stone-400"> · {inv.residentName}</span>
                                              )}
                                            </span>
                                            <span className="text-xs font-semibold text-stone-900">{dollars(inv.openBalanceCents)}</span>
                                          </label>
                                        ))}
                                    </div>
                                    {r.residentId && invoiceOptions.some((i) => !i.isResidentMatch) && !showAllFacilityInvoices && (
                                      <button
                                        type="button"
                                        onClick={() => setShowAllFacilityInvoices(true)}
                                        className="mt-2 text-[11px] text-stone-500 underline hover:text-stone-700"
                                      >
                                        Show all facility invoices ({invoiceOptions.filter((i) => !i.isResidentMatch).length} more)
                                      </button>
                                    )}
                                    <div className="mt-3 flex items-center gap-3">
                                      <span className={`text-xs font-semibold ${selectedSum === remaining ? 'text-emerald-700' : selectedSum > remaining ? 'text-amber-700' : 'text-stone-600'}`}>
                                        Selected {dollars(selectedSum)} of {dollars(remaining)}
                                        {selectedSum > remaining && ' — oldest invoices are paid first; the last one will be partial'}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => void handleManualApply(r)}
                                        disabled={selectedInvoiceIds.size === 0 || applying}
                                        className="ml-auto text-xs font-semibold px-4 py-2 rounded-xl bg-[#8B2E4A] text-white disabled:opacity-40 transition-all"
                                      >
                                        {applying ? 'Applying…' : 'Apply credit'}
                                      </button>
                                    </div>
                                  </>
                                ) : null}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* Auto-match preview modal */}
        {proposals && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setProposals(null)}>
            <div
              className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-stone-100 shrink-0">
                <h2 className="text-base font-semibold text-stone-900">
                  {proposals.length} match{proposals.length === 1 ? '' : 'es'} found
                </h2>
                <p className="text-xs text-stone-500 mt-0.5">
                  Each credit&apos;s remaining amount equals the open balance of the invoice(s) shown.
                  Double-check, uncheck anything that looks wrong, then apply.
                </p>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-2">
                {proposals.map((p) => (
                  <label
                    key={p.creditId}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-xl border border-stone-100 bg-white cursor-pointer hover:border-rose-200 transition-colors"
                  >
                    <input
                      type="checkbox"
                      className="accent-[#8B2E4A] mt-0.5"
                      checked={checkedProposals.has(p.creditId)}
                      onChange={(e) => {
                        setCheckedProposals((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(p.creditId)
                          else next.delete(p.creditId)
                          return next
                        })
                      }}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs text-stone-900">
                        {p.facilityCode && <span className="font-mono text-[11px] text-stone-400 mr-1">{p.facilityCode}</span>}
                        <span className="font-semibold">{p.residentName ?? 'Facility payment'}</span>
                        <span className="text-stone-500"> · {formatDate(p.txnDate)}{p.num ? ` · #${p.num}` : ''}</span>
                        <span className={`ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${p.confidence === 'exact' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                          {p.confidence === 'exact' ? 'exact amount' : `${p.invoices.length} invoices, exact total`}
                        </span>
                      </span>
                      <span className="block text-[11px] text-stone-500 mt-1">
                        {dollars(p.remainingCents)} → {p.invoices.map((i) => `${i.invoiceNum} (${dollars(i.openBalanceCents)})`).join(', ')}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="px-5 py-4 border-t border-stone-100 shrink-0 flex items-center gap-3">
                <span className="text-xs text-stone-500">
                  {checkedProposals.size} selected ·{' '}
                  {dollars(proposals.filter((p) => checkedProposals.has(p.creditId)).reduce((s, p) => s + p.remainingCents, 0))}
                </span>
                <button
                  type="button"
                  onClick={() => setProposals(null)}
                  className="ml-auto text-xs font-semibold px-4 py-2 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleApplyMatches()}
                  disabled={checkedProposals.size === 0 || matchApplying}
                  className="text-xs font-semibold px-4 py-2 rounded-xl bg-[#8B2E4A] text-white shadow-[0_2px_6px_rgba(139,46,74,0.22)] disabled:opacity-40 disabled:shadow-none transition-all"
                >
                  {matchApplying ? 'Applying…' : `Apply ${checkedProposals.size} match${checkedProposals.size === 1 ? '' : 'es'}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
