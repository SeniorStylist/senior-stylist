'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { cn } from '@/lib/utils'

type Step = 1 | 2 | 3 | 4 | 5 | 6

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
]

const PAYMENT_TYPES = [
  { value: 'facility', label: 'Facility pays (bill the facility)' },
  { value: 'ip', label: 'Resident pays (individual payment)' },
  { value: 'rfms', label: 'RFMS billing' },
  { value: 'hybrid', label: 'Hybrid (facility + resident)' },
]

const COLOR_PALETTE = [
  '#0D7377', '#14B8A6', '#6366F1', '#8B5CF6', '#EC4899',
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6',
  '#64748B', '#1C1917',
]

// ── CSV/XLSX column detection ──────────────────────────────────────
const SVC_NAME_HDRS = ['name', 'servicename', 'service', 'description', 'item']
const SVC_PRICE_HDRS = ['price', 'cost', 'amount', 'rate', 'fee']
const SVC_DUR_HDRS = ['duration', 'minutes', 'mins', 'time', 'length']
const DURATION_SNAPS = [15, 30, 45, 60, 75, 90, 120]

const RES_NAME_HDRS = ['name', 'residentname', 'fullname', 'resident', 'patientname', 'clientname']
const RES_ROOM_HDRS = ['room', 'roomnumber', 'roomno', 'roomnum', 'unit', 'unitnumber', 'apt', 'apartment', 'suite', 'bed']

function snapDuration(n: number): number {
  return DURATION_SNAPS.reduce((prev, curr) =>
    Math.abs(curr - n) < Math.abs(prev - n) ? curr : prev
  )
}
function parsePriceCents(raw: string): number {
  const n = parseFloat(raw.replace(/[^0-9.]/g, '') || '0')
  return isNaN(n) ? 0 : Math.round(n * 100)
}

type ServiceRow = {
  name: string
  priceCents: number
  durationMinutes: number
  include: boolean
  pricingType?: string
  addonAmountCents?: number | null
  pricingTiers?: Array<{ minQty: number; maxQty: number; unitPriceCents: number }> | null
  pricingOptions?: Array<{ name: string; priceCents: number }> | null
}
type ResidentRow = { name: string; roomNumber?: string; include: boolean }

function findKey(keys: string[], targets: string[]): string | undefined {
  const idx = keys.map(k => k.toLowerCase().trim()).findIndex(k => targets.includes(k))
  return idx >= 0 ? keys[idx] : undefined
}

async function parseServiceFile(file: File): Promise<ServiceRow[]> {
  const ext = file.name.split('.').pop()?.toLowerCase()

  if (ext === 'pdf') {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/services/parse-pdf', { method: 'POST', body: fd })
    if (!res.ok) throw new Error('Failed to parse PDF')
    const json = await res.json()
    return (json.data ?? []).map((r: { name: string; priceCents: number; durationMinutes: number; pricingType?: string; addonAmountCents?: number | null; pricingTiers?: Array<{ minQty: number; maxQty: number; unitPriceCents: number }> | null; pricingOptions?: Array<{ name: string; priceCents: number }> | null }) => ({
      name: r.name,
      priceCents: r.priceCents,
      durationMinutes: r.durationMinutes ?? 30,
      include: true,
      pricingType: r.pricingType,
      addonAmountCents: r.addonAmountCents,
      pricingTiers: r.pricingTiers,
      pricingOptions: r.pricingOptions,
    }))
  }

  if (ext === 'csv') {
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const keys = results.meta.fields ?? []
          const nameKey = findKey(keys, SVC_NAME_HDRS) ?? keys[0]
          const priceKey = findKey(keys, SVC_PRICE_HDRS) ?? keys[1]
          const durKey = findKey(keys, SVC_DUR_HDRS)
          const rows = (results.data as Record<string, string>[])
            .filter(r => r[nameKey]?.trim())
            .map(r => ({
              name: r[nameKey].trim(),
              priceCents: parsePriceCents(priceKey ? r[priceKey] ?? '' : ''),
              durationMinutes: snapDuration(durKey ? parseInt(r[durKey]) || 30 : 30),
              include: true,
            }))
          resolve(rows)
        },
        error: reject,
      })
    })
  }

  // xlsx / xls
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
        if (!json.length) { resolve([]); return }
        const keys = Object.keys(json[0])
        const nameKey = findKey(keys, SVC_NAME_HDRS) ?? keys[0]
        const priceKey = findKey(keys, SVC_PRICE_HDRS) ?? keys[1]
        const durKey = findKey(keys, SVC_DUR_HDRS)
        const rows = json
          .filter(r => String(r[nameKey] ?? '').trim())
          .map(r => ({
            name: String(r[nameKey]).trim(),
            priceCents: parsePriceCents(String(r[priceKey] ?? '')),
            durationMinutes: snapDuration(parseInt(String(r[durKey ?? ''] ?? '30')) || 30),
            include: true,
          }))
        resolve(rows)
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

async function parseResidentFile(file: File): Promise<ResidentRow[]> {
  const ext = file.name.split('.').pop()?.toLowerCase()

  const toRows = (raw: Record<string, string>[], keys: string[]): ResidentRow[] => {
    const nameKey = findKey(keys, RES_NAME_HDRS) ?? keys[0]
    const roomKey = findKey(keys, RES_ROOM_HDRS) ?? keys[1]
    return raw
      .filter(r => r[nameKey]?.trim())
      .map(r => ({
        name: r[nameKey].trim(),
        roomNumber: roomKey && r[roomKey]?.trim() ? r[roomKey].trim() : undefined,
        include: true,
      }))
  }

  if (ext === 'csv') {
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          resolve(toRows(results.data as Record<string, string>[], results.meta.fields ?? []))
        },
        error: reject,
      })
    })
  }

  // xlsx / xls
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' })
        if (!json.length) { resolve([]); return }
        resolve(toRows(json, Object.keys(json[0])))
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
export default function OnboardingClient() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)

  // Step 2 state
  const [facilityName, setFacilityName] = useState('')
  const [facilityAddress, setFacilityAddress] = useState('')
  const [facilityPhone, setFacilityPhone] = useState('')
  const [timezone, setTimezone] = useState('America/New_York')
  const [paymentType, setPaymentType] = useState('facility')
  const [step2Error, setStep2Error] = useState<string | null>(null)
  const [step2Loading, setStep2Loading] = useState(false)

  // Step 3 — Stylist
  const [stylistName, setStylistName] = useState('')
  const [stylistColor, setStylistColor] = useState('#8B2E4A')
  const [commission, setCommission] = useState('0')
  const [step3Loading, setStep3Loading] = useState(false)
  const [step3Error, setStep3Error] = useState<string | null>(null)
  const [stylistsAdded, setStylistsAdded] = useState(0)

  // Step 4 — Services
  const [serviceMode, setServiceMode] = useState<'choose' | 'manual' | 'import'>('choose')
  const [serviceName, setServiceName] = useState('')
  const [servicePrice, setServicePrice] = useState('')
  const [serviceDuration, setServiceDuration] = useState('30')
  const [step4Loading, setStep4Loading] = useState(false)
  const [step4Error, setStep4Error] = useState<string | null>(null)
  const [servicesAdded, setServicesAdded] = useState(0)
  const [importRows, setImportRows] = useState<ServiceRow[]>([])
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSaved, setImportSaved] = useState(false)

  // Step 5 — Residents
  const [residentMode, setResidentMode] = useState<'choose' | 'manual' | 'import'>('choose')
  const [residentName, setResidentName] = useState('')
  const [residentRoom, setResidentRoom] = useState('')
  const [step5Loading, setStep5Loading] = useState(false)
  const [step5Error, setStep5Error] = useState<string | null>(null)
  const [residentsAdded, setResidentsAdded] = useState(0)
  const [residentRows, setResidentRows] = useState<ResidentRow[]>([])
  const [residentImportLoading, setResidentImportLoading] = useState(false)
  const [residentImportError, setResidentImportError] = useState<string | null>(null)
  const [residentImportSaved, setResidentImportSaved] = useState(false)

  const progress = (step / 6) * 100

  // ── Handlers ──────────────────────────────────────────────────────

  const handleStep2 = async () => {
    if (!facilityName.trim()) { setStep2Error('Facility name is required'); return }
    setStep2Loading(true)
    setStep2Error(null)
    try {
      const res = await fetch('/api/facilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: facilityName.trim(),
          address: facilityAddress.trim() || undefined,
          phone: facilityPhone.trim() || undefined,
          timezone,
          paymentType,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setStep2Error(json.error ?? 'Failed to create facility'); return }
      await fetch('/api/facilities/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId: json.data.id }),
      })
      setStep(3)
    } catch {
      setStep2Error('Network error')
    } finally {
      setStep2Loading(false)
    }
  }

  const handleStep3 = async (skip = false) => {
    if (skip) { setStep(4); return }
    if (!stylistName.trim()) { setStep3Error('Stylist name is required'); return }
    setStep3Loading(true)
    setStep3Error(null)
    try {
      const res = await fetch('/api/stylists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: stylistName.trim(),
          color: stylistColor,
          commissionPercent: parseInt(commission) || 0,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setStep3Error(json.error ?? 'Failed to create stylist'); return }
      setStylistsAdded(1)
      setStep(4)
    } catch {
      setStep3Error('Network error')
    } finally {
      setStep3Loading(false)
    }
  }

  const handleAddService = async () => {
    if (!serviceName.trim()) { setStep4Error('Service name is required'); return }
    const priceCents = Math.round(parseFloat(servicePrice.replace('$', '') || '0') * 100)
    setStep4Loading(true)
    setStep4Error(null)
    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: serviceName.trim(),
          priceCents,
          durationMinutes: parseInt(serviceDuration) || 30,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setStep4Error(json.error ?? 'Failed to add service'); return }
      setServicesAdded((n) => n + 1)
      setServiceName('')
      setServicePrice('')
      setServiceDuration('30')
    } catch {
      setStep4Error('Network error')
    } finally {
      setStep4Loading(false)
    }
  }

  const handleServiceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportLoading(true)
    setImportError(null)
    try {
      const rows = await parseServiceFile(file)
      if (!rows.length) { setImportError('No services found in this file'); return }
      setImportRows(rows)
    } catch {
      setImportError('Failed to parse file. Check the format and try again.')
    } finally {
      setImportLoading(false)
      e.target.value = ''
    }
  }

  const handleBulkImportServices = async () => {
    const rows = importRows.filter(r => r.include)
    if (!rows.length) return
    setImportLoading(true)
    setImportError(null)
    try {
      const res = await fetch('/api/services/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rows.map(({ name, priceCents, durationMinutes }) => ({ name, priceCents, durationMinutes })) }),
      })
      const json = await res.json()
      if (!res.ok) { setImportError(json.error ?? 'Import failed'); return }
      setServicesAdded(json.data?.created ?? rows.length)
      setImportSaved(true)
    } catch {
      setImportError('Network error during import')
    } finally {
      setImportLoading(false)
    }
  }

  const handleAddResident = async () => {
    if (!residentName.trim()) { setStep5Error('Resident name is required'); return }
    setStep5Loading(true)
    setStep5Error(null)
    try {
      const res = await fetch('/api/residents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: residentName.trim(),
          roomNumber: residentRoom.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setStep5Error(json.error ?? 'Failed to add resident'); return }
      setResidentsAdded((n) => n + 1)
      setResidentName('')
      setResidentRoom('')
    } catch {
      setStep5Error('Network error')
    } finally {
      setStep5Loading(false)
    }
  }

  const handleResidentFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setResidentImportLoading(true)
    setResidentImportError(null)
    try {
      const rows = await parseResidentFile(file)
      if (!rows.length) { setResidentImportError('No residents found in this file'); return }
      setResidentRows(rows)
    } catch {
      setResidentImportError('Failed to parse file. Check the format and try again.')
    } finally {
      setResidentImportLoading(false)
      e.target.value = ''
    }
  }

  const handleBulkImportResidents = async () => {
    const rows = residentRows.filter(r => r.include)
    if (!rows.length) return
    setResidentImportLoading(true)
    setResidentImportError(null)
    try {
      const res = await fetch('/api/residents/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rows.map(({ name, roomNumber }) => ({ name, roomNumber })) }),
      })
      const json = await res.json()
      if (!res.ok) { setResidentImportError(json.error ?? 'Import failed'); return }
      setResidentsAdded(json.data?.created ?? rows.length)
      setResidentImportSaved(true)
    } catch {
      setResidentImportError('Network error during import')
    } finally {
      setResidentImportLoading(false)
    }
  }

  // ── Shared style classes ───────────────────────────────────────────
  const inputClass = 'w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-rose-100 transition-all'
  const selectClass = 'w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] transition-all'
  const ctaClass = 'w-full py-3.5 rounded-2xl bg-[#8B2E4A] text-white font-semibold text-base active:scale-[0.98] transition-all shadow-sm disabled:opacity-50'
  const skipClass = 'w-full text-sm text-stone-400 hover:text-stone-600 transition-colors py-1'
  const optionCardClass = 'w-full p-4 rounded-2xl border-2 border-stone-200 hover:border-[#8B2E4A] text-left transition-all cursor-pointer'

  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-stone-900" style={{ fontFamily: "'DM Serif Display', serif" }}>
            Senior Stylist
          </h1>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-stone-100 overflow-hidden">
          {/* Progress bar */}
          <div className="h-1 bg-stone-100">
            <div
              className="h-full bg-[#8B2E4A] transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Step dots (content steps 2–5) */}
          {step >= 2 && step <= 5 && (
            <div className="flex items-center justify-center gap-1 pt-4">
              {['Facility', 'Stylist', 'Services', 'Residents'].map((label, i) => {
                const stepNum = (i + 2) as Step
                const done = step > stepNum
                const active = step === stepNum
                return (
                  <div key={label} className="flex items-center gap-1">
                    <div
                      className={cn(
                        'w-2 h-2 rounded-full transition-all duration-300',
                        done ? 'bg-[#8B2E4A]' : active ? 'bg-[#8B2E4A] ring-2 ring-[#8B2E4A]/25 ring-offset-1' : 'bg-stone-200'
                      )}
                      title={label}
                    />
                    {i < 3 && (
                      <div className={cn('h-px w-6 transition-all duration-300', done ? 'bg-[#8B2E4A]' : 'bg-stone-200')} />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="p-8">

            {/* ─── Step 1 — Welcome ─────────────────────────────────────── */}
            {step === 1 && (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 bg-[#8B2E4A] rounded-2xl flex items-center justify-center mx-auto">
                  <span className="text-white text-2xl font-bold">SS</span>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-stone-900 mb-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
                    Welcome to Senior Stylist
                  </h2>
                  <p className="text-stone-500 text-sm">
                    Let&apos;s get your salon set up in just a few minutes.
                  </p>
                </div>
                <button onClick={() => setStep(2)} className={ctaClass}>
                  Get Started →
                </button>
              </div>
            )}

            {/* ─── Step 2 — Facility ───────────────────────────────────── */}
            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-[#8B2E4A] uppercase tracking-wide mb-1">Step 1 of 4</p>
                  <h2 className="text-xl font-bold text-stone-900" style={{ fontFamily: "'DM Serif Display', serif" }}>
                    Your Facility
                  </h2>
                </div>
                {step2Error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">{step2Error}</div>
                )}
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Facility Name *</label>
                    <input value={facilityName} onChange={(e) => setFacilityName(e.target.value)} placeholder="Sunrise Senior Living" className={inputClass} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Address</label>
                    <input value={facilityAddress} onChange={(e) => setFacilityAddress(e.target.value)} placeholder="123 Main St, City, State" className={inputClass} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Phone</label>
                    <input type="tel" value={facilityPhone} onChange={(e) => setFacilityPhone(e.target.value)} placeholder="(555) 555-5555" className={inputClass} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Timezone</label>
                    <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={selectClass}>
                      {TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Payment Type</label>
                    <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)} className={selectClass}>
                      {PAYMENT_TYPES.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button onClick={handleStep2} disabled={step2Loading} className={ctaClass}>
                  {step2Loading ? 'Creating…' : 'Next →'}
                </button>
              </div>
            )}

            {/* ─── Step 3 — First Stylist ───────────────────────────────── */}
            {step === 3 && (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-[#8B2E4A] uppercase tracking-wide mb-1">Step 2 of 4</p>
                  <h2 className="text-xl font-bold text-stone-900" style={{ fontFamily: "'DM Serif Display', serif" }}>
                    Add Your First Stylist
                  </h2>
                </div>
                {step3Error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">{step3Error}</div>
                )}
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Stylist Name *</label>
                    <input value={stylistName} onChange={(e) => setStylistName(e.target.value)} placeholder="Jane Smith" className={inputClass} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-2">Color</label>
                    <div className="flex flex-wrap gap-2">
                      {COLOR_PALETTE.map((c) => (
                        <button
                          key={c}
                          onClick={() => setStylistColor(c)}
                          className="w-8 h-8 rounded-full transition-all"
                          style={{
                            backgroundColor: c,
                            outline: stylistColor === c ? `3px solid ${c}` : 'none',
                            outlineOffset: '2px',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Commission %</label>
                    <input type="number" min="0" max="100" value={commission} onChange={(e) => setCommission(e.target.value)} className={inputClass} />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button onClick={() => handleStep3(false)} disabled={step3Loading} className={ctaClass}>
                    {step3Loading ? 'Adding…' : 'Add Stylist & Continue →'}
                  </button>
                  <button onClick={() => handleStep3(true)} className={skipClass}>
                    Skip for now →
                  </button>
                </div>
              </div>
            )}

            {/* ─── Step 4 — Services ────────────────────────────────────── */}
            {step === 4 && (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-[#8B2E4A] uppercase tracking-wide mb-1">Step 3 of 4</p>
                  <h2 className="text-xl font-bold text-stone-900" style={{ fontFamily: "'DM Serif Display', serif" }}>
                    Add Your Services
                  </h2>
                  {servicesAdded > 0 && (
                    <p className="text-xs text-rose-600 font-medium mt-1">
                      {servicesAdded} service{servicesAdded !== 1 ? 's' : ''} added
                    </p>
                  )}
                </div>

                {/* ── Mode: choose ── */}
                {serviceMode === 'choose' && (
                  <div className="space-y-3">
                    <button onClick={() => setServiceMode('import')} className={optionCardClass}>
                      <div className="font-semibold text-stone-800 text-sm">📄 Import Price Sheet</div>
                      <div className="text-xs text-stone-400 mt-0.5">Upload a PDF, CSV, or Excel file</div>
                    </button>
                    <button onClick={() => setServiceMode('manual')} className={optionCardClass}>
                      <div className="font-semibold text-stone-800 text-sm">✏️ Add Manually</div>
                      <div className="text-xs text-stone-400 mt-0.5">Enter services one at a time</div>
                    </button>
                    <button onClick={() => setStep(5)} className={skipClass}>
                      Skip for now →
                    </button>
                  </div>
                )}

                {/* ── Mode: manual ── */}
                {serviceMode === 'manual' && (
                  <div className="space-y-4">
                    <button onClick={() => setServiceMode('choose')} className="text-xs text-stone-400 hover:text-stone-600 transition-colors">
                      ← Change method
                    </button>
                    {step4Error && (
                      <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">{step4Error}</div>
                    )}
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Service Name *</label>
                        <input value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder="Haircut & Style" className={inputClass} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Price</label>
                          <input value={servicePrice} onChange={(e) => setServicePrice(e.target.value)} placeholder="$25.00" className={inputClass} />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Duration (min)</label>
                          <input type="number" value={serviceDuration} onChange={(e) => setServiceDuration(e.target.value)} className={inputClass} />
                        </div>
                      </div>
                      <button
                        onClick={handleAddService}
                        disabled={step4Loading}
                        className="w-full py-2.5 rounded-xl border-2 border-dashed border-stone-200 text-stone-500 hover:border-[#8B2E4A] hover:text-[#8B2E4A] text-sm font-medium transition-all disabled:opacity-50"
                      >
                        {step4Loading ? 'Adding…' : '+ Add this service'}
                      </button>
                    </div>
                    <div className="pt-2 space-y-2 border-t border-stone-100">
                      <button onClick={() => setStep(5)} className={ctaClass}>
                        Continue →
                      </button>
                      <button onClick={() => setStep(5)} className={skipClass}>
                        Skip for now →
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Mode: import ── */}
                {serviceMode === 'import' && (
                  <div className="space-y-4">
                    <button onClick={() => { setServiceMode('choose'); setImportRows([]); setImportError(null) }} className="text-xs text-stone-400 hover:text-stone-600 transition-colors">
                      ← Back
                    </button>

                    {/* Upload zone */}
                    {!importRows.length && !importSaved && (
                      <div className="space-y-3">
                        <label className="block border-2 border-dashed border-stone-200 rounded-2xl p-8 text-center cursor-pointer hover:border-[#8B2E4A] transition-all">
                          <input
                            type="file"
                            accept=".pdf,.csv,.xlsx,.xls"
                            className="hidden"
                            onChange={handleServiceFileChange}
                            disabled={importLoading}
                          />
                          {importLoading ? (
                            <div className="text-stone-400 text-sm">Parsing file…</div>
                          ) : (
                            <>
                              <div className="text-stone-400 text-sm">Click to browse or drop a file</div>
                              <div className="text-xs text-stone-300 mt-1">PDF, CSV, or Excel (.xlsx, .xls)</div>
                            </>
                          )}
                        </label>
                        {importError && <p className="text-xs text-red-600">{importError}</p>}
                      </div>
                    )}

                    {/* Preview */}
                    {importRows.length > 0 && !importSaved && (
                      <div className="space-y-3">
                        <div className="text-xs text-stone-500">
                          {importRows.filter(r => r.include).length} of {importRows.length} services selected
                        </div>
                        <div className="max-h-52 overflow-y-auto space-y-1 border border-stone-100 rounded-xl p-2">
                          {importRows.map((row, i) => (
                            <div key={i} className="flex items-center gap-2 py-1 px-1">
                              <input
                                type="checkbox"
                                checked={row.include}
                                onChange={() => setImportRows(prev => prev.map((r, j) => j === i ? { ...r, include: !r.include } : r))}
                                className="shrink-0"
                              />
                              <span className="flex-1 truncate text-sm text-stone-800">{row.name}</span>
                              {row.pricingType && row.pricingType !== 'fixed' && (
                                <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md shrink-0 ${
                                  row.pricingType === 'addon' ? 'bg-amber-50 text-amber-700' :
                                  row.pricingType === 'tiered' ? 'bg-purple-50 text-purple-700' :
                                  'bg-blue-50 text-blue-700'
                                }`}>
                                  {row.pricingType === 'addon' ? 'add-on' : row.pricingType === 'tiered' ? 'tiered' : 'options'}
                                </span>
                              )}
                              <span className="text-sm text-stone-500 shrink-0">
                                {row.pricingType === 'addon' ? `+$${((row.addonAmountCents ?? 0) / 100).toFixed(2)}` : `$${(row.priceCents / 100).toFixed(2)}`}
                              </span>
                            </div>
                          ))}
                        </div>
                        {importError && <p className="text-xs text-red-600">{importError}</p>}
                        <button
                          onClick={handleBulkImportServices}
                          disabled={importLoading || importRows.filter(r => r.include).length === 0}
                          className={ctaClass}
                        >
                          {importLoading ? 'Importing…' : `Import ${importRows.filter(r => r.include).length} service${importRows.filter(r => r.include).length !== 1 ? 's' : ''}`}
                        </button>
                      </div>
                    )}

                    {/* Saved */}
                    {importSaved && (
                      <div className="space-y-4">
                        <div className="text-center py-4">
                          <div className="text-green-600 font-semibold text-sm">
                            ✓ {servicesAdded} service{servicesAdded !== 1 ? 's' : ''} imported
                          </div>
                        </div>
                        <button onClick={() => setStep(5)} className={ctaClass}>
                          Continue →
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ─── Step 5 — Residents ───────────────────────────────────── */}
            {step === 5 && (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-[#8B2E4A] uppercase tracking-wide mb-1">Step 4 of 4</p>
                  <h2 className="text-xl font-bold text-stone-900" style={{ fontFamily: "'DM Serif Display', serif" }}>
                    Add Residents
                  </h2>
                  {residentsAdded > 0 && (
                    <p className="text-xs text-rose-600 font-medium mt-1">
                      {residentsAdded} resident{residentsAdded !== 1 ? 's' : ''} added
                    </p>
                  )}
                </div>

                {/* ── Mode: choose ── */}
                {residentMode === 'choose' && (
                  <div className="space-y-3">
                    <button onClick={() => setResidentMode('import')} className={optionCardClass}>
                      <div className="font-semibold text-stone-800 text-sm">📋 Import from CSV/Excel</div>
                      <div className="text-xs text-stone-400 mt-0.5">Upload a spreadsheet with resident names and rooms</div>
                    </button>
                    <button onClick={() => setResidentMode('manual')} className={optionCardClass}>
                      <div className="font-semibold text-stone-800 text-sm">✏️ Add Manually</div>
                      <div className="text-xs text-stone-400 mt-0.5">Enter residents one at a time</div>
                    </button>
                    <button onClick={() => setStep(6)} className={skipClass}>
                      Skip for now →
                    </button>
                  </div>
                )}

                {/* ── Mode: manual ── */}
                {residentMode === 'manual' && (
                  <div className="space-y-4">
                    <button onClick={() => setResidentMode('choose')} className="text-xs text-stone-400 hover:text-stone-600 transition-colors">
                      ← Change method
                    </button>
                    {step5Error && (
                      <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">{step5Error}</div>
                    )}
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Resident Name *</label>
                        <input value={residentName} onChange={(e) => setResidentName(e.target.value)} placeholder="Jane Doe" className={inputClass} />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1">Room Number</label>
                        <input value={residentRoom} onChange={(e) => setResidentRoom(e.target.value)} placeholder="101" className={inputClass} />
                      </div>
                      <button
                        onClick={handleAddResident}
                        disabled={step5Loading}
                        className="w-full py-2.5 rounded-xl border-2 border-dashed border-stone-200 text-stone-500 hover:border-[#8B2E4A] hover:text-[#8B2E4A] text-sm font-medium transition-all disabled:opacity-50"
                      >
                        {step5Loading ? 'Adding…' : '+ Add this resident'}
                      </button>
                    </div>
                    <div className="pt-2 space-y-2 border-t border-stone-100">
                      <button onClick={() => setStep(6)} className={ctaClass}>
                        Continue →
                      </button>
                      <button onClick={() => setStep(6)} className={skipClass}>
                        Skip for now →
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Mode: import ── */}
                {residentMode === 'import' && (
                  <div className="space-y-4">
                    <button onClick={() => { setResidentMode('choose'); setResidentRows([]); setResidentImportError(null) }} className="text-xs text-stone-400 hover:text-stone-600 transition-colors">
                      ← Back
                    </button>

                    {/* Upload zone */}
                    {!residentRows.length && !residentImportSaved && (
                      <div className="space-y-3">
                        <label className="block border-2 border-dashed border-stone-200 rounded-2xl p-8 text-center cursor-pointer hover:border-[#8B2E4A] transition-all">
                          <input
                            type="file"
                            accept=".csv,.xlsx,.xls"
                            className="hidden"
                            onChange={handleResidentFileChange}
                            disabled={residentImportLoading}
                          />
                          {residentImportLoading ? (
                            <div className="text-stone-400 text-sm">Parsing file…</div>
                          ) : (
                            <>
                              <div className="text-stone-400 text-sm">Click to browse or drop a file</div>
                              <div className="text-xs text-stone-300 mt-1">CSV or Excel (.xlsx, .xls)</div>
                            </>
                          )}
                        </label>
                        {residentImportError && <p className="text-xs text-red-600">{residentImportError}</p>}
                      </div>
                    )}

                    {/* Preview */}
                    {residentRows.length > 0 && !residentImportSaved && (
                      <div className="space-y-3">
                        <div className="text-xs text-stone-500">
                          {residentRows.filter(r => r.include).length} of {residentRows.length} residents selected
                        </div>
                        <div className="max-h-52 overflow-y-auto space-y-1 border border-stone-100 rounded-xl p-2">
                          {residentRows.map((row, i) => (
                            <div key={i} className="flex items-center gap-2 py-1 px-1">
                              <input
                                type="checkbox"
                                checked={row.include}
                                onChange={() => setResidentRows(prev => prev.map((r, j) => j === i ? { ...r, include: !r.include } : r))}
                                className="shrink-0"
                              />
                              <span className="flex-1 truncate text-sm text-stone-800">{row.name}</span>
                              {row.roomNumber && (
                                <span className="text-xs text-stone-400 shrink-0">Rm {row.roomNumber}</span>
                              )}
                            </div>
                          ))}
                        </div>
                        {residentImportError && <p className="text-xs text-red-600">{residentImportError}</p>}
                        <button
                          onClick={handleBulkImportResidents}
                          disabled={residentImportLoading || residentRows.filter(r => r.include).length === 0}
                          className={ctaClass}
                        >
                          {residentImportLoading ? 'Importing…' : `Import ${residentRows.filter(r => r.include).length} resident${residentRows.filter(r => r.include).length !== 1 ? 's' : ''}`}
                        </button>
                      </div>
                    )}

                    {/* Saved */}
                    {residentImportSaved && (
                      <div className="space-y-4">
                        <div className="text-center py-4">
                          <div className="text-green-600 font-semibold text-sm">
                            ✓ {residentsAdded} resident{residentsAdded !== 1 ? 's' : ''} imported
                          </div>
                        </div>
                        <button onClick={() => setStep(6)} className={ctaClass}>
                          Continue →
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ─── Step 6 — Done ────────────────────────────────────────── */}
            {step === 6 && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-stone-900 mb-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
                    You&apos;re all set!
                  </h2>
                  <p className="text-stone-500 text-sm">
                    Here&apos;s a summary of what was added.
                  </p>
                </div>

                {/* Setup summary */}
                <div className="bg-stone-50 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-green-500 text-base">✓</span>
                    <span className="text-stone-700 font-medium text-sm flex-1">{facilityName}</span>
                    <span className="text-stone-400 text-xs">Facility created</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {stylistsAdded > 0 ? (
                      <>
                        <span className="text-green-500 text-base">✓</span>
                        <span className="text-stone-700 text-sm flex-1">{stylistsAdded} stylist added</span>
                      </>
                    ) : (
                      <>
                        <span className="text-stone-300 text-base">○</span>
                        <span className="text-stone-400 text-sm flex-1">No stylists — add them in Settings</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {servicesAdded > 0 ? (
                      <>
                        <span className="text-green-500 text-base">✓</span>
                        <span className="text-stone-700 text-sm flex-1">{servicesAdded} service{servicesAdded !== 1 ? 's' : ''} added</span>
                      </>
                    ) : (
                      <>
                        <span className="text-stone-300 text-base">○</span>
                        <span className="text-stone-400 text-sm flex-1">No services — add them later</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {residentsAdded > 0 ? (
                      <>
                        <span className="text-green-500 text-base">✓</span>
                        <span className="text-stone-700 text-sm flex-1">{residentsAdded} resident{residentsAdded !== 1 ? 's' : ''} added</span>
                      </>
                    ) : (
                      <>
                        <span className="text-stone-300 text-base">○</span>
                        <span className="text-stone-400 text-sm flex-1">No residents — add them later</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => router.push('/dashboard')}
                  className={ctaClass}
                >
                  Go to Dashboard →
                </button>
              </div>
            )}

          </div>
        </div>

        {/* Step counter */}
        {step > 1 && step < 6 && (
          <p className="text-center text-xs text-stone-400 mt-4">
            Step {step - 1} of 5
          </p>
        )}
      </div>
    </div>
  )
}
