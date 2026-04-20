'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { btnBase, transitionBase } from '@/lib/animations'
import { formatDollars, BillingResident } from '../views/billing-shared'

type Confidence = 'high' | 'medium' | 'low'
type MatchConfidence = Confidence | 'none'

interface FieldValue<T> {
  value: T | null
  confidence: Confidence
}

interface FacilityOption {
  id: string
  name: string
  facilityCode: string | null
}

interface FacilityMatch {
  facilityId: string | null
  name: string | null
  facilityCode: string | null
  confidence: MatchConfidence
}

interface ResidentMatchLine {
  rawName: string
  amountCents: number
  serviceCategory: string | null
  residentId: string | null
  residentName: string | null
  matchConfidence: MatchConfidence
}

interface InvoiceMatch {
  confidence: 'high' | 'partial' | 'none'
  matchedInvoiceIds: string[]
  totalOpenCents: number
  remainingCents: number
}

export interface ScanResult {
  imageUrl: string | null
  storagePath: string | null
  unresolvable: boolean
  unresolvableReason: string | null
  documentType: string
  extracted: {
    checkNum: FieldValue<string>
    checkDate: FieldValue<string>
    amountCents: FieldValue<number>
    payerName: FieldValue<string>
    payerAddress: FieldValue<string>
    invoiceRef: FieldValue<string>
    invoiceDate: FieldValue<string>
    memo: FieldValue<string>
  } | null
  facilityMatch: FacilityMatch
  residentMatches: ResidentMatchLine[]
  invoiceMatch: InvoiceMatch
  rawOcrJson: Record<string, unknown>
  overallConfidence: Confidence
}

type Step = 'upload' | 'confirm' | 'success'
type PaymentMethod = 'check' | 'cash' | 'ach' | 'other'

interface EditableLine {
  rawName: string
  amountCents: number
  residentId: string | null
  residentName: string | null
  matchConfidence: MatchConfidence
}

const ALLOWED = 'image/jpeg,image/png,image/webp,image/heic,image/heif'

function confidenceBadge(conf: MatchConfidence): string {
  if (conf === 'high') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (conf === 'medium') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (conf === 'low') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-stone-100 text-stone-500 border-stone-200'
}

function parseDollarsToCents(raw: string): number {
  const cleaned = raw.replace(/[^\d.-]/g, '')
  const n = parseFloat(cleaned)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return ''
  return (cents / 100).toFixed(2)
}

export function ScanCheckModal({
  open,
  facilityId,
  facilityPaymentType,
  facilities,
  residents,
  resolveFromUnresolvedId,
  resolveFromUnresolvedData,
  onClose,
  onSuccess,
}: {
  open: boolean
  facilityId: string
  facilityPaymentType: string | null
  facilities: FacilityOption[]
  residents: BillingResident[]
  isMaster: boolean
  resolveFromUnresolvedId?: string
  resolveFromUnresolvedData?: ScanResult
  onClose: () => void
  onSuccess: () => void
}) {
  const { toast } = useToast()
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const savedSummary = useRef<{ facility: string; amount: number; date: string; method: string } | null>(null)

  // Editable state after scan
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null)
  const [checkNum, setCheckNum] = useState('')
  const [checkDate, setCheckDate] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [memo, setMemo] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('check')
  const [lines, setLines] = useState<EditableLine[]>([])
  const [cashEnabled, setCashEnabled] = useState(false)
  const [cashInput, setCashInput] = useState('')

  // Initialize from scan result (or from resolve-from-unresolved data)
  useEffect(() => {
    if (!open) return
    if (resolveFromUnresolvedData) {
      setResult(resolveFromUnresolvedData)
      applyResultToState(resolveFromUnresolvedData)
      setStep('confirm')
    } else {
      setStep('upload')
      setResult(null)
      resetEditState()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resolveFromUnresolvedData])

  function resetEditState() {
    setFile(null)
    setPreviewUrl(null)
    setSelectedFacilityId(null)
    setCheckNum('')
    setCheckDate('')
    setInvoiceRef('')
    setInvoiceDate('')
    setAmountInput('')
    setMemo('')
    setPaymentMethod('check')
    setLines([])
    setCashEnabled(false)
    setCashInput('')
  }

  function applyResultToState(r: ScanResult) {
    setSelectedFacilityId(r.facilityMatch.facilityId)
    const ex = r.extracted
    setCheckNum(ex?.checkNum.value ?? '')
    setCheckDate(ex?.checkDate.value ?? '')
    setInvoiceRef(ex?.invoiceRef.value ?? '')
    setInvoiceDate(ex?.invoiceDate.value ?? '')
    setAmountInput(centsToInput(ex?.amountCents.value ?? 0))
    setMemo(ex?.memo.value ?? '')
    setLines(
      r.residentMatches.map((m) => ({
        rawName: m.rawName,
        amountCents: m.amountCents,
        residentId: m.residentId,
        residentName: m.residentName,
        matchConfidence: m.matchConfidence,
      })),
    )
  }

  async function handleScan() {
    if (!file) return
    setScanning(true)
    try {
      const fd = new FormData()
      fd.append('image', file)
      fd.append('facilityId', facilityId)
      const res = await fetch('/api/billing/scan-check', { method: 'POST', body: fd })
      const body = await res.json()
      if (!res.ok) {
        toast(body?.error ?? 'Scan failed', 'error')
        return
      }
      const data = body.data as ScanResult
      setResult(data)
      applyResultToState(data)
      setStep('confirm')
      if (data.unresolvable) {
        toast(data.unresolvableReason ?? 'Could not read the check', 'info')
      }
    } catch {
      toast('Network error during scan', 'error')
    } finally {
      setScanning(false)
    }
  }

  const amountCents = useMemo(() => parseDollarsToCents(amountInput), [amountInput])
  const cashCents = useMemo(
    () => (cashEnabled ? parseDollarsToCents(cashInput) : 0),
    [cashEnabled, cashInput],
  )
  const linesTotal = useMemo(() => lines.reduce((s, l) => s + (l.amountCents || 0), 0), [lines])
  const totalMatches = lines.length === 0 || linesTotal + cashCents === amountCents
  const hasUnmatchedLine = lines.some((l) => !l.residentId)

  const isRFMSLike = facilityPaymentType === 'rfms' || facilityPaymentType === 'facility' || facilityPaymentType === 'hybrid'

  async function handleSave(mode: 'resolve' | 'save_unresolved') {
    if (!result && mode === 'resolve') return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        mode,
        facilityId,
        matchedFacilityId: selectedFacilityId ?? null,
        storagePath: result?.storagePath ?? null,
        paymentMethod,
        paymentType: facilityPaymentType,
        checkNum: checkNum || null,
        checkDate: checkDate || null,
        paymentDate: checkDate || new Date().toISOString().slice(0, 10),
        amountCents,
        memo: memo || null,
        invoiceRef: invoiceRef || null,
        invoiceDate: invoiceDate || null,
        matchedInvoiceIds: result?.invoiceMatch.matchedInvoiceIds ?? [],
        invoiceMatchConfidence: result?.invoiceMatch.confidence ?? 'none',
        unresolvedId: resolveFromUnresolvedId,
      }

      if (mode === 'resolve') {
        const residentLines = lines.map((l) => ({
          name: l.residentName ?? l.rawName,
          residentId: l.residentId,
          amountCents: l.amountCents,
          matchConfidence: l.matchConfidence,
        }))
        if (facilityPaymentType === 'ip') {
          body.residentPayments = residentLines
        } else if (isRFMSLike) {
          body.residentBreakdown = residentLines
        }
        if (cashCents > 0) {
          body.cashAlsoReceivedCents = cashCents
          body.cashAttributionResidentId = lines[0]?.residentId ?? null
        }
      } else {
        body.extracted = {
          rawOcrJson: result?.rawOcrJson ?? {},
          extractedCheckNum: checkNum || undefined,
          extractedCheckDate: checkDate || undefined,
          extractedAmountCents: amountCents,
          extractedPayerName: result?.extracted?.payerName.value ?? undefined,
          extractedInvoiceRef: invoiceRef || undefined,
          extractedInvoiceDate: invoiceDate || undefined,
          extractedResidentLines: lines.map((l) => ({
            rawName: l.rawName,
            amountCents: l.amountCents,
            residentId: l.residentId,
            matchConfidence: l.matchConfidence,
          })),
          confidenceOverall: result?.overallConfidence,
          unresolvedReason:
            result?.unresolvableReason ?? (hasUnmatchedLine ? 'Unmatched residents' : 'Manual save'),
        }
      }

      const res = await fetch('/api/billing/save-check-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        toast(json?.error ?? 'Could not save', 'error')
        return
      }

      const facilityName =
        facilities.find((f) => f.id === (selectedFacilityId ?? facilityId))?.name ?? ''
      savedSummary.current = {
        facility: facilityName,
        amount: amountCents + cashCents,
        date: checkDate || new Date().toISOString().slice(0, 10),
        method: paymentMethod,
      }
      setStep('success')
    } catch {
      toast('Network error — please try again', 'error')
    } finally {
      setSaving(false)
    }
  }

  function handleDone() {
    onSuccess()
    onClose()
  }

  function handleScanAnother() {
    setStep('upload')
    setResult(null)
    resetEditState()
  }

  // Upload-step file handler
  function handleFilePick(f: File | null) {
    setFile(f)
    if (f) {
      const url = URL.createObjectURL(f)
      setPreviewUrl(url)
    } else {
      setPreviewUrl(null)
    }
  }

  const canRecord =
    !!selectedFacilityId &&
    !hasUnmatchedLine &&
    totalMatches &&
    amountCents > 0 &&
    !saving

  return (
    <Modal open={open} onClose={onClose} className="max-w-3xl">
      <div className="p-6">
        {step === 'upload' &&
          (scanning ? (
            <div className="py-16 text-center">
              <div className="inline-block rounded-2xl bg-[#8B2E4A]/10 p-4 mb-4">
                <svg
                  className="animate-spin h-8 w-8 text-[#8B2E4A]"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <p className="text-base font-semibold text-stone-900">Scanning check…</p>
              <p className="mt-1 text-sm text-stone-500">Extracting fields with OCR.</p>
            </div>
          ) : (
            <div>
              <h2
                className="text-xl text-stone-900 mb-1"
                style={{ fontFamily: 'DM Serif Display, serif' }}
              >
                Scan Check
              </h2>
              <p className="text-sm text-stone-500 mb-5">
                Upload a photo or scan of a paper check. We&apos;ll extract the fields and let you review.
              </p>

              {previewUrl ? (
                <div className="rounded-2xl border border-stone-200 p-3 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="Check preview" className="w-16 h-16 object-cover rounded-xl" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-900 truncate">{file?.name}</p>
                    <p className="text-xs text-stone-500">
                      {file ? `${Math.round((file.size / 1024 / 1024) * 10) / 10} MB` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleFilePick(null)}
                    className={`${btnBase} text-xs text-stone-500 hover:text-stone-700`}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl border-2 border-dashed border-stone-200 p-8 text-center">
                  <p className="text-sm text-stone-600 mb-4">Choose a check image to scan</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <label
                      className={`${btnBase} md:hidden inline-flex items-center gap-2 rounded-xl bg-[#8B2E4A] text-white px-4 py-2 text-sm font-semibold cursor-pointer hover:bg-[#72253C]`}
                    >
                      Take Photo
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => handleFilePick(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    <label
                      className={`${btnBase} inline-flex items-center gap-2 rounded-xl bg-stone-100 text-stone-700 px-4 py-2 text-sm font-semibold cursor-pointer hover:bg-stone-200`}
                    >
                      Choose File
                      <input
                        type="file"
                        accept={ALLOWED}
                        className="hidden"
                        onChange={(e) => handleFilePick(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  </div>
                  <p className="mt-4 text-[11px] text-stone-400">
                    JPEG · PNG · WEBP · HEIC · max 10 MB
                  </p>
                </div>
              )}

              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className={`${btnBase} rounded-xl px-4 py-2 text-sm text-stone-700 hover:bg-stone-100`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!file}
                  onClick={handleScan}
                  className={`${btnBase} inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold bg-[#8B2E4A] text-white hover:bg-[#72253C] disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  Scan
                </button>
              </div>
            </div>
          ))}

        {step === 'confirm' && result && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2
                className="text-xl text-stone-900"
                style={{ fontFamily: 'DM Serif Display, serif' }}
              >
                Confirm Check Details
              </h2>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${confidenceBadge(
                  result.overallConfidence,
                )}`}
              >
                {result.overallConfidence.toUpperCase()} confidence
              </span>
            </div>

            {result.unresolvable ? (
              <div className="mb-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                <strong>Could not read automatically.</strong> {result.unresolvableReason ?? ''}{' '}
                Save as Unresolved and revisit later.
              </div>
            ) : null}

            <div className="grid md:grid-cols-2 gap-5">
              <div className="rounded-2xl border border-stone-100 bg-stone-50 p-2 max-h-[540px] overflow-y-auto">
                {result.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={result.imageUrl}
                    alt="Scanned check"
                    className="w-full rounded-xl"
                  />
                ) : (
                  <p className="text-sm text-stone-500 p-4">No preview available.</p>
                )}
              </div>

              <div className="space-y-3">
                {/* Facility */}
                <div>
                  <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-1">
                    Facility
                  </label>
                  <select
                    value={selectedFacilityId ?? ''}
                    onChange={(e) => setSelectedFacilityId(e.target.value || null)}
                    className={`w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 focus:outline-none ${transitionBase}`}
                  >
                    <option value="">— Select a facility —</option>
                    {facilities.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.facilityCode ? `${f.facilityCode} · ${f.name}` : f.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-stone-500">
                    Matched: {result.facilityMatch.name ?? '—'} ({result.facilityMatch.confidence})
                  </p>
                </div>

                {/* Check fields */}
                <div className="grid grid-cols-2 gap-3">
                  <FieldInput
                    label="Check #"
                    value={checkNum}
                    onChange={setCheckNum}
                    confidence={result.extracted?.checkNum.confidence}
                  />
                  <FieldInput
                    label="Check Date"
                    type="date"
                    value={checkDate}
                    onChange={setCheckDate}
                    confidence={result.extracted?.checkDate.confidence}
                  />
                </div>
                <FieldInput
                  label="Amount"
                  value={amountInput}
                  onChange={setAmountInput}
                  confidence={result.extracted?.amountCents.confidence}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FieldInput
                    label="Invoice Ref"
                    value={invoiceRef}
                    onChange={setInvoiceRef}
                    confidence={result.extracted?.invoiceRef.confidence}
                  />
                  <FieldInput
                    label="Invoice Date"
                    type="date"
                    value={invoiceDate}
                    onChange={setInvoiceDate}
                    confidence={result.extracted?.invoiceDate.confidence}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-1">
                    Memo
                  </label>
                  <textarea
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    rows={2}
                    className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 focus:outline-none"
                  />
                </div>

                {/* Payment method pills */}
                <div>
                  <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-1">
                    Payment Method
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {(['check', 'cash', 'ach', 'other'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPaymentMethod(m)}
                        className={`${btnBase} rounded-full px-3 py-1 text-xs font-semibold ${
                          paymentMethod === m
                            ? 'bg-[#8B2E4A] text-white'
                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                      >
                        {m.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Resident lines */}
            {lines.length > 0 && (
              <div className="mt-5">
                <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
                  Resident Lines
                </h3>
                <div className="rounded-2xl border border-stone-100 overflow-hidden">
                  {lines.map((l, i) => (
                    <ResidentRow
                      key={i}
                      line={l}
                      residents={residents}
                      onChange={(next) => {
                        const copy = [...lines]
                        copy[i] = next
                        setLines(copy)
                      }}
                      onRemove={() => setLines(lines.filter((_, idx) => idx !== i))}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Cash also received */}
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <label className="inline-flex items-center gap-2 text-stone-700">
                <input
                  type="checkbox"
                  checked={cashEnabled}
                  onChange={(e) => setCashEnabled(e.target.checked)}
                  className="accent-[#8B2E4A]"
                />
                Cash also received
              </label>
              {cashEnabled && (
                <input
                  type="text"
                  value={cashInput}
                  onChange={(e) => setCashInput(e.target.value)}
                  placeholder="0.00"
                  className="w-24 rounded-xl border border-stone-200 px-2 py-1 text-sm focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 focus:outline-none"
                />
              )}
            </div>

            {/* Invoice match */}
            {result.invoiceMatch.confidence === 'high' && (
              <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-sm text-emerald-800">
                Matches an open invoice exactly — {formatDollars(amountCents)} will be cleared on save.
              </div>
            )}
            {result.invoiceMatch.confidence === 'partial' && (
              <div className="mt-4 rounded-xl bg-amber-50 border border-amber-100 p-3 text-sm text-amber-800">
                Partial payment — {formatDollars(amountCents)} of{' '}
                {formatDollars(result.invoiceMatch.totalOpenCents)} open.{' '}
                {formatDollars(result.invoiceMatch.remainingCents)} will remain outstanding.
              </div>
            )}
            {result.invoiceMatch.confidence === 'none' && amountCents > 0 && (
              <div className="mt-4 rounded-xl bg-stone-50 border border-stone-100 p-3 text-sm text-stone-600">
                No matching invoice — payment will be recorded without invoice decrement.
              </div>
            )}

            {/* Totals invariant */}
            {!totalMatches && lines.length > 0 && (
              <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                Line items total {formatDollars(linesTotal + cashCents)} but check amount is{' '}
                {formatDollars(amountCents)}. Adjust before saving.
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className={`${btnBase} rounded-xl px-4 py-2 text-sm text-stone-700 hover:bg-stone-100`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSave('save_unresolved')}
                className={`${btnBase} rounded-xl px-4 py-2 text-sm font-semibold bg-stone-200 text-stone-700 hover:bg-stone-300 disabled:opacity-40`}
              >
                Save as Unresolved
              </button>
              <button
                type="button"
                disabled={!canRecord}
                onClick={() => handleSave('resolve')}
                className={`${btnBase} inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold bg-[#8B2E4A] text-white hover:bg-[#72253C] disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {saving ? 'Saving…' : 'Record Payment'}
              </button>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="py-12 text-center">
            <div className="inline-flex items-center justify-center rounded-full bg-emerald-100 w-16 h-16 mb-4 animate-in zoom-in duration-300">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2
              className="text-xl text-stone-900 mb-2"
              style={{ fontFamily: 'DM Serif Display, serif' }}
            >
              Payment recorded
            </h2>
            {savedSummary.current ? (
              <dl className="text-sm text-stone-600 max-w-sm mx-auto space-y-1">
                <div className="flex justify-between">
                  <dt className="text-stone-500">Facility</dt>
                  <dd className="font-medium text-stone-900">{savedSummary.current.facility}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-stone-500">Amount</dt>
                  <dd className="font-medium text-stone-900">{formatDollars(savedSummary.current.amount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-stone-500">Date</dt>
                  <dd className="font-medium text-stone-900">{savedSummary.current.date}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-stone-500">Method</dt>
                  <dd className="font-medium text-stone-900">{savedSummary.current.method.toUpperCase()}</dd>
                </div>
              </dl>
            ) : null}

            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={handleScanAnother}
                className={`${btnBase} rounded-xl px-4 py-2 text-sm font-semibold bg-stone-100 text-stone-700 hover:bg-stone-200`}
              >
                Scan another
              </button>
              <button
                type="button"
                onClick={handleDone}
                className={`${btnBase} rounded-xl px-4 py-2 text-sm font-semibold bg-[#8B2E4A] text-white hover:bg-[#72253C]`}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function FieldInput({
  label,
  value,
  onChange,
  confidence,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  confidence?: Confidence
  type?: string
}) {
  const lowConf = confidence === 'low' || confidence === 'medium'
  return (
    <div>
      <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-rose-100 focus:outline-none ${transitionBase} ${
          lowConf
            ? 'bg-amber-50 border border-amber-200 focus:border-amber-400'
            : 'border border-stone-200 focus:border-[#8B2E4A]'
        }`}
      />
    </div>
  )
}

function ResidentRow({
  line,
  residents,
  onChange,
  onRemove,
}: {
  line: EditableLine
  residents: BillingResident[]
  onChange: (next: EditableLine) => void
  onRemove: () => void
}) {
  const [amountInput, setAmountInput] = useState(centsToInput(line.amountCents))

  function commitAmount() {
    onChange({ ...line, amountCents: parseDollarsToCents(amountInput) })
  }

  return (
    <div
      className={`grid grid-cols-12 items-center gap-2 px-3 py-2 border-b border-stone-50 last:border-0 text-sm ${
        line.matchConfidence === 'none' ? 'bg-amber-50' : ''
      }`}
    >
      <div className="col-span-4 truncate" title={line.rawName}>
        <div className="text-stone-900 font-medium truncate">{line.rawName}</div>
      </div>
      <div className="col-span-5">
        <select
          value={line.residentId ?? ''}
          onChange={(e) => {
            const id = e.target.value || null
            const r = residents.find((x) => x.id === id) ?? null
            onChange({
              ...line,
              residentId: id,
              residentName: r?.name ?? null,
              matchConfidence: id ? 'high' : 'none',
            })
          }}
          className={`w-full rounded-lg border border-stone-200 px-2 py-1 text-xs focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 focus:outline-none ${transitionBase}`}
        >
          <option value="">— Unmatched —</option>
          {residents.map((r) => (
            <option key={r.id} value={r.id}>
              {r.roomNumber ? `${r.roomNumber} · ${r.name}` : r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="col-span-2">
        <input
          type="text"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          onBlur={commitAmount}
          className="w-full rounded-lg border border-stone-200 px-2 py-1 text-xs text-right focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 focus:outline-none"
        />
      </div>
      <div className="col-span-1 text-right">
        <button
          type="button"
          onClick={onRemove}
          className={`${btnBase} text-stone-400 hover:text-red-600`}
          aria-label="Remove line"
        >
          ×
        </button>
      </div>
    </div>
  )
}
