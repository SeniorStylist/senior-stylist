import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { importBatches, bookings } from '@/db/schema'
import { count, eq, isNull, and } from 'drizzle-orm'
import { ImportsHubClient, type SourceCardData } from './imports-client'
import type { BatchRow } from './batch-history'

const SOURCE_DEFS: { sourceType: string; title: string; description: string; format: 'XLSX' | 'CSV'; href: string }[] = [
  {
    sourceType: 'service_log',
    title: 'Service Log Import',
    description: 'Import bookkeeper XLSX service logs to backfill historical bookings, residents, and service records.',
    format: 'XLSX',
    href: '/master-admin/imports/service-log',
  },
  {
    sourceType: 'qb_customer',
    title: 'QB Customer Import',
    description: 'Import QuickBooks customer list to sync resident billing profiles.',
    format: 'CSV',
    href: '/master-admin/import-quickbooks',
  },
  {
    sourceType: 'qb_billing',
    title: 'QB Billing Import',
    description: 'Import QuickBooks invoice and transaction history for AR tracking.',
    format: 'CSV',
    href: '/master-admin/import-billing-history',
  },
  {
    sourceType: 'facility_csv',
    title: 'Facility Data Import',
    description: 'Bulk-update facility details, billing types, and contact info.',
    format: 'CSV',
    href: '/master-admin/import-facilities-csv',
  },
]

export default async function ImportsHubPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) redirect('/dashboard')

  const [batchRows, needsReviewRows, fullBatches] = await Promise.all([
    db.query.importBatches.findMany({
      where: isNull(importBatches.deletedAt),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      columns: { id: true, sourceType: true, createdAt: true },
    }),
    db
      .select({ c: count() })
      .from(bookings)
      .where(and(eq(bookings.needsReview, true), eq(bookings.active, true))),
    db.query.importBatches.findMany({
      where: isNull(importBatches.deletedAt),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      with: {
        facility: { columns: { name: true } },
        stylist: { columns: { name: true } },
      },
    }),
  ])

  const needsReviewCount = needsReviewRows[0]?.c ?? 0

  const cardData: SourceCardData[] = SOURCE_DEFS.map((d) => {
    const ofType = batchRows.filter((b) => b.sourceType === d.sourceType)
    return {
      ...d,
      lastImportedAt: ofType[0]?.createdAt instanceof Date ? ofType[0].createdAt.toISOString() : null,
      totalCount: ofType.length,
      needsReviewCount: d.sourceType === 'service_log' ? needsReviewCount : 0,
    }
  })

  const batches: BatchRow[] = fullBatches.map((b) => ({
    id: b.id,
    fileName: b.fileName,
    sourceType: b.sourceType,
    rowCount: b.rowCount,
    matchedCount: b.matchedCount,
    unresolvedCount: b.unresolvedCount,
    createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : null,
    facility: b.facility ? { name: b.facility.name } : null,
    stylist: b.stylist ? { name: b.stylist.name } : null,
  }))

  return <ImportsHubClient cards={cardData} batches={batches} initialReviewCount={needsReviewCount} />
}
