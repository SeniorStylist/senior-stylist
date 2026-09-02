'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { formatCents } from '@/lib/utils'

interface FacilityRow {
  id: string
  name: string
  facilityCode: string | null
  outstandingCents: number
  bookingsThisMonth: number
  collectedThisMonthCents: number
  qbConnected?: boolean
}

interface QuickBooksState {
  /** The QuickBooks company at least one franchise facility is attached to (null = none yet). */
  realmId: string | null
  canConnect: boolean
}

export function FranchiseClient({
  franchiseName,
  facilities,
  quickbooks = { realmId: null, canConnect: false },
}: {
  franchiseName: string | null
  facilities: FacilityRow[]
  quickbooks?: QuickBooksState
}) {
  const router = useRouter()
  const [going, setGoing] = useState<string | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [qbNotice, setQbNotice] = useState<string | null>(null)

  const qbConnectedCount = facilities.filter((f) => f.qbConnected).length
  const qbRemaining = facilities.length - qbConnectedCount

  // Attach the rest of the franchise to the company connection that already
  // exists (no second Intuit authorization needed).
  const attachRemaining = async () => {
    if (!quickbooks.realmId || attaching) return
    setAttaching(true)
    setQbNotice(null)
    try {
      const res = await fetch('/api/quickbooks/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ realmId: quickbooks.realmId, scope: 'franchise' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setQbNotice(j.error ?? 'Could not attach the remaining facilities')
        return
      }
      setQbNotice(`${j.data?.attached ?? 0} facilit${(j.data?.attached ?? 0) === 1 ? 'y' : 'ies'} attached to QuickBooks`)
      router.refresh()
    } catch {
      setQbNotice('Network error — try again')
    } finally {
      setAttaching(false)
    }
  }

  const totalOutstanding = facilities.reduce((s, f) => s + f.outstandingCents, 0)
  const totalCollected = facilities.reduce((s, f) => s + f.collectedThisMonthCents, 0)
  const totalBookings = facilities.reduce((s, f) => s + f.bookingsThisMonth, 0)

  // Switch the active facility, then go to its billing page.
  const open = async (facilityId: string, dest: string) => {
    setGoing(facilityId)
    try {
      await fetch('/api/facilities/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId }),
      })
      router.push(dest)
    } catch {
      setGoing(null)
    }
  }

  if (!franchiseName) {
    return (
      <div className="page-enter max-w-5xl mx-auto px-4 py-8">
        <PageHeader icon={Building2} title="Franchise" subtitle="Cross-facility overview" />
        <div className="mt-6 rounded-2xl border border-stone-100 bg-white p-8 text-center shadow-[var(--shadow-sm)]">
          <p className="text-sm text-stone-500">This account isn’t linked to a franchise yet.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-enter max-w-5xl mx-auto px-4 py-8">
      <PageHeader icon={Building2} title={franchiseName} subtitle={`${facilities.length} ${facilities.length === 1 ? 'facility' : 'facilities'} · franchise overview`} />

      {/* Franchise totals */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <TotalTile label="Outstanding (franchise)" value={formatCents(totalOutstanding)} tone={totalOutstanding > 0 ? 'amber' : 'neutral'} />
        <TotalTile label="Collected this month" value={formatCents(totalCollected)} tone="emerald" />
        <TotalTile label="Appointments this month" value={String(totalBookings)} tone="neutral" />
      </div>

      {/* QuickBooks — one authorization covers the whole franchise */}
      {quickbooks.canConnect && facilities.length > 0 && (
        <div className="mt-6 rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-stone-900">QuickBooks</p>
              <p className="text-xs text-stone-500 mt-0.5">
                {qbConnectedCount === 0
                  ? 'No facility in this franchise is connected yet. One authorization connects all of them.'
                  : qbRemaining === 0
                    ? `All ${facilities.length} facilities are connected.`
                    : `${qbConnectedCount} of ${facilities.length} facilities connected.`}
              </p>
            </div>
            <div className="flex gap-2">
              {qbConnectedCount === 0 && (
                <a
                  href="/api/quickbooks/connect?scope=franchise&return=franchise"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-white bg-[#8B2E4A] hover:bg-[#72253C] rounded-xl px-4 py-2"
                >
                  Connect QuickBooks for all {facilities.length}
                </a>
              )}
              {qbConnectedCount > 0 && qbRemaining > 0 && quickbooks.realmId && (
                <button
                  type="button"
                  onClick={attachRemaining}
                  disabled={attaching}
                  className="text-xs font-semibold text-white bg-[#8B2E4A] hover:bg-[#72253C] rounded-xl px-4 py-2 disabled:opacity-50"
                >
                  {attaching ? 'Attaching…' : `Attach the other ${qbRemaining}`}
                </button>
              )}
            </div>
          </div>
          {qbNotice && <p className="text-xs text-stone-600 mt-3">{qbNotice}</p>}
        </div>
      )}

      {/* Facilities grid */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {facilities.map((f) => (
          <div key={f.id} className="rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-stone-900 leading-snug">{f.name}</p>
                {f.facilityCode && <p className="text-xs text-stone-400 font-mono mt-0.5">{f.facilityCode}</p>}
                {f.qbConnected && (
                  <p className="text-[10.5px] font-semibold text-emerald-700 mt-1">✓ QuickBooks</p>
                )}
              </div>
              {f.outstandingCents > 0 && (
                <span className="text-[10.5px] font-semibold bg-amber-50 text-amber-800 rounded-full px-2.5 py-1 shrink-0">
                  {formatCents(f.outstandingCents)} owed
                </span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[11px] text-stone-400 uppercase tracking-wide font-semibold">This month</p>
                <p className="text-stone-800 font-semibold tabular-nums">{f.bookingsThisMonth} appts</p>
              </div>
              <div>
                <p className="text-[11px] text-stone-400 uppercase tracking-wide font-semibold">Collected</p>
                <p className="text-emerald-700 font-semibold tabular-nums">{formatCents(f.collectedThisMonthCents)}</p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => open(f.id, '/billing')}
                disabled={going === f.id}
                className="flex-1 text-xs font-semibold text-white bg-[#8B2E4A] hover:bg-[#72253C] rounded-xl py-2 disabled:opacity-50"
              >
                {going === f.id ? 'Opening…' : 'Billing →'}
              </button>
              <button
                type="button"
                onClick={() => open(f.id, '/dashboard')}
                disabled={going === f.id}
                className="flex-1 text-xs font-semibold text-stone-600 border border-stone-200 hover:bg-stone-50 rounded-xl py-2 disabled:opacity-50"
              >
                Dashboard →
              </button>
            </div>
          </div>
        ))}
      </div>

      {facilities.length === 0 && (
        <div className="mt-6 rounded-2xl border border-stone-100 bg-white p-8 text-center shadow-[var(--shadow-sm)]">
          <p className="text-sm text-stone-500">No active facilities in this franchise yet.</p>
        </div>
      )}
    </div>
  )
}

function TotalTile({ label, value, tone }: { label: string; value: string; tone: 'amber' | 'emerald' | 'neutral' }) {
  const cls = tone === 'amber' ? 'text-amber-700' : tone === 'emerald' ? 'text-emerald-700' : 'text-stone-900'
  return (
    <div className="rounded-2xl border border-stone-100 bg-white px-4 py-3 shadow-[var(--shadow-sm)]">
      <p className="text-[11px] text-stone-400 uppercase tracking-wide font-semibold">{label}</p>
      <p className={`text-xl font-semibold mt-0.5 tabular-nums ${cls}`}>{value}</p>
    </div>
  )
}
