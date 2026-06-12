// Unapplied QB credits — payments QuickBooks received but never applied to an
// invoice. Imported via Step 5 on /master-admin/imports/quickbooks. This list is
// the checklist for applying them inside QuickBooks (Receive Payment → apply credit);
// the website cannot write back to QB.

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/db'
import { qbUnappliedCredits, facilities, residents } from '@/db/schema'
import { asc, eq, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function UnappliedCreditsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) redirect('/dashboard')

  let rows: {
    id: string
    txnType: string
    txnDate: string
    num: string | null
    amountCents: number
    openBalanceCents: number
    facilityId: string
    facilityName: string
    facilityCode: string | null
    residentName: string | null
    roomNumber: string | null
  }[] = []
  let importedAt: Date | null = null

  try {
    const [data, meta] = await Promise.all([
      db.select({
        id: qbUnappliedCredits.id,
        txnType: qbUnappliedCredits.txnType,
        txnDate: qbUnappliedCredits.txnDate,
        num: qbUnappliedCredits.num,
        amountCents: qbUnappliedCredits.amountCents,
        openBalanceCents: qbUnappliedCredits.openBalanceCents,
        facilityId: qbUnappliedCredits.facilityId,
        facilityName: facilities.name,
        facilityCode: facilities.facilityCode,
        residentName: residents.name,
        roomNumber: residents.roomNumber,
      })
        .from(qbUnappliedCredits)
        .innerJoin(facilities, eq(qbUnappliedCredits.facilityId, facilities.id))
        .leftJoin(residents, eq(qbUnappliedCredits.residentId, residents.id))
        .orderBy(asc(facilities.name), asc(qbUnappliedCredits.txnDate)),
      db.execute(sql`SELECT MAX(created_at) AS latest FROM qb_unapplied_credits`),
    ])
    rows = data
    const latest = (meta as unknown as Array<{ latest: string | Date | null }>)[0]?.latest
    importedAt = latest ? new Date(latest) : null
  } catch {
    // Table may not exist until the first Step 5 import runs — render the empty state
  }

  const totalCents = rows.reduce((s, r) => s + r.openBalanceCents, 0)

  // Group by facility, preserving the name-sorted order
  const groups: { facilityId: string; name: string; code: string | null; rows: typeof rows; subtotal: number }[] = []
  for (const r of rows) {
    let g = groups[groups.length - 1]
    if (!g || g.facilityId !== r.facilityId) {
      g = { facilityId: r.facilityId, name: r.facilityName, code: r.facilityCode, rows: [], subtotal: 0 }
      groups.push(g)
    }
    g.rows.push(r)
    g.subtotal += r.openBalanceCents
  }

  return (
    <div className="page-enter min-h-screen bg-stone-50 p-6">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/master-admin/imports/quickbooks"
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 mb-6"
        >
          <span>←</span> Back to QuickBooks Imports
        </Link>

        <h1
          className="text-2xl font-normal mb-1"
          style={{ fontFamily: "'DM Serif Display', serif", color: '#8B2E4A' }}
        >
          Unapplied Credits
        </h1>
        <p className="text-sm text-stone-500 mb-1">
          Payments QuickBooks received that were never applied to an invoice. Apply each one inside
          QuickBooks (open the customer → Receive Payment → check the credit → apply to open invoices),
          then re-run the Invoice History import to bring the website in line with QB&apos;s A/R.
        </p>
        {importedAt && (
          <p className="text-[11.5px] text-stone-400 mb-6">
            Snapshot imported {importedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} —
            re-run Step 5 after applying credits in QuickBooks to refresh this list.
          </p>
        )}

        {rows.length === 0 ? (
          <div className="rounded-[18px] border border-stone-200 bg-white shadow-[var(--shadow-sm)] p-8 text-center">
            <p className="text-sm font-semibold text-stone-700 mb-1">No unapplied credits</p>
            <p className="text-xs text-stone-500">
              Either everything is applied in QuickBooks, or the Step 5 import hasn&apos;t been run yet.{' '}
              <Link href="/master-admin/imports/quickbooks#step-5" className="text-[#8B2E4A] font-semibold">
                Run the import →
              </Link>
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-[18px] border border-rose-100 bg-rose-50 px-5 py-4 mb-6 flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <div>
                <span className="text-xl font-bold text-[#8B2E4A]">{dollars(totalCents)}</span>
                <span className="text-xs text-stone-500 ml-2">total unapplied</span>
              </div>
              <div className="text-xs text-stone-500">
                {rows.length} credit{rows.length === 1 ? '' : 's'} across {groups.length} facilit{groups.length === 1 ? 'y' : 'ies'}
              </div>
            </div>

            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.facilityId} className="rounded-[18px] border border-stone-200 bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 bg-stone-50/60 border-b border-stone-100">
                    <div className="flex items-center gap-2 min-w-0">
                      {g.code && <span className="text-stone-400 font-mono text-xs shrink-0">{g.code}</span>}
                      <span className="text-[13.5px] font-semibold text-stone-900 truncate">{g.name}</span>
                    </div>
                    <span className="text-sm font-bold text-[#8B2E4A] shrink-0 ml-3">{dollars(g.subtotal)}</span>
                  </div>
                  <div className="divide-y divide-stone-50">
                    {g.rows.map((r) => (
                      <div key={r.id} className="grid grid-cols-[90px_1fr_auto] md:grid-cols-[100px_1fr_110px_110px] items-center gap-3 px-5 py-2.5 hover:bg-[#F9EFF2] transition-colors duration-[120ms]">
                        <span className="text-xs text-stone-500">{formatDate(r.txnDate)}</span>
                        <span className="text-xs text-stone-700 truncate">
                          {r.residentName
                            ? <>{r.residentName}{r.roomNumber && <span className="text-stone-400"> · Rm {r.roomNumber}</span>}</>
                            : <span className="text-stone-400">Facility-level payment</span>}
                          {r.num && <span className="text-stone-400 font-mono text-[11px] ml-1.5">#{r.num}</span>}
                        </span>
                        <span className="hidden md:block text-xs text-stone-400 text-right">
                          {r.amountCents !== r.openBalanceCents && <>of {dollars(r.amountCents)}</>}
                        </span>
                        <span className="text-xs font-semibold text-stone-900 text-right">{dollars(r.openBalanceCents)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
