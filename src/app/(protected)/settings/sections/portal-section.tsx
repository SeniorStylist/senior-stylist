'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/toast'
import type { PublicFacility } from '@/lib/sanitize'

interface ClaimRequest {
  id: string
  email: string
  fullName: string
  phone: string | null
  dateOfBirth: string | null
  matchType: string | null
  matchConfidence: string | null
  residentName: string | null
  residentRoom: string | null
  createdAt: string
}

interface Props {
  facility: PublicFacility
  claimRequests: ClaimRequest[]
}

export function PortalSection({ facility, claimRequests: initialClaims }: Props) {
  const router = useRouter()
  const { toast } = useToast()

  const f = facility as typeof facility & {
    portalSelfSignupEnabled: boolean
    portalCouponsEnabled: boolean
    portalWelcomeCouponEnabled: boolean
    portalWelcomeCouponType: string | null
    portalWelcomeCouponValue: number | null
  }

  const [selfSignup, setSelfSignup] = useState(f.portalSelfSignupEnabled ?? false)
  const [couponsEnabled, setCouponsEnabled] = useState(f.portalCouponsEnabled ?? false)
  const [welcomeCouponEnabled, setWelcomeCouponEnabled] = useState(f.portalWelcomeCouponEnabled ?? false)
  const [welcomeCouponType, setWelcomeCouponType] = useState<'fixed' | 'percent'>(
    (f.portalWelcomeCouponType as 'fixed' | 'percent') ?? 'fixed'
  )
  const [welcomeCouponValue, setWelcomeCouponValue] = useState<string>(
    f.portalWelcomeCouponValue
      ? welcomeCouponType === 'fixed'
        ? String(f.portalWelcomeCouponValue / 100)
        : String(f.portalWelcomeCouponValue)
      : ''
  )
  const [saving, setSaving] = useState(false)
  const [claims, setClaims] = useState<ClaimRequest[]>(initialClaims)
  const [reviewingId, setReviewingId] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    try {
      const parsedValue = welcomeCouponValue
        ? welcomeCouponType === 'fixed'
          ? Math.round(parseFloat(welcomeCouponValue) * 100)
          : parseInt(welcomeCouponValue, 10)
        : null

      const res = await fetch('/api/facility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portalSelfSignupEnabled: selfSignup,
          portalCouponsEnabled: couponsEnabled,
          portalWelcomeCouponEnabled: welcomeCouponEnabled,
          portalWelcomeCouponType: welcomeCouponEnabled ? welcomeCouponType : null,
          portalWelcomeCouponValue: welcomeCouponEnabled ? parsedValue : null,
        }),
      })
      if (res.ok) {
        toast.success('Portal settings saved')
        router.refresh()
      } else {
        const j = await res.json().catch(() => ({}))
        toast.error(j.error ?? 'Failed to save')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  const handleReview = async (id: string, action: 'approve' | 'reject') => {
    setReviewingId(id)
    try {
      const res = await fetch(`/api/portal/claim-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        setClaims((prev) => prev.filter((c) => c.id !== id))
        toast.success(action === 'approve' ? 'Account approved — welcome email sent' : 'Request declined')
      } else {
        toast.error(j.error ?? 'Failed to update request')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setReviewingId(null)
    }
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const confidenceBadge = (conf: string | null) => {
    if (!conf) return null
    const colors: Record<string, string> = {
      high: 'bg-emerald-50 text-emerald-700',
      medium: 'bg-amber-50 text-amber-700',
      low: 'bg-stone-100 text-stone-600',
    }
    return (
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colors[conf] ?? colors.low}`}>
        {conf} match
      </span>
    )
  }

  return (
    <div className="space-y-5">
      {/* Self-signup toggle */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)] space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-stone-800">Allow self-signup</p>
            <p className="text-xs text-stone-500 mt-0.5">
              Families can create their own portal accounts and be auto-matched to residents.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={selfSignup}
            onClick={() => setSelfSignup(!selfSignup)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${selfSignup ? 'bg-[#8B2E4A]' : 'bg-stone-200'}`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${selfSignup ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>
      </div>

      {/* Coupons / discounts */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)] space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-stone-800">Enable discounts & coupons</p>
            <p className="text-xs text-stone-500 mt-0.5">
              Allow this facility to issue coupon discounts to portal members.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={couponsEnabled}
            onClick={() => setCouponsEnabled(!couponsEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${couponsEnabled ? 'bg-[#8B2E4A]' : 'bg-stone-200'}`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${couponsEnabled ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>

        {couponsEnabled && (
          <div className="border-t border-stone-100 pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-stone-700">Welcome coupon</p>
                <p className="text-xs text-stone-500">Issued automatically when a new family account is approved.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={welcomeCouponEnabled}
                onClick={() => setWelcomeCouponEnabled(!welcomeCouponEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${welcomeCouponEnabled ? 'bg-[#8B2E4A]' : 'bg-stone-200'}`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${welcomeCouponEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>

            {welcomeCouponEnabled && (
              <div className="bg-stone-50 rounded-xl p-4 space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-semibold text-stone-600 block mb-1">Discount type</label>
                    <select
                      value={welcomeCouponType}
                      onChange={(e) => {
                        setWelcomeCouponType(e.target.value as 'fixed' | 'percent')
                        setWelcomeCouponValue('')
                      }}
                      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
                    >
                      <option value="fixed">Fixed amount ($)</option>
                      <option value="percent">Percentage (%)</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-semibold text-stone-600 block mb-1">
                      {welcomeCouponType === 'fixed' ? 'Amount (dollars)' : 'Percentage (1–100)'}
                    </label>
                    <input
                      type="number"
                      min={welcomeCouponType === 'fixed' ? '0.01' : '1'}
                      max={welcomeCouponType === 'percent' ? '100' : undefined}
                      step={welcomeCouponType === 'fixed' ? '0.01' : '1'}
                      value={welcomeCouponValue}
                      onChange={(e) => setWelcomeCouponValue(e.target.value)}
                      placeholder={welcomeCouponType === 'fixed' ? '10.00' : '15'}
                      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
                    />
                  </div>
                </div>
                {welcomeCouponValue && (
                  <p className="text-xs text-stone-500">
                    New portal members will receive a{' '}
                    <span className="font-semibold text-stone-700">
                      {welcomeCouponType === 'fixed'
                        ? `$${parseFloat(welcomeCouponValue || '0').toFixed(2)} off`
                        : `${welcomeCouponValue}% off`}
                    </span>{' '}
                    welcome discount. Senior Stylist absorbs the cost.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-2.5 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving…' : 'Save portal settings'}
      </button>

      {/* Pending claim requests */}
      {claims.length > 0 && (
        <div className="mt-2">
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">
            Pending Access Requests ({claims.length})
          </h3>
          <div className="space-y-3">
            {claims.map((c) => (
              <div key={c.id} className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="text-sm font-semibold text-stone-800">{c.fullName}</p>
                    <p className="text-xs text-stone-500">{c.email}</p>
                    {c.phone && <p className="text-xs text-stone-400">{c.phone}</p>}
                    <p className="text-[10px] text-stone-400 mt-1">Requested {formatDate(c.createdAt)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {c.residentName ? (
                      <div className="text-right">
                        <p className="text-xs font-medium text-stone-700">Closest match: {c.residentName}</p>
                        {c.residentRoom && <p className="text-[10px] text-stone-500">Rm {c.residentRoom}</p>}
                        {confidenceBadge(c.matchConfidence)}
                      </div>
                    ) : (
                      <span className="text-[10px] font-semibold text-stone-500 bg-stone-100 rounded-full px-2 py-0.5">
                        No match found
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={reviewingId === c.id}
                    onClick={() => handleReview(c.id, 'approve')}
                    className="flex-1 text-xs font-semibold bg-[#8B2E4A] text-white rounded-xl py-2 hover:bg-[#72253C] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {reviewingId === c.id ? 'Approving…' : 'Approve & Send Link'}
                  </button>
                  <button
                    type="button"
                    disabled={reviewingId === c.id}
                    onClick={() => handleReview(c.id, 'reject')}
                    className="flex-1 text-xs font-semibold bg-white text-stone-600 border border-stone-200 rounded-xl py-2 hover:bg-stone-50 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {claims.length === 0 && selfSignup && (
        <p className="text-xs text-stone-400 text-center">No pending access requests.</p>
      )}
    </div>
  )
}
