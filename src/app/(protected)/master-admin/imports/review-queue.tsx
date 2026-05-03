'use client'

import { useEffect, useState } from 'react'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import { formatCents } from '@/lib/utils'

interface Suggestion {
  id: string
  name: string
  priceCents: number
  score: number
}

interface ServiceOption {
  id: string
  name: string
  priceCents: number
}

interface ReviewBooking {
  id: string
  rawServiceName: string | null
  priceCents: number | null
  startTime: string
  facilityId: string
  resident: { name: string; roomNumber: string | null }
  facility: { name: string }
  importBatch: { fileName: string; createdAt: string | null } | null
  suggestions: Suggestion[]
}

type CardSubState =
  | { kind: 'idle' }
  | { kind: 'link'; serviceId: string }
  | { kind: 'create'; serviceName: string; priceText: string }
  | { kind: 'remove' }

const CheckIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
)
const TrashIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 3h6a1 1 0 011 1v3H8V4a1 1 0 011-1z" />
  </svg>
)

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ReviewQueue({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [bookings, setBookings] = useState<ReviewBooking[]>([])
  const [facilityServices, setFacilityServices] = useState<Record<string, ServiceOption[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/super-admin/import-review')
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Failed to load')
        if (!active) return
        setBookings(json.data.bookings)
        setFacilityServices(json.data.facilityServices ?? {})
        onCountChange?.(json.data.totalCount)
      } catch (err) {
        if (active) setError((err as Error).message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [onCountChange])

  const removeBooking = (id: string) => {
    setBookings((prev) => {
      const next = prev.filter((b) => b.id !== id)
      onCountChange?.(next.length)
      return next
    })
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5">
            <div className="h-4 w-2/3 skeleton rounded mb-3" />
            <div className="h-10 w-full skeleton rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    )
  }

  if (bookings.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)]">
        <EmptyState
          icon={<CheckIcon className="w-5 h-5 text-emerald-600" />}
          title="All imports resolved"
          description="No services need review."
        />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
        <span className="font-semibold">{bookings.length}</span> imported service{bookings.length === 1 ? '' : 's'} couldn&apos;t be matched automatically. Review them below — confirm a match, create a new service, or mark as a permanent historical record.
      </div>
      <div className="space-y-3">
        {bookings.map((b) => (
          <ReviewCard
            key={b.id}
            booking={b}
            services={facilityServices[b.facilityId] ?? []}
            onResolved={() => {
              removeBooking(b.id)
              toast.success('Resolved.')
            }}
            onRemoved={() => {
              removeBooking(b.id)
              toast.success('Booking removed.')
            }}
            onError={(msg) => toast.error(msg)}
          />
        ))}
      </div>
    </div>
  )
}

interface ReviewCardProps {
  booking: ReviewBooking
  services: ServiceOption[]
  onResolved: () => void
  onRemoved: () => void
  onError: (msg: string) => void
}

function ReviewCard({ booking, services, onResolved, onRemoved, onError }: ReviewCardProps) {
  const [sub, setSub] = useState<CardSubState>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)

  async function postResolve(body: object) {
    setSaving(true)
    try {
      const res = await fetch('/api/super-admin/import-review/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      onResolved()
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteBooking() {
    setSaving(true)
    try {
      const res = await fetch(`/api/super-admin/import-bookings/${booking.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      onRemoved()
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const initialPrice = booking.priceCents != null ? (booking.priceCents / 100).toFixed(2) : ''
  const dateLabel = formatDate(booking.startTime)

  return (
    <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-stone-700 min-w-0">
          <span className="font-semibold text-stone-900">{booking.resident.name}</span>
          {booking.resident.roomNumber && (
            <span className="text-[11.5px] text-stone-400">Rm {booking.resident.roomNumber}</span>
          )}
          <span className="text-stone-300">·</span>
          <span className="text-stone-600">{booking.facility.name}</span>
          <span className="text-stone-300">·</span>
          <span className="text-stone-500">{dateLabel}</span>
          {booking.importBatch?.fileName && (
            <span className="text-[11px] text-stone-400 font-mono truncate max-w-[12rem]" title={booking.importBatch.fileName}>
              {booking.importBatch.fileName}
            </span>
          )}
        </div>
        {sub.kind !== 'remove' && (
          <button
            type="button"
            aria-label="Remove this booking"
            onClick={() => setSub({ kind: 'remove' })}
            disabled={saving}
            className="shrink-0 text-stone-400 hover:text-red-600 transition-colors p-1 rounded-lg disabled:opacity-50"
          >
            <TrashIcon />
          </button>
        )}
      </div>

      {/* Raw service block */}
      <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-stone-50 rounded-xl">
        <code className="text-sm text-stone-800 font-mono flex-1 break-words">
          {booking.rawServiceName || '—'}
        </code>
        <span className="text-sm font-semibold text-stone-700">
          {formatCents(booking.priceCents ?? 0)}
        </span>
      </div>

      {/* Suggestions */}
      {sub.kind === 'idle' && booking.suggestions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-[11.5px] text-stone-400 font-semibold uppercase tracking-wide">Suggested:</span>
          {booking.suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSub({ kind: 'link', serviceId: s.id })}
              className="px-3 py-1.5 rounded-full bg-rose-50 text-[#8B2E4A] text-xs font-semibold border border-rose-100 hover:bg-rose-100 transition-colors"
            >
              {s.name} · {formatCents(s.priceCents)}
              <span className="text-rose-400 font-normal ml-1.5">{Math.round(s.score * 100)}%</span>
            </button>
          ))}
        </div>
      )}

      {/* Action area */}
      {sub.kind === 'idle' && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setSub({
                kind: 'link',
                serviceId: booking.suggestions[0]?.id ?? services[0]?.id ?? '',
              })
            }
            disabled={services.length === 0 || saving}
            className="flex-1 min-w-[10rem] px-3 py-2 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-40"
            style={{ backgroundColor: '#8B2E4A' }}
          >
            Link to service
          </button>
          <button
            type="button"
            onClick={() =>
              setSub({
                kind: 'create',
                serviceName: booking.rawServiceName ?? '',
                priceText: initialPrice,
              })
            }
            disabled={saving}
            className="flex-1 min-w-[10rem] px-3 py-2 rounded-xl text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 transition-colors disabled:opacity-40"
          >
            Create new service
          </button>
          <button
            type="button"
            onClick={() => postResolve({ action: 'keep', bookingId: booking.id })}
            disabled={saving}
            className="flex-1 min-w-[10rem] px-3 py-2 rounded-xl text-xs font-semibold text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors disabled:opacity-40"
          >
            Keep as historical
          </button>
        </div>
      )}

      {/* Link sub-form */}
      {sub.kind === 'link' && (
        <div className="space-y-2 pt-1">
          <label className="block text-[11.5px] text-stone-500 font-semibold uppercase tracking-wide">
            Link to existing service
          </label>
          <select
            value={sub.serviceId}
            onChange={(e) => setSub({ kind: 'link', serviceId: e.target.value })}
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50"
          >
            {services.length === 0 && <option value="">No services available</option>}
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {formatCents(s.priceCents)}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSub({ kind: 'idle' })}
              disabled={saving}
              className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => sub.serviceId && postResolve({ action: 'link', bookingId: booking.id, serviceId: sub.serviceId })}
              disabled={saving || !sub.serviceId}
              className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-40"
              style={{ backgroundColor: '#8B2E4A' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Create sub-form */}
      {sub.kind === 'create' && (
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_8rem] gap-2">
            <input
              type="text"
              value={sub.serviceName}
              onChange={(e) => setSub({ ...sub, serviceName: e.target.value })}
              placeholder="Service name"
              className="px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50"
            />
            <div className="flex items-center gap-1">
              <span className="text-sm text-stone-500">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={sub.priceText}
                onChange={(e) => setSub({ ...sub, priceText: e.target.value })}
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSub({ kind: 'idle' })}
              disabled={saving}
              className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const cents = Math.round(parseFloat(sub.priceText || '0') * 100)
                if (!sub.serviceName.trim() || !Number.isFinite(cents) || cents < 0) {
                  onError('Service name and a non-negative price are required.')
                  return
                }
                postResolve({
                  action: 'create',
                  bookingId: booking.id,
                  serviceName: sub.serviceName.trim(),
                  priceCents: cents,
                })
              }}
              disabled={saving}
              className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-40"
              style={{ backgroundColor: '#8B2E4A' }}
            >
              {saving ? 'Saving…' : 'Create & link'}
            </button>
          </div>
        </div>
      )}

      {/* Remove confirm */}
      {sub.kind === 'remove' && (
        <div className="flex items-center gap-2 pt-1">
          <span className="flex-1 text-sm text-stone-600">Remove this booking from Senior Stylist?</span>
          <button
            type="button"
            onClick={() => setSub({ kind: 'idle' })}
            disabled={saving}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={deleteBooking}
            disabled={saving}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-40"
          >
            {saving ? 'Removing…' : 'Remove'}
          </button>
        </div>
      )}
    </div>
  )
}
