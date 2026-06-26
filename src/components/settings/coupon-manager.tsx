'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/components/ui/toast'

interface Coupon {
  id: string
  code: string
  type: string
  discountType: string
  discountValue: number
  description: string | null
  maxRedemptions: number | null
  maxPerAccount: number | null
  expiresAt: string | null
  active: boolean
  redemptionCount: number
}

interface Recipient {
  residentId: string
  residentName: string
  roomNumber: string | null
  portalAccountId: string
  email: string
}

const TYPES = ['manual', 'welcome', 'birthday', 'referral', 'loyalty'] as const

function discountLabel(t: string, v: number): string {
  return t === 'fixed' ? `$${(v / 100).toFixed(2)} off` : `${v}% off`
}

export function CouponManager() {
  const { toast } = useToast()
  const [coupons, setCoupons] = useState<Coupon[] | null>(null)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [showForm, setShowForm] = useState(false)
  const [issuingFor, setIssuingFor] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // create form
  const [code, setCode] = useState('')
  const [type, setType] = useState<string>('manual')
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed')
  const [value, setValue] = useState('')
  const [description, setDescription] = useState('')
  const [maxRedemptions, setMaxRedemptions] = useState('')
  const [maxPerAccount, setMaxPerAccount] = useState('1')
  const [expiresAt, setExpiresAt] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch('/api/facility/coupons')
      .then((r) => r.json())
      .then((j) => setCoupons(j.data ?? []))
      .catch(() => setCoupons([]))
    fetch('/api/facility/coupons/recipients')
      .then((r) => r.json())
      .then((j) => setRecipients(j.data ?? []))
      .catch(() => {})
  }, [])

  const resetForm = () => {
    setCode(''); setType('manual'); setDiscountType('fixed'); setValue('')
    setDescription(''); setMaxRedemptions(''); setMaxPerAccount('1'); setExpiresAt('')
  }

  const handleCreate = async () => {
    const num = discountType === 'fixed' ? Math.round(parseFloat(value) * 100) : parseInt(value, 10)
    if (!num || num <= 0 || (discountType === 'percent' && num > 100)) {
      toast.error(discountType === 'percent' ? 'Enter a percentage 1–100' : 'Enter a dollar amount')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/facility/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim() || undefined,
          type,
          discountType,
          discountValue: num,
          description: description.trim() || null,
          maxRedemptions: maxRedemptions ? parseInt(maxRedemptions, 10) : null,
          maxPerAccount: maxPerAccount ? parseInt(maxPerAccount, 10) : 1,
          expiresAt: expiresAt ? new Date(expiresAt + 'T23:59:59').toISOString() : null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        setCoupons((prev) => [{ ...j.data, redemptionCount: 0 }, ...(prev ?? [])])
        toast.success('Coupon created')
        resetForm()
        setShowForm(false)
      } else {
        toast.error(typeof j.error === 'string' ? j.error : 'Failed to create coupon')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setCreating(false)
    }
  }

  const toggleActive = async (c: Coupon) => {
    setBusyId(c.id)
    try {
      const res = await fetch(`/api/facility/coupons/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !c.active }),
      })
      if (res.ok) {
        setCoupons((prev) => (prev ?? []).map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)))
      } else {
        toast.error('Failed to update')
      }
    } finally {
      setBusyId(null)
    }
  }

  const issue = async (couponId: string, residentId: string) => {
    setBusyId(couponId)
    try {
      const res = await fetch(`/api/facility/coupons/${couponId}/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success('Coupon issued to the family')
        setCoupons((prev) => (prev ?? []).map((x) => (x.id === couponId ? { ...x, redemptionCount: x.redemptionCount + (j.data?.issued ?? 1) } : x)))
        setIssuingFor(null)
      } else {
        toast.error(typeof j.error === 'string' ? j.error : 'Failed to issue')
      }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="border-t border-stone-100 pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-stone-700">Coupons</p>
          <p className="text-xs text-stone-500">Create discount coupons and issue them to families.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className="text-xs font-semibold text-[#8B2E4A] border border-[#E8C4CF] rounded-lg px-3 py-1.5 hover:bg-[#F9EFF2]"
        >
          {showForm ? 'Cancel' : '+ New coupon'}
        </button>
      </div>

      {showForm && (
        <div className="bg-stone-50 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-stone-600 block mb-1">Code (optional)</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="auto-generated" className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm uppercase focus:outline-none focus:border-[#8B2E4A]/50" />
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-600 block mb-1">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]/50">
                {TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-600 block mb-1">Discount type</label>
              <select value={discountType} onChange={(e) => { setDiscountType(e.target.value as 'fixed' | 'percent'); setValue('') }} className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]/50">
                <option value="fixed">Fixed amount ($)</option>
                <option value="percent">Percentage (%)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-600 block mb-1">{discountType === 'fixed' ? 'Amount ($)' : 'Percent (1–100)'}</label>
              <input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder={discountType === 'fixed' ? '10.00' : '15'} className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]/50" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-stone-600 block mb-1">Description (optional)</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Holiday discount" className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]/50" />
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-600 block mb-1">Max total uses</label>
              <input type="number" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="unlimited" className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]/50" />
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-600 block mb-1">Expires (optional)</label>
              <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]/50" />
            </div>
          </div>
          <button type="button" onClick={handleCreate} disabled={creating} className="bg-[#8B2E4A] text-white text-xs font-semibold rounded-lg px-4 py-2 hover:bg-[#72253C] disabled:opacity-60">
            {creating ? 'Creating…' : 'Create coupon'}
          </button>
        </div>
      )}

      {coupons === null ? (
        <p className="text-xs text-stone-400">Loading coupons…</p>
      ) : coupons.length === 0 ? (
        <p className="text-xs text-stone-400">No coupons yet.</p>
      ) : (
        <div className="space-y-2">
          {coupons.map((c) => (
            <div key={c.id} className={`rounded-xl border px-4 py-3 ${c.active ? 'border-stone-200 bg-white' : 'border-stone-100 bg-stone-50 opacity-70'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-[#8B2E4A] font-mono">{c.code}</span>
                    <span className="text-xs font-semibold text-stone-700">{discountLabel(c.discountType, c.discountValue)}</span>
                    <span className="text-[10px] font-semibold bg-stone-100 text-stone-500 rounded-full px-2 py-0.5">{c.type}</span>
                    {!c.active && <span className="text-[10px] font-semibold bg-stone-200 text-stone-500 rounded-full px-2 py-0.5">inactive</span>}
                  </div>
                  {c.description && <p className="text-xs text-stone-500 mt-0.5">{c.description}</p>}
                  <p className="text-[11px] text-stone-400 mt-0.5">
                    Used {c.redemptionCount}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''} ·{' '}
                    {c.expiresAt ? `Expires ${new Date(c.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No expiry'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={() => setIssuingFor(issuingFor === c.id ? null : c.id)} disabled={!c.active} className="text-xs font-semibold text-[#8B2E4A] border border-[#E8C4CF] rounded-lg px-2.5 py-1 hover:bg-[#F9EFF2] disabled:opacity-40">
                    Issue
                  </button>
                  <button type="button" onClick={() => toggleActive(c)} disabled={busyId === c.id} className="text-xs font-semibold text-stone-500 border border-stone-200 rounded-lg px-2.5 py-1 hover:bg-stone-50 disabled:opacity-40">
                    {c.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>

              {issuingFor === c.id && (
                <div className="mt-3 pt-3 border-t border-stone-100">
                  {recipients.length === 0 ? (
                    <p className="text-xs text-stone-400">No families with portal accounts yet.</p>
                  ) : (
                    <div>
                      <label className="text-xs font-semibold text-stone-600 block mb-1">Issue to family</label>
                      <select
                        defaultValue=""
                        disabled={busyId === c.id}
                        onChange={(e) => { if (e.target.value) issue(c.id, e.target.value) }}
                        className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]/50"
                      >
                        <option value="">Select a resident…</option>
                        {recipients.map((r) => (
                          <option key={`${r.residentId}-${r.portalAccountId}`} value={r.residentId}>
                            {r.residentName}{r.roomNumber ? ` (Rm ${r.roomNumber})` : ''} — {r.email}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
