'use client'

import { useState, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import type { Resident, Stylist, Service } from '@/types'

interface OcrRawEntry {
  residentName: string
  roomNumber: string | null
  serviceName: string
  price: number | null
  notes: string | null
  unclear: boolean
}

interface OcrRawSheet {
  imageIndex: number
  date: string | null
  stylistName: string | null
  entries: OcrRawEntry[]
  error?: string
}

type EntryState = {
  residentName: string
  roomNumber: string | null
  residentId: string | null
  serviceName: string
  serviceId: string | null
  priceCents: number | null
  notes: string | null
  unclear: boolean
  include: boolean
}

type SheetState = {
  imageIndex: number
  date: string
  stylistId: string | null
  entries: EntryState[]
}

type Step = 'upload' | 'review' | 'confirm'

interface OcrImportModalProps {
  open: boolean
  onClose: () => void
  onImported: () => void
  residents: Resident[]
  stylists: Stylist[]
  services: Service[]
  date: string
}

function fuzzyMatches<T extends { name: string }>(items: T[], name: string): T[] {
  if (!name) return []
  const q = name.toLowerCase()
  return items.filter(
    (item) => item.name.toLowerCase().includes(q) || q.includes(item.name.toLowerCase())
  )
}

function buildSheetState(
  raw: OcrRawSheet,
  residents: Resident[],
  stylists: Stylist[],
  services: Service[],
  fallbackDate: string
): SheetState {
  let stylistId: string | null = null
  if (raw.stylistName) {
    const matches = fuzzyMatches(stylists, raw.stylistName)
    if (matches.length === 1) stylistId = matches[0].id
  }
  if (!stylistId && stylists.length === 1) stylistId = stylists[0].id

  const entries: EntryState[] = (raw.entries ?? []).map((entry) => {
    const resMatches = fuzzyMatches(residents, entry.residentName ?? '')
    const svcMatches = fuzzyMatches(services, entry.serviceName ?? '')

    return {
      residentName: entry.residentName ?? '',
      roomNumber: entry.roomNumber ?? null,
      residentId: resMatches.length === 1 ? resMatches[0].id : null,
      serviceName: entry.serviceName ?? '',
      serviceId: svcMatches.length === 1 ? svcMatches[0].id : null,
      priceCents: entry.price != null ? Math.round(entry.price * 100) : null,
      notes: entry.notes ?? null,
      unclear: entry.unclear ?? false,
      include: true,
    }
  })

  return {
    imageIndex: raw.imageIndex,
    date: raw.date ?? fallbackDate,
    stylistId,
    entries,
  }
}

export function OcrImportModal({
  open,
  onClose,
  onImported,
  residents,
  stylists,
  services,
  date,
}: OcrImportModalProps) {
  const { toast } = useToast()

  const [step, setStep] = useState<Step>('upload')
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [sheetErrors, setSheetErrors] = useState<{ index: number; error: string }[]>([])
  const [sheets, setSheets] = useState<SheetState[]>([])
  const [activeTab, setActiveTab] = useState(0)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStep('upload')
    setFiles([])
    setPreviews(prev => { prev.forEach(url => { if (url) URL.revokeObjectURL(url) }); return [] })
    setScanning(false)
    setScanError(null)
    setSheetErrors([])
    setSheets([])
    setActiveTab(0)
    setImporting(false)
    setImportError(null)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleFiles = (selected: FileList | null) => {
    if (!selected) return
    const arr = Array.from(selected)
    setFiles(arr)
    previews.forEach(url => { if (url) URL.revokeObjectURL(url) })
    setPreviews(arr.map(f => f.type === 'application/pdf' ? '' : URL.createObjectURL(f)))
    setScanError(null)
    setSheetErrors([])
  }

  const removeFile = (i: number) => {
    if (previews[i]) URL.revokeObjectURL(previews[i])
    setFiles(prev => prev.filter((_, fi) => fi !== i))
    setPreviews(prev => prev.filter((_, pi) => pi !== i))
  }

  const handleScan = async () => {
    if (files.length === 0) return
    setScanning(true)
    setScanError(null)
    try {
      const fd = new FormData()
      files.forEach(f => fd.append('images', f))
      const res = await fetch('/api/log/ocr', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) { setScanError(json.error ?? 'Scan failed'); return }

      const rawSheets: OcrRawSheet[] = json.data.sheets
      const errorSheets = rawSheets.filter(s => s.error)
      const built = rawSheets
        .filter(s => !s.error)
        .map(s => buildSheetState(s, residents, stylists, services, date))

      setSheetErrors(errorSheets.map(s => ({ index: s.imageIndex, error: s.error! })))

      if (built.length === 0) {
        const msgs = errorSheets.map(s => `Sheet ${s.imageIndex + 1}: ${s.error}`).join('. ')
        setScanError(msgs || 'No sheets could be read. Check image quality and try again.')
        return
      }
      setSheets(built)
      setActiveTab(0)
      setStep('review')
    } catch {
      setScanError('Network error. Please try again.')
    } finally {
      setScanning(false)
    }
  }

  const updateEntry = (sheetIdx: number, entryIdx: number, updates: Partial<EntryState>) => {
    setSheets(prev =>
      prev.map((s, si) =>
        si !== sheetIdx
          ? s
          : { ...s, entries: s.entries.map((e, ei) => (ei !== entryIdx ? e : { ...e, ...updates })) }
      )
    )
  }

  const updateSheet = (sheetIdx: number, updates: Partial<SheetState>) => {
    setSheets(prev => prev.map((s, si) => (si !== sheetIdx ? s : { ...s, ...updates })))
  }

  const validSheets = sheets.filter(s => s.stylistId)

  const totalIncluded = validSheets.reduce(
    (acc, s) => acc + s.entries.filter(e => e.include).length,
    0
  )

  const summary = validSheets.reduce(
    (acc, s) => {
      s.entries.filter(e => e.include).forEach(e => {
        if (!e.residentId) acc.residents++
        if (!e.serviceId) acc.services++
        acc.bookings++
      })
      return acc
    },
    { residents: 0, services: 0, bookings: 0 }
  )

  const handleImport = async () => {
    setImporting(true)
    setImportError(null)
    try {
      const payload = {
        sheets: validSheets.map(s => ({
          date: s.date,
          stylistId: s.stylistId!,
          entries: s.entries.map(e => ({
            include: e.include,
            residentId: e.residentId,
            residentName: e.residentName,
            roomNumber: e.roomNumber,
            serviceId: e.serviceId,
            serviceName: e.serviceName,
            priceCents: e.priceCents,
            notes: e.notes,
          })),
        })),
      }
      const res = await fetch('/api/log/ocr/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        setImportError(json.error ?? 'Import failed')
        return
      }
      const { bookings: n } = json.data.created
      reset()
      onClose()
      onImported()
      toast(`${n} booking${n !== 1 ? 's' : ''} imported`, 'success')
    } catch {
      setImportError('Network error. Please try again.')
    } finally {
      setImporting(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="bg-white rounded-t-3xl md:rounded-2xl w-full md:max-w-3xl md:mx-4 max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-stone-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              {step === 'upload' ? 'Scan Log Sheets' : step === 'review' ? 'Review Entries' : 'Confirm Import'}
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              {step === 'upload'
                ? 'Upload one or more log sheet photos to extract appointments'
                : step === 'review'
                ? 'Review and adjust the extracted entries before importing'
                : 'Confirm what will be created'}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-xl hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── STEP 1: UPLOAD ── */}
          {step === 'upload' && (
            <div className="px-5 py-4 space-y-3">
              <div
                className="border-2 border-dashed border-stone-200 rounded-2xl p-8 text-center cursor-pointer hover:border-[#0D7377] hover:bg-teal-50/30 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0D7377" strokeWidth="1.5" className="mx-auto mb-3">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <p className="text-sm font-medium text-stone-700">
                  {files.length > 0
                    ? `${files.length} file${files.length > 1 ? 's' : ''} selected`
                    : 'Tap to select files'}
                </p>
                <p className="text-xs text-stone-400 mt-1">JPEG, PNG, WEBP, or PDF — multiple allowed</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </div>

              {/* Camera button — mobile only */}
              <div className="md:hidden">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-full min-h-[44px] py-2.5 rounded-xl border border-stone-200 text-sm font-medium text-stone-600 flex items-center justify-center gap-2 hover:bg-stone-50 transition-colors"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  Take Photo
                </button>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </div>

              {files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {files.map((file, i) => (
                    <div key={i} className="relative">
                      {file.type === 'application/pdf' ? (
                        <div className="w-20 h-20 rounded-xl border border-stone-200 bg-stone-50 flex flex-col items-center justify-center gap-1">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0D7377" strokeWidth="1.5">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="9" y1="15" x2="15" y2="15" />
                            <line x1="9" y1="11" x2="15" y2="11" />
                          </svg>
                          <span className="text-[9px] font-medium text-stone-500 uppercase">PDF</span>
                        </div>
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={previews[i]} alt={`Sheet ${i + 1}`} className="w-20 h-20 object-cover rounded-xl border border-stone-200" />
                      )}
                      <button
                        onClick={() => removeFile(i)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-700 text-white text-[10px] flex items-center justify-center hover:bg-red-600 transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {scanError && <p className="text-xs text-red-600 text-center">{scanError}</p>}
            </div>
          )}

          {/* ── STEP 2: REVIEW ── */}
          {step === 'review' && sheets.length > 0 && (
            <div>
              {/* Sheet tabs */}
              {sheets.length > 1 && (
                <div className="flex gap-1.5 px-5 pt-4 overflow-x-auto shrink-0">
                  {sheets.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveTab(i)}
                      className={cn(
                        'px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors shrink-0',
                        activeTab === i
                          ? 'bg-[#0D7377] text-white'
                          : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                      )}
                    >
                      Sheet {i + 1}
                    </button>
                  ))}
                </div>
              )}

              {(() => {
                const sheet = sheets[activeTab]
                if (!sheet) return null
                const sourceFile = files[sheet.imageIndex]
                const sourcePreview = previews[sheet.imageIndex]
                return (
                  <div className="px-5 py-4 space-y-4">

                    {/* Source sheet reference image */}
                    {sourceFile && (
                      <details className="group">
                        <summary className="text-xs text-stone-500 cursor-pointer select-none list-none flex items-center gap-1.5 py-1">
                          <svg
                            width="12" height="12" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2"
                            className="transition-transform group-open:rotate-90 shrink-0"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                          Source sheet
                        </summary>
                        <div className="mt-2">
                          {sourceFile.type === 'application/pdf' ? (
                            <div className="w-16 h-16 rounded-xl border border-stone-200 bg-stone-50 flex flex-col items-center justify-center gap-1">
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0D7377" strokeWidth="1.5">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                              </svg>
                              <span className="text-[9px] font-medium text-stone-500 uppercase">PDF</span>
                            </div>
                          ) : (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={sourcePreview}
                              alt="Source sheet"
                              className="max-h-48 w-auto rounded-xl border border-stone-200 object-contain"
                            />
                          )}
                        </div>
                      </details>
                    )}

                    {/* Sheet header: date + stylist */}
                    <div className="flex flex-wrap gap-3 items-end">
                      <div>
                        <label className="text-xs font-medium text-stone-600 block mb-1">Date</label>
                        <input
                          type="date"
                          value={sheet.date}
                          onChange={(e) => updateSheet(activeTab, { date: e.target.value })}
                          className="min-h-[44px] px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377]"
                        />
                      </div>
                      <div className="flex-1 min-w-[180px]">
                        <label className="text-xs font-medium text-stone-600 block mb-1">Stylist *</label>
                        <select
                          value={sheet.stylistId ?? ''}
                          onChange={(e) => updateSheet(activeTab, { stylistId: e.target.value || null })}
                          className={cn(
                            'w-full min-h-[44px] px-3 py-2 rounded-xl border text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#0D7377]/30 focus:border-[#0D7377]',
                            !sheet.stylistId ? 'border-red-300' : 'border-stone-200'
                          )}
                        >
                          <option value="">Select stylist…</option>
                          {stylists.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        {!sheet.stylistId && (
                          <p className="text-xs text-red-500 mt-0.5">Required — this sheet will be skipped without a stylist</p>
                        )}
                      </div>
                    </div>

                    {/* Entry list */}
                    {sheet.entries.length === 0 ? (
                      <p className="text-sm text-stone-400 text-center py-6">No entries found in this sheet.</p>
                    ) : (
                      <div className="space-y-3">
                        {sheet.entries.map((entry, ei) => {
                          const resMatches = fuzzyMatches(residents, entry.residentName)
                          const svcMatches = fuzzyMatches(services, entry.serviceName)
                          const showResDupe = resMatches.length >= 2 && !entry.residentId
                          const showSvcDupe = svcMatches.length >= 2 && !entry.serviceId

                          return (
                            <div
                              key={ei}
                              className={cn(
                                'rounded-2xl border p-3 space-y-2.5 transition-opacity',
                                entry.include
                                  ? 'border-stone-200 bg-white'
                                  : 'border-stone-100 bg-stone-50 opacity-50'
                              )}
                            >
                              {/* Row header: checkbox + name + unclear badge */}
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={entry.include}
                                  onChange={(e) => updateEntry(activeTab, ei, { include: e.target.checked })}
                                  className="w-4 h-4 accent-[#0D7377] shrink-0"
                                />
                                <span className="text-xs font-medium text-stone-700 flex-1 truncate">
                                  {entry.residentName}
                                </span>
                                {entry.unclear && (
                                  <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-md font-medium shrink-0">
                                    Unclear
                                  </span>
                                )}
                              </div>

                              {/* Duplicate warnings */}
                              {showResDupe && (
                                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
                                  <p className="font-medium mb-1.5">Did you mean…?</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {resMatches.map(r => (
                                      <button
                                        key={r.id}
                                        onClick={() => updateEntry(activeTab, ei, { residentId: r.id, residentName: r.name })}
                                        className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 font-medium transition-colors"
                                      >
                                        {r.name}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {showSvcDupe && (
                                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
                                  <p className="font-medium mb-1.5">Did you mean…?</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {svcMatches.map(s => (
                                      <button
                                        key={s.id}
                                        onClick={() => updateEntry(activeTab, ei, { serviceId: s.id, serviceName: s.name })}
                                        className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 font-medium transition-colors"
                                      >
                                        {s.name}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Fields grid: 2-col on all sizes */}
                              <div className="grid grid-cols-2 gap-2">
                                {/* Resident combo input */}
                                <div>
                                  <label className="text-xs text-stone-500 block mb-0.5">Resident</label>
                                  <input
                                    type="text"
                                    list={`residents-${activeTab}-${ei}`}
                                    value={entry.residentName}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      const matched = residents.find(
                                        r => r.name.toLowerCase() === val.toLowerCase()
                                      )
                                      updateEntry(activeTab, ei, {
                                        residentName: val,
                                        residentId: matched?.id ?? null,
                                      })
                                    }}
                                    placeholder="Type or pick…"
                                    className="w-full min-h-[44px] text-xs border border-stone-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:border-[#0D7377]"
                                  />
                                  <datalist id={`residents-${activeTab}-${ei}`}>
                                    {residents.map(r => (
                                      <option key={r.id} value={r.name} />
                                    ))}
                                  </datalist>
                                  {!entry.residentId && entry.residentName && (
                                    <p className="text-[10px] text-stone-400 mt-0.5">Will create new resident</p>
                                  )}
                                </div>

                                {/* Room # — only visible when creating new resident */}
                                {!entry.residentId ? (
                                  <div>
                                    <label className="text-xs text-stone-500 block mb-0.5">Room #</label>
                                    <input
                                      type="text"
                                      placeholder="optional"
                                      value={entry.roomNumber ?? ''}
                                      onChange={(e) =>
                                        updateEntry(activeTab, ei, { roomNumber: e.target.value || null })
                                      }
                                      className="w-full min-h-[44px] text-xs border border-stone-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:border-[#0D7377]"
                                    />
                                  </div>
                                ) : (
                                  <div />
                                )}

                                {/* Service combo input */}
                                <div>
                                  <label className="text-xs text-stone-500 block mb-0.5">Service</label>
                                  <input
                                    type="text"
                                    list={`services-${activeTab}-${ei}`}
                                    value={entry.serviceName}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      const matched = services.find(
                                        s => s.name.toLowerCase() === val.toLowerCase()
                                      )
                                      updateEntry(activeTab, ei, {
                                        serviceName: val,
                                        serviceId: matched?.id ?? null,
                                      })
                                    }}
                                    placeholder="Type or pick…"
                                    className="w-full min-h-[44px] text-xs border border-stone-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:border-[#0D7377]"
                                  />
                                  <datalist id={`services-${activeTab}-${ei}`}>
                                    {services.map(s => (
                                      <option key={s.id} value={s.name} />
                                    ))}
                                  </datalist>
                                  {!entry.serviceId && entry.serviceName && (
                                    <p className="text-[10px] text-stone-400 mt-0.5">Will create new service</p>
                                  )}
                                </div>

                                {/* Price */}
                                <div>
                                  <label className="text-xs text-stone-500 block mb-0.5">Price ($)</label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="0.00"
                                    value={entry.priceCents != null ? (entry.priceCents / 100).toFixed(2) : ''}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value)
                                      updateEntry(activeTab, ei, {
                                        priceCents: isNaN(val) ? null : Math.round(val * 100),
                                      })
                                    }}
                                    className="w-full min-h-[44px] text-xs border border-stone-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:border-[#0D7377]"
                                  />
                                </div>
                              </div>

                              {/* Notes */}
                              <div>
                                <label className="text-xs text-stone-500 block mb-0.5">Notes</label>
                                <input
                                  type="text"
                                  placeholder="optional"
                                  value={entry.notes ?? ''}
                                  onChange={(e) => updateEntry(activeTab, ei, { notes: e.target.value || null })}
                                  className="w-full min-h-[44px] text-xs border border-stone-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:border-[#0D7377]"
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {/* ── STEP 3: CONFIRM ── */}
          {step === 'confirm' && (
            <div className="px-5 py-6 space-y-4">
              <div className="bg-stone-50 rounded-2xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-stone-800">Import Summary</h3>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Residents to create', count: summary.residents },
                    { label: 'Services to create', count: summary.services },
                    { label: 'Bookings to import', count: summary.bookings },
                  ].map(({ label, count }) => (
                    <div key={label} className="bg-white rounded-xl p-3 border border-stone-200 text-center">
                      <p className="text-2xl font-bold text-stone-900">{count}</p>
                      <p className="text-[11px] text-stone-500 mt-0.5 leading-tight">{label}</p>
                    </div>
                  ))}
                </div>
                {sheets.some(s => !s.stylistId) && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800">
                    {sheets.filter(s => !s.stylistId).length} sheet
                    {sheets.filter(s => !s.stylistId).length > 1 ? 's' : ''} with no stylist will be skipped.
                    Go back to assign stylists.
                  </div>
                )}
              </div>
              {importError && <p className="text-xs text-red-600">{importError}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-stone-100 shrink-0 flex gap-2">
          {step === 'upload' && (
            <>
              <button
                onClick={handleClose}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl border border-stone-200 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleScan}
                disabled={files.length === 0 || scanning}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-[#0D7377] text-white text-sm font-semibold hover:bg-[#0a5f63] transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {scanning ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Scanning…
                  </>
                ) : (
                  `Scan ${files.length > 0 ? files.length + ' ' : ''}Sheet${files.length !== 1 ? 's' : ''}`
                )}
              </button>
            </>
          )}
          {step === 'review' && (
            <>
              <button
                onClick={() => setStep('upload')}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl border border-stone-200 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep('confirm')}
                disabled={totalIncluded === 0}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-[#0D7377] text-white text-sm font-semibold hover:bg-[#0a5f63] transition-colors disabled:opacity-40"
              >
                Review {totalIncluded} Booking{totalIncluded !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {step === 'confirm' && (
            <>
              <button
                onClick={() => setStep('review')}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl border border-stone-200 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleImport}
                disabled={importing || summary.bookings === 0}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-[#0D7377] text-white text-sm font-semibold hover:bg-[#0a5f63] transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {importing ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Importing…
                  </>
                ) : (
                  'Import All'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
