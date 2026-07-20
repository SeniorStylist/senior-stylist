'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/toast'
import type { PublicFacility } from '@/lib/sanitize'
import { CouponManager } from '@/components/settings/coupon-manager'

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
  // P36 — approve-to-a-different-resident picker (uses the existing API
  // residentId override that was never wired into this UI).
  const [residentOptions, setResidentOptions] = useState<Array<{ id: string; name: string; roomNumber: string | null }> | null>(null)
  const [overrideFor, setOverrideFor] = useState<Record<string, string>>({})
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null)

  const loadResidentOptions = async () => {
    if (residentOptions) return
    try {
      const res = await fetch(`/api/residents?facilityId=${facility.id}`)
      const j = await res.json()
      if (res.ok) setResidentOptions(j.data ?? [])
    } catch { /* picker just stays empty */ }
  }

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
      const overrideId = action === 'approve' ? overrideFor[id] : undefined
      const res = await fetch(`/api/portal/claim-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overrideId ? { action, residentId: overrideId } : { action }),
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

            {/* Full coupon catalog: create / manage / issue */}
            <CouponManager />
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

      {/* P36 — Portal status: coverage counts, bulk invites, printable QR poster */}
      <PortalStatusCard facilityName={facility.name} facilityCode={f.facilityCode ?? null} />

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
                {/* P36 — approve against a DIFFERENT resident than the auto-match */}
                {pickerOpenFor === c.id ? (
                  <div className="mb-2">
                    <select
                      value={overrideFor[c.id] ?? ''}
                      onChange={(e) => setOverrideFor((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      className="w-full px-3 py-2 text-xs border border-stone-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20"
                    >
                      <option value="">Use the closest match{c.residentName ? ` (${c.residentName})` : ''}</option>
                      {(residentOptions ?? []).map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}{r.roomNumber ? ` · Rm ${r.roomNumber}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setPickerOpenFor(c.id); void loadResidentOptions() }}
                    className="text-[11px] font-medium text-[#8B2E4A] hover:underline mb-2"
                  >
                    Link to a different resident…
                  </button>
                )}
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

// ─── P36: Portal status + distribution ───────────────────────────────────────

interface CoverageData {
  counts: { total: number; linked: number; invitable: number; noPoaEmail: number }
  invitable: Array<{ id: string; name: string; roomNumber: string | null; poaEmail: string; lastInvitedAt: string | null }>
}

function PortalStatusCard({ facilityName, facilityCode }: { facilityName: string; facilityCode: string | null }) {
  const { toast } = useToast()
  const [coverage, setCoverage] = useState<CoverageData | null>(null)
  const [loading, setLoading] = useState(false)
  const [bulkSending, setBulkSending] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/portal/coverage')
      const j = await res.json()
      if (res.ok) setCoverage(j.data)
      else toast.error(typeof j.error === 'string' ? j.error : 'Could not load portal status')
    } catch {
      toast.error('Network error')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBulkInvite = async () => {
    setBulkSending(true)
    try {
      const res = await fetch('/api/portal/bulk-invite', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : 'Bulk invite failed')
        return
      }
      const { sent, failed, remaining } = j.data
      toast.success(
        `Sent ${sent} invite${sent !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}${remaining ? ` — ${remaining} remaining, run again` : ''}`,
      )
      void load()
    } catch {
      toast.error('Network error')
    } finally {
      setBulkSending(false)
    }
  }

  const handleSendOne = async (residentId: string) => {
    setSendingId(residentId)
    try {
      const res = await fetch('/api/portal/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success('Invite sent')
        setCoverage((prev) =>
          prev
            ? {
                ...prev,
                invitable: prev.invitable.map((r) =>
                  r.id === residentId ? { ...r, lastInvitedAt: new Date().toISOString() } : r,
                ),
              }
            : prev,
        )
      } else toast.error(typeof j.error === 'string' ? j.error : 'Send failed')
    } catch {
      toast.error('Network error')
    } finally {
      setSendingId(null)
    }
  }

  // Printable QR poster — signage print pattern (self-contained HTML doc,
  // window.open + print; QR is a data-URL so the page works offline).
  const handlePrintPoster = async () => {
    if (!facilityCode) return
    setPrinting(true)
    try {
      const QRCode = (await import('qrcode')).default
      const url = `${window.location.origin}/family/${encodeURIComponent(facilityCode)}/signup`
      const dataUrl = await QRCode.toDataURL(url, { width: 480, margin: 1, color: { dark: '#1C0A12' } })
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Family Portal Sign-Up — ${esc(facilityName)}</title>
<style>@page{margin:0}body{margin:0;font-family:Georgia,'Times New Roman',serif;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#1C0A12}
h1{font-size:6vh;margin:0 0 1vh;font-weight:normal}h2{font-size:3.2vh;margin:0 0 4vh;color:#8B2E4A;font-weight:normal}
img{width:38vh;height:38vh}p{font-size:2.4vh;margin:3vh 0 0;max-width:70vw}code{font-size:2vh;color:#57534e}
.brand{position:absolute;bottom:3vh;font-size:1.8vh;color:#8B2E4A}</style></head><body>
<h1>${esc(facilityName)}</h1><h2>Family Portal — book visits, see balances, manage payment</h2>
<img src="${dataUrl}" alt="Sign-up QR code">
<p>Scan with your phone camera to create your family account, or visit:<br><code>${esc(url)}</code></p>
<div class="brand">Senior Stylist ♥</div>
<script>setTimeout(function(){window.print()},450)</script></body></html>`
      const w = window.open('', '_blank')
      if (w) {
        w.document.write(html)
        w.document.close()
      }
    } catch {
      toast.error('Could not build the poster')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)] space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-stone-800">Portal status</p>
          <p className="text-xs text-stone-500 mt-0.5">Who's connected, who can be invited, and the printable sign-up poster.</p>
        </div>
        <button
          type="button"
          onClick={handlePrintPoster}
          disabled={!facilityCode || printing}
          title={facilityCode ? 'Print a QR sign-up poster for this facility' : 'Set a facility code first'}
          className="text-xs font-semibold px-3 py-2 rounded-xl border border-stone-200 text-stone-600 hover:text-[#8B2E4A] hover:border-[#C4687A] hover:bg-[#F9EFF2]/40 transition-colors disabled:opacity-40"
        >
          {printing ? 'Building…' : '⎙ Print sign-up poster'}
        </button>
      </div>

      {loading && !coverage ? (
        <div className="skeleton rounded-xl h-14" />
      ) : coverage ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-center">
              <p className="text-lg font-bold text-emerald-700">{coverage.counts.linked}</p>
              <p className="text-[10.5px] text-emerald-700/80 font-medium">Connected</p>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-center">
              <p className="text-lg font-bold text-amber-700">{coverage.counts.invitable}</p>
              <p className="text-[10.5px] text-amber-700/80 font-medium">Can be invited</p>
            </div>
            <div className="rounded-xl bg-stone-50 border border-stone-100 px-3 py-2 text-center">
              <p className="text-lg font-bold text-stone-500">{coverage.counts.noPoaEmail}</p>
              <p className="text-[10.5px] text-stone-500 font-medium">No family email</p>
            </div>
          </div>

          {coverage.counts.invitable > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  className="text-xs font-medium text-[#8B2E4A] hover:underline"
                >
                  {expanded ? 'Hide list' : `Show ${coverage.invitable.length} invitable resident${coverage.invitable.length !== 1 ? 's' : ''}`}
                </button>
                <button
                  type="button"
                  onClick={handleBulkInvite}
                  disabled={bulkSending}
                  className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#8B2E4A] text-white hover:bg-[#72253C] transition-colors disabled:opacity-50"
                >
                  {bulkSending ? 'Sending…' : `Invite all (${Math.min(coverage.counts.invitable, 25)} per run)`}
                </button>
              </div>
              {expanded && (
                <div className="rounded-xl border border-stone-100 divide-y divide-stone-50 max-h-64 overflow-y-auto overscroll-contain">
                  {coverage.invitable.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-stone-800 truncate">
                          {r.name}
                          {r.roomNumber ? <span className="text-stone-400 font-normal"> · Rm {r.roomNumber}</span> : null}
                        </p>
                        <p className="text-[11px] text-stone-400 truncate">
                          {r.poaEmail}
                          {r.lastInvitedAt ? ` · invited ${new Date(r.lastInvitedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSendOne(r.id)}
                        disabled={sendingId === r.id}
                        className="shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:text-[#8B2E4A] hover:border-[#C4687A] transition-colors disabled:opacity-50"
                      >
                        {sendingId === r.id ? '…' : 'Send link'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
