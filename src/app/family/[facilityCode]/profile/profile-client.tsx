'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { DefaultTipPicker, type DefaultTipValue } from '@/components/residents/default-tip-picker'
import { usePortalT, portalLocale, type PortalLang, type PortalT } from '@/lib/portal-i18n'

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

function formatCouponDiscount(discountType: string, discountValue: number, t: PortalT): string {
  if (discountType === 'fixed') return t('profile.amountOff', { amount: `$${(discountValue / 100).toFixed(2)}` })
  return t('profile.percentOff', { value: discountValue })
}

interface Props {
  residents: ResidentRow[]
  facilityCode: string
  coupons: CouponInfo[]
  lang: PortalLang
}

export function ProfileClient({ residents, coupons, lang }: Props) {
  const t = usePortalT(lang)
  const locale = portalLocale(lang)
  return (
    <div className="py-6 pb-32">
      <h1
        className="text-2xl font-normal text-stone-900 mb-1"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        {t('profile.title')}
      </h1>
      <p className="text-sm text-stone-500 mb-6">{t('profile.subtitle')}</p>

      {coupons.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">{t('profile.discounts')}</h2>
          <div className="space-y-2">
            {coupons.map((c) => (
              <div key={c.redemptionId} className="rounded-2xl border border-[#F9EFF2] bg-[#FEF8FA] px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#8B2E4A]">{formatCouponDiscount(c.discountType, c.discountValue, t)}</p>
                  {c.description && <p className="text-xs text-stone-500 mt-0.5">{c.description}</p>}
                  {c.expiresAt && (
                    <p className="text-xs text-stone-400 mt-0.5">
                      {t('profile.expires', { date: new Date(c.expiresAt).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }) })}
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
        <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">{t('profile.contactInfo')}</h2>
        {residents.length === 0 ? (
          <p className="text-sm text-stone-500">{t('profile.noResidents')}</p>
        ) : (
          <div className="space-y-4">
            {residents.map((r) => (
              <ContactCard key={r.id} resident={r} t={t} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">{t('profile.tipPreferences')}</h2>
        {residents.length === 0 ? (
          <p className="text-sm text-stone-500">{t('profile.noResidents')}</p>
        ) : (
          <div className="space-y-4">
            {residents.map((r) => (
              <ResidentCard key={r.id} resident={r} t={t} />
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

function ContactCard({ resident, t }: { resident: ResidentRow; t: PortalT }) {
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
        toast.success(t('profile.contactSaved'))
        setSaved(form)
      } else {
        toast.error(typeof j.error === 'string' ? j.error : t('profile.saveFailed'))
      }
    } catch {
      toast.error(t('common.networkError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-4">
        <p className="text-base font-semibold text-stone-900">{resident.name}</p>
        {resident.roomNumber && <p className="text-xs text-stone-500">{t('profile.room', { n: resident.roomNumber })}</p>}
      </div>

      <div className="space-y-3">
        <Field label={t('profile.residentPhone')} value={form.phone} onChange={set('phone')} type="tel" placeholder="(555) 555-5555" disabled={saving} />

        <div className="pt-2 border-t border-stone-100">
          <p className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide mb-2 mt-1">{t('profile.poaSection')}</p>
          <div className="space-y-3">
            <Field label={t('profile.name')} value={form.poaName} onChange={set('poaName')} placeholder={t('profile.fullNamePlaceholder')} disabled={saving} />
            <Field label={t('profile.phone')} value={form.poaPhone} onChange={set('poaPhone')} type="tel" placeholder="(555) 555-5555" disabled={saving} />
            <Field label={t('profile.address')} value={form.poaAddress} onChange={set('poaAddress')} placeholder={t('profile.streetPlaceholder')} disabled={saving} />
            <Field label={t('profile.city')} value={form.poaCity} onChange={set('poaCity')} placeholder={t('profile.city')} disabled={saving} />
            <div>
              <label className="text-xs font-medium text-stone-600 block mb-1">{t('profile.email')}</label>
              <input
                type="email"
                value={resident.poaEmail ?? ''}
                disabled
                readOnly
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-stone-200 text-sm bg-stone-50 text-stone-400"
              />
              <p className="text-[11px] text-stone-400 mt-1">{t('profile.emailLocked')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={handleSave} disabled={!dirty || saving} variant="primary">
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  )
}

function ResidentCard({ resident, t }: { resident: ResidentRow; t: PortalT }) {
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
        toast.success(t('profile.saved'))
        resident.defaultTipType = tip.type
        resident.defaultTipValue = tip.value
      } else {
        toast.error(j.error ?? t('profile.saveFailed'))
      }
    } catch {
      toast.error(t('common.networkError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-4">
        <p className="text-base font-semibold text-stone-900">{resident.name}</p>
        {resident.roomNumber && <p className="text-xs text-stone-500">{t('profile.room', { n: resident.roomNumber })}</p>}
      </div>

      <DefaultTipPicker value={tip} onChange={setTip} disabled={saving} />

      <div className="mt-4 flex justify-end">
        <Button onClick={handleSave} disabled={!dirty || saving} variant="primary">
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  )
}
