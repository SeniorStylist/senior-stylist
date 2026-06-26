'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { DefaultTipPicker, type DefaultTipValue } from '@/components/residents/default-tip-picker'

interface ResidentRow {
  id: string
  name: string
  roomNumber: string | null
  defaultTipType: string | null
  defaultTipValue: number | null
  phone: string | null
  poaName: string | null
  poaEmail: string | null
  poaPhone: string | null
  poaAddress: string | null
  poaCity: string | null
}

interface CouponInfo {
  id: string
  code: string
  type: string
  discountType: string
  discountValue: number
  description: string | null
  expiresAt: Date | string | null
  redemptionId: string
  bookingId: string | null
}

function formatCouponDiscount(discountType: string, discountValue: number): string {
  if (discountType === 'fixed') return `$${(discountValue / 100).toFixed(2)} off`
  return `${discountValue}% off`
}

interface Props {
  residents: ResidentRow[]
  facilityCode: string
  coupons: CouponInfo[]
}

export function ProfileClient({ residents, coupons }: Props) {
  return (
    <div className="py-6 pb-32">
      <h1
        className="text-2xl font-normal text-stone-900 mb-1"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        Profile
      </h1>
      <p className="text-sm text-stone-500 mb-6">Your contact info, tip preferences, and account rewards.</p>

      {coupons.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Your Discounts</h2>
          <div className="space-y-2">
            {coupons.map((c) => (
              <div key={c.redemptionId} className="rounded-2xl border border-[#F9EFF2] bg-[#FEF8FA] px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#8B2E4A]">{formatCouponDiscount(c.discountType, c.discountValue)}</p>
                  {c.description && <p className="text-xs text-stone-500 mt-0.5">{c.description}</p>}
                  {c.expiresAt && (
                    <p className="text-xs text-stone-400 mt-0.5">
                      Expires {new Date(c.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                </div>
                <span className="text-[10px] font-mono font-bold bg-[#8B2E4A]/10 text-[#8B2E4A] rounded-full px-2.5 py-1">
                  {c.code}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-6">
        <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Contact Information</h2>
        {residents.length === 0 ? (
          <p className="text-sm text-stone-500">No residents linked to this account.</p>
        ) : (
          <div className="space-y-4">
            {residents.map((r) => (
              <ContactCard key={r.id} resident={r} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Tip Preferences</h2>
        {residents.length === 0 ? (
          <p className="text-sm text-stone-500">No residents linked to this account.</p>
        ) : (
          <div className="space-y-4">
            {residents.map((r) => (
              <ResidentCard key={r.id} resident={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <div>
      <label className="text-xs font-medium text-stone-600 block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A] disabled:bg-stone-50 disabled:text-stone-400"
      />
    </div>
  )
}

function ContactCard({ resident }: { resident: ResidentRow }) {
  const { toast } = useToast()
  const [form, setForm] = useState({
    phone: resident.phone ?? '',
    poaName: resident.poaName ?? '',
    poaPhone: resident.poaPhone ?? '',
    poaAddress: resident.poaAddress ?? '',
    poaCity: resident.poaCity ?? '',
  })
  const [saved, setSaved] = useState(form)
  const [saving, setSaving] = useState(false)

  const dirty = (Object.keys(form) as Array<keyof typeof form>).some((k) => form[k] !== saved[k])
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/portal/residents/${resident.id}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success('Contact info saved')
        setSaved(form)
      } else {
        toast.error(typeof j.error === 'string' ? j.error : 'Failed to save')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-4">
        <p className="text-base font-semibold text-stone-900">{resident.name}</p>
        {resident.roomNumber && <p className="text-xs text-stone-500">Room {resident.roomNumber}</p>}
      </div>

      <div className="space-y-3">
        <Field label="Resident phone" value={form.phone} onChange={set('phone')} type="tel" placeholder="(555) 555-5555" disabled={saving} />

        <div className="pt-2 border-t border-stone-100">
          <p className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide mb-2 mt-1">Power of Attorney / Contact</p>
          <div className="space-y-3">
            <Field label="Name" value={form.poaName} onChange={set('poaName')} placeholder="Full name" disabled={saving} />
            <Field label="Phone" value={form.poaPhone} onChange={set('poaPhone')} type="tel" placeholder="(555) 555-5555" disabled={saving} />
            <Field label="Address" value={form.poaAddress} onChange={set('poaAddress')} placeholder="Street address" disabled={saving} />
            <Field label="City" value={form.poaCity} onChange={set('poaCity')} placeholder="City" disabled={saving} />
            <div>
              <label className="text-xs font-medium text-stone-600 block mb-1">Email</label>
              <input
                type="email"
                value={resident.poaEmail ?? ''}
                disabled
                readOnly
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-stone-200 text-sm bg-stone-50 text-stone-400"
              />
              <p className="text-[11px] text-stone-400 mt-1">Your email is your login — contact the facility to change it.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={handleSave} disabled={!dirty || saving} variant="primary">
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

function ResidentCard({ resident }: { resident: ResidentRow }) {
  const { toast } = useToast()
  const [tip, setTip] = useState<DefaultTipValue>({
    type: (resident.defaultTipType as 'percentage' | 'fixed' | null) ?? null,
    value: resident.defaultTipValue ?? null,
  })
  const [saving, setSaving] = useState(false)

  const initialTip: DefaultTipValue = {
    type: (resident.defaultTipType as 'percentage' | 'fixed' | null) ?? null,
    value: resident.defaultTipValue ?? null,
  }
  const dirty = tip.type !== initialTip.type || tip.value !== initialTip.value

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/portal/residents/${resident.id}/tip-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultTipType: tip.type, defaultTipValue: tip.value }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success('Saved')
        resident.defaultTipType = tip.type
        resident.defaultTipValue = tip.value
      } else {
        toast.error(j.error ?? 'Failed to save')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-4">
        <p className="text-base font-semibold text-stone-900">{resident.name}</p>
        {resident.roomNumber && <p className="text-xs text-stone-500">Room {resident.roomNumber}</p>}
      </div>

      <DefaultTipPicker value={tip} onChange={setTip} disabled={saving} />

      <div className="mt-4 flex justify-end">
        <Button onClick={handleSave} disabled={!dirty || saving} variant="primary">
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
