'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { DefaultTipPicker, type DefaultTipValue } from '@/components/residents/default-tip-picker'
import { formatCouponDiscount, type CouponInfo } from '@/lib/portal-coupons'

interface ResidentRow {
  id: string
  name: string
  roomNumber: string | null
  defaultTipType: string | null
  defaultTipValue: number | null
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
      <p className="text-sm text-stone-500 mb-6">Tip preferences and your account rewards.</p>

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
