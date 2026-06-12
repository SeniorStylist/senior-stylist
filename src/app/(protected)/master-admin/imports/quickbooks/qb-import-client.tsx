'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'

// ── Stat formatting ──────────────────────────────────────────────────────────

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type StatDef = { key: string; label: string; isDollars?: boolean; highlight?: boolean }

const IMPORTERS: {
  id: string
  step: number
  title: string
  qbReport: string
  endpoint: string
  description: string
  detail: string
  stats: StatDef[]
}[] = [
  {
    id: 'contacts',
    step: 1,
    title: 'Customer Contacts',
    qbReport: 'Customer Contact List',
    endpoint: '/api/super-admin/qb-import/contacts',
    description: 'Syncs resident POA emails, phones, and contact names from QuickBooks.',
    detail:
      'Matches customers to residents by their QB customer ID. Customers that match an existing resident by name (85%+ similarity) are merged — the resident is linked to QuickBooks instead of duplicated. Brand-new customers are created as residents. Run this FIRST so the other imports can match residents.',
    stats: [
      { key: 'residentsUpdated', label: 'Contacts updated' },
      { key: 'residentsLinked', label: 'Merged with existing' },
      { key: 'residentsCreated', label: 'New residents created' },
      { key: 'facilitiesUpdated', label: 'Facilities updated' },
      { key: 'skippedNoFacility', label: 'Skipped (no facility)' },
    ],
  },
  {
    id: 'invoices',
    step: 2,
    title: 'Invoice History',
    qbReport: 'Invoice List by Date',
    endpoint: '/api/super-admin/qb-import/invoices',
    description: 'The authoritative source for every invoice and its open balance.',
    detail:
      'Upserts the full invoice history and recalculates outstanding balances for every facility and resident — this is what fixes the Total Outstanding number on the Billing page. Safe to re-run any time; existing invoices are updated in place.',
    stats: [
      { key: 'created', label: 'Invoices created' },
      { key: 'updated', label: 'Invoices updated' },
      { key: 'residentMatched', label: 'Linked to residents' },
      { key: 'residentUnmatched', label: 'Resident not found' },
      { key: 'totalOpenCents', label: 'Total outstanding', isDollars: true, highlight: true },
    ],
  },
  {
    id: 'payments',
    step: 3,
    title: 'Received Payments',
    qbReport: 'Invoices and Received Payments',
    endpoint: '/api/super-admin/qb-import/payments',
    description: 'Imports every received payment, attributed to the right resident.',
    detail:
      'Duplicate-proof: payments that already exist (same facility, resident, date, and amount) are skipped, and resident payments that match an older facility-level record upgrade it in place instead of double-counting. Safe to re-run.',
    stats: [
      { key: 'paymentsCreated', label: 'Payments created' },
      { key: 'duplicatesSkipped', label: 'Duplicates skipped' },
      { key: 'upgraded', label: 'Upgraded to resident-level' },
      { key: 'unresolvedSections', label: 'Customers unmatched' },
      { key: 'totalReceivedCents', label: 'Total received in file', isDollars: true, highlight: true },
    ],
  },
  {
    id: 'transactions',
    step: 4,
    title: 'Transaction Memos',
    qbReport: 'Transaction List by Customer',
    endpoint: '/api/super-admin/qb-import/payments',
    description: 'Optional — adds check memos and facility-level payment detail.',
    detail:
      'Uses the same duplicate-proof engine as step 3, so payments already imported are recognized and only enriched with their memos (check numbers, ACH notes). Run after step 3.',
    stats: [
      { key: 'paymentsCreated', label: 'Payments created' },
      { key: 'duplicatesSkipped', label: 'Already imported' },
      { key: 'memoEnriched', label: 'Memos added' },
      { key: 'unresolvedSections', label: 'Customers unmatched' },
    ],
  },
]

type CardState = 'idle' | 'uploading' | 'done' | 'error'

interface CardResult {
  [key: string]: unknown
  warnings?: string[]
}

function ImporterCard({ importer }: { importer: typeof IMPORTERS[number] }) {
  const [file, setFile] = useState<File | null>(null)
  const [state, setState] = useState<CardState>('idle')
  const [result, setResult] = useState<CardResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showWarnings, setShowWarnings] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function runImport() {
    if (!file || state === 'uploading') return
    setState('uploading')
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(importer.endpoint, { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Import failed (${res.status})`)
      setResult(json.data)
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setState('error')
    }
  }

  const warnings = (result?.warnings ?? []) as string[]

  return (
    <div className="rounded-[18px] border border-stone-200 bg-white shadow-[var(--shadow-sm)] p-5">
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-9 h-9 rounded-full bg-rose-50 text-[#8B2E4A] flex items-center justify-center text-sm font-bold">
          {importer.step}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-stone-900">{importer.title}</h3>
            <span className="text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-600">
              QB report: {importer.qbReport}
            </span>
            {importer.step === 4 && (
              <span className="text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full bg-stone-50 text-stone-400 border border-stone-200">
                Optional
              </span>
            )}
          </div>
          <p className="text-xs text-stone-600 mb-1">{importer.description}</p>
          <p className="text-[11.5px] text-stone-400 leading-relaxed mb-4">{importer.detail}</p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                if (state === 'done' || state === 'error') { setState('idle'); setResult(null); setError(null) }
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-xs font-semibold px-3.5 py-2 rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-50 transition-colors"
            >
              {file ? file.name : 'Choose CSV…'}
            </button>
            <button
              type="button"
              onClick={runImport}
              disabled={!file || state === 'uploading'}
              className="text-xs font-semibold px-4 py-2 rounded-xl bg-[#8B2E4A] text-white shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:-translate-y-[1px] hover:shadow-[0_4px_10px_rgba(139,46,74,0.28)] disabled:opacity-40 disabled:shadow-none disabled:translate-y-0 transition-all"
            >
              {state === 'uploading' ? 'Importing…' : 'Import'}
            </button>
            {state === 'uploading' && (
              <span className="text-[11.5px] text-stone-400 animate-pulse">Processing — large files can take a minute…</span>
            )}
          </div>

          {state === 'error' && error && (
            <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {state === 'done' && result && (
            <div className="mt-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {importer.stats.map((s) => {
                  const raw = result[s.key]
                  if (raw == null) return null
                  const value = s.isDollars ? formatDollars(Number(raw)) : String(raw)
                  return (
                    <div
                      key={s.key}
                      className={`rounded-xl px-3 py-2 border ${
                        s.highlight
                          ? 'bg-rose-50 border-rose-100'
                          : 'bg-stone-50 border-stone-100'
                      }`}
                    >
                      <div className={`text-sm font-bold ${s.highlight ? 'text-[#8B2E4A]' : 'text-stone-900'}`}>{value}</div>
                      <div className="text-[10.5px] text-stone-500">{s.label}</div>
                    </div>
                  )
                })}
              </div>
              {warnings.length > 0 && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowWarnings((v) => !v)}
                    className="text-[11.5px] font-semibold text-amber-700"
                  >
                    {showWarnings ? '▾' : '▸'} {warnings.length} warning{warnings.length === 1 ? '' : 's'}
                  </button>
                  {showWarnings && (
                    <div className="mt-2 max-h-48 overflow-y-auto rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 space-y-1">
                      {warnings.map((w, i) => (
                        <p key={i} className="text-[11px] text-amber-800">{w}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function QbImportClient() {
  return (
    <div className="page-enter min-h-screen bg-stone-50 p-6">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/master-admin/imports"
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 mb-6"
        >
          <span>←</span> Back to Imports
        </Link>

        <h1
          className="text-2xl font-normal mb-1"
          style={{ fontFamily: "'DM Serif Display', serif", color: '#8B2E4A' }}
        >
          QuickBooks Imports
        </h1>
        <p className="text-sm text-stone-500 mb-2">
          Bring your full QuickBooks billing history into Senior Stylist — customers, invoices, and payments.
        </p>
        <p className="text-[11.5px] text-stone-400 mb-8">
          Export each report from QuickBooks Online (Reports → search the report name → Export to CSV), then run the
          steps in order. Every importer is safe to re-run — records are matched and updated, never duplicated.
        </p>

        <div className="space-y-4">
          {IMPORTERS.map((imp) => (
            <ImporterCard key={imp.id} importer={imp} />
          ))}
        </div>
      </div>
    </div>
  )
}
