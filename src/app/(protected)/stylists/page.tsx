import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { stylists, complianceDocuments } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { computeComplianceStatus, complianceStatusLabel } from '@/lib/compliance'

const STATUS_COLOR: Record<'green' | 'amber' | 'red', string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-400',
  red: 'bg-red-500',
}

export default async function StylistsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  if (facilityUser.role !== 'admin') redirect('/dashboard')

  try {
  const stylistsList = await db.query.stylists.findMany({
    where: and(
      eq(stylists.facilityId, facilityUser.facilityId),
      eq(stylists.active, true)
    ),
    orderBy: (t, { asc }) => [asc(t.name)],
  })

  const facilityDocs = await db.query.complianceDocuments.findMany({
    where: eq(complianceDocuments.facilityId, facilityUser.facilityId),
    columns: { stylistId: true, documentType: true, expiresAt: true, verified: true },
  })
  const docsByStylist = new Map<string, typeof facilityDocs>()
  for (const d of facilityDocs) {
    if (!docsByStylist.has(d.stylistId)) docsByStylist.set(d.stylistId, [])
    docsByStylist.get(d.stylistId)!.push(d)
  }

  const stylistStatus = new Map<string, ReturnType<typeof computeComplianceStatus>>()
  for (const s of stylistsList) {
    stylistStatus.set(
      s.id,
      computeComplianceStatus(s, docsByStylist.get(s.id) ?? [])
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1
          className="text-2xl font-bold text-stone-900"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Stylists
        </h1>
        <p className="text-sm text-stone-500 mt-0.5">
          {stylistsList.length} active stylist{stylistsList.length !== 1 ? 's' : ''}
        </p>
      </div>

      {stylistsList.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-12 text-center">
          <p className="text-stone-400 text-sm">No stylists yet. Add one from the dashboard.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          {stylistsList.map((stylist) => (
            <Link
              key={stylist.id}
              href={`/stylists/${stylist.id}`}
              className="flex items-center gap-4 px-5 py-4 hover:bg-stone-50 transition-colors border-b border-stone-50 last:border-0"
            >
              <Avatar name={stylist.name} color={stylist.color} size="md" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-stone-900">{stylist.name}</p>
                  {stylist.licenseState && (
                    <span className="text-[10px] font-semibold text-stone-500 px-1.5 py-0.5 rounded bg-stone-100 shrink-0">
                      {stylist.licenseState.split(',').map((s) => s.trim()).join(' • ')}
                    </span>
                  )}
                </div>
              </div>
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: stylist.color }}
                title="Calendar color"
              />
              {(() => {
                const status = stylistStatus.get(stylist.id) ?? 'none'
                if (status === 'none') return null
                return (
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLOR[status]}`}
                    title={`Compliance: ${complianceStatusLabel(status)}`}
                  />
                )
              })()}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-stone-300 shrink-0"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
  } catch (err) {
    console.error('[StylistsPage] DB error:', err)
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-lg mt-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Something went wrong</p>
          <p className="text-xs text-red-600">Failed to load stylists. Please refresh to try again.</p>
        </div>
      </div>
    )
  }
}
