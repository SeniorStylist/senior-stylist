'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Step = 1 | 2 | 3 | 4 | 5

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

export default function OnboardingClient() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)

  // Step 2 state
  const [facilityName, setFacilityName] = useState('')
  const [facilityAddress, setFacilityAddress] = useState('')
  const [facilityPhone, setFacilityPhone] = useState('')
  const [timezone, setTimezone] = useState('America/New_York')
  const [paymentType, setPaymentType] = useState('facility')
  const [facilityId, setFacilityId] = useState<string | null>(null)
  const [step2Error, setStep2Error] = useState<string | null>(null)
  const [step2Loading, setStep2Loading] = useState(false)

  // Step 3 state
  const [stylistName, setStylistName] = useState('')
  const [stylistColor, setStylistColor] = useState('#0D7377')
  const [commission, setCommission] = useState('0')
  const [step3Loading, setStep3Loading] = useState(false)
  const [step3Error, setStep3Error] = useState<string | null>(null)

  // Step 4 state
  const [serviceName, setServiceName] = useState('')
  const [servicePrice, setServicePrice] = useState('')
  const [serviceDuration, setServiceDuration] = useState('30')
  const [step4Loading, setStep4Loading] = useState(false)
  const [step4Error, setStep4Error] = useState<string | null>(null)
  const [servicesAdded, setServicesAdded] = useState(0)

  const progress = (step / 5) * 100

  const handleStep2 = async () => {
    if (!facilityName.trim()) { setStep2Error('Facility name is required'); return }
    setStep2Loading(true)
    setStep2Error(null)
    try {
      // Create facility
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

      const newFacilityId = json.data.id
      setFacilityId(newFacilityId)

      // Activate it
      await fetch('/api/facilities/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId: newFacilityId }),
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

  const inputClass = 'w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-[#0D7377] focus:ring-2 focus:ring-teal-100 transition-all'
  const selectClass = 'w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#0D7377] transition-all'

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
              className="h-full bg-[#0D7377] transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="p-8">
            {/* Step 1 — Welcome */}
            {step === 1 && (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 bg-[#0D7377] rounded-2xl flex items-center justify-center mx-auto">
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
                <button
                  onClick={() => setStep(2)}
                  className="w-full py-3.5 rounded-2xl bg-[#0D7377] text-white font-semibold text-base active:scale-[0.98] transition-all shadow-sm"
                >
                  Get Started →
                </button>
              </div>
            )}

            {/* Step 2 — Facility */}
            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-[#0D7377] uppercase tracking-wide mb-1">Step 1 of 4</p>
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
                        <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
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
                <button
                  onClick={handleStep2}
                  disabled={step2Loading}
                  className="w-full py-3.5 rounded-2xl bg-[#0D7377] text-white font-semibold text-base disabled:opacity-50 active:scale-[0.98] transition-all shadow-sm"
                >
                  {step2Loading ? 'Creating…' : 'Next →'}
                </button>
              </div>
            )}

            {/* Step 3 — First Stylist */}
            {step === 3 && (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-[#0D7377] uppercase tracking-wide mb-1">Step 2 of 4</p>
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
                  <button
                    onClick={() => handleStep3(false)}
                    disabled={step3Loading}
                    className="w-full py-3.5 rounded-2xl bg-[#0D7377] text-white font-semibold text-base disabled:opacity-50 active:scale-[0.98] transition-all shadow-sm"
                  >
                    {step3Loading ? 'Adding…' : 'Add Stylist & Continue →'}
                  </button>
                  <button onClick={() => handleStep3(true)} className="text-sm text-stone-400 hover:text-stone-600 transition-colors py-1">
                    Skip for now
                  </button>
                </div>
              </div>
            )}

            {/* Step 4 — Services */}
            {step === 4 && (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-[#0D7377] uppercase tracking-wide mb-1">Step 3 of 4</p>
                  <h2 className="text-xl font-bold text-stone-900" style={{ fontFamily: "'DM Serif Display', serif" }}>
                    Add Your Services
                  </h2>
                  {servicesAdded > 0 && (
                    <p className="text-xs text-teal-600 font-medium mt-1">{servicesAdded} service{servicesAdded !== 1 ? 's' : ''} added</p>
                  )}
                </div>
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
                    className="w-full py-2.5 rounded-xl border-2 border-dashed border-stone-200 text-stone-500 hover:border-[#0D7377] hover:text-[#0D7377] text-sm font-medium transition-all disabled:opacity-50"
                  >
                    {step4Loading ? 'Adding…' : '+ Add this service'}
                  </button>
                </div>
                <div className="pt-2 space-y-2 border-t border-stone-100">
                  <a
                    href="/services"
                    className="block w-full py-3.5 rounded-2xl bg-[#0D7377] text-white font-semibold text-base text-center active:scale-[0.98] transition-all shadow-sm"
                    onClick={() => setStep(5)}
                  >
                    Continue →
                  </a>
                  <button onClick={() => setStep(5)} className="w-full text-sm text-stone-400 hover:text-stone-600 transition-colors py-1">
                    Skip for now
                  </button>
                </div>
              </div>
            )}

            {/* Step 5 — Done */}
            {step === 5 && (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-stone-900 mb-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
                    You&apos;re all set!
                  </h2>
                  <p className="text-stone-500 text-sm">
                    Your salon is ready to go. Head to the dashboard to start scheduling appointments.
                  </p>
                </div>
                <button
                  onClick={() => router.push('/dashboard')}
                  className="w-full py-3.5 rounded-2xl bg-[#0D7377] text-white font-semibold text-base active:scale-[0.98] transition-all shadow-sm"
                >
                  Go to Dashboard →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Step counter */}
        <p className="text-center text-xs text-stone-400 mt-4">
          Step {step} of 5
        </p>
      </div>
    </div>
  )
}
