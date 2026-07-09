import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { importBatches, bookings } from '@/db/schema'
import { count, eq, isNull, and } from 'drizzle-orm'
import { ImportsHubClient, type SourceCardData } from './imports-client'
import type { BatchRow } from './batch-history'

const SOURCE_DEFS: { sourceType: string; title: string; description: string; format: 'XLSX' | 'CSV' | 'PDF'; href: string; category: string }[] = [
  {
    sourceType: 'service_log',
    title: 'Service Log Import',
    description: 'Import a single-facility bookkeeper XLSX to backfill historical bookings, residents, and service records.',
    format: 'XLSX',
    href: '/master-admin/imports/service-log',
    category: 'Service History',
  },
  {
    sourceType: 'multi_service_log',
    title: 'Multi-Facility Log Import',
    description: "Import one XLSX containing every facility's daily log. Auto-creates missing facilities, stylists, and residents; links services by name.",
    format: 'XLSX',
    href: '/master-admin/imports/multi-log',
    category: 'Service History',
  },
  {
    sourceType: 'qb_contacts',
    title: 'QB Customer Contacts',
    description: 'Step 1 — syncs POA emails, phones, and contact names from the QB Customer Contact List CSV. Run first so subsequent imports can match residents.',
    format: 'CSV',
    href: '/master-admin/imports/quickbooks#step-1',
    category: 'QuickBooks CSV',
  },
  {
    sourceType: 'qb_invoices_csv',
    title: 'QB Invoice History',
    description: 'Step 2 — imports the full invoice list and recalculates outstanding balances. Use the QB "Invoice List by Date" CSV export.',
    format: 'CSV',
    href: '/master-admin/imports/quickbooks#step-2',
    category: 'QuickBooks CSV',
  },
  {
    sourceType: 'qb_payments_csv',
    title: 'QB Received Payments',
    description: 'Step 3 — imports every received payment attributed to the right resident. Duplicate-proof; safe to re-run. Use "Invoices and Received Payments" CSV.',
    format: 'CSV',
    href: '/master-admin/imports/quickbooks#step-3',
    category: 'QuickBooks CSV',
  },
  {
    sourceType: 'qb_transactions_csv',
    title: 'QB Transaction Memos',
    description: 'Step 4 (optional) — adds check numbers and memo detail from the QB "Transaction List by Customer" CSV. Enriches existing payments without double-counting.',
    format: 'CSV',
    href: '/master-admin/imports/quickbooks#step-4',
    category: 'QuickBooks CSV',
  },
  {
    sourceType: 'qb_unapplied_csv',
    title: 'QB Unapplied Credits',
    description: 'Step 5 — finds payments QB received but never applied to an invoice, with a per-facility checklist for applying them. Use the QB "Customer Balance Detail" CSV.',
    format: 'CSV',
    href: '/master-admin/imports/quickbooks#step-5',
    category: 'QuickBooks CSV',
  },
  {
    sourceType: 'qb_customer',
    title: 'QB Customer List (XLSX)',
    description: 'Legacy XLSX customer import — superseded by QB Customer Contacts above. Kept for backward compatibility.',
    format: 'XLSX',
    href: '/master-admin/import-quickbooks',
    category: 'QuickBooks CSV',
  },
  {
    sourceType: 'facility_csv',
    title: 'Facility Data Import',
    description: 'Bulk-update facility details, billing types, and contact info.',
    format: 'CSV',
    href: '/master-admin/import-facilities-csv',
    category: 'Facility Data',
  },
  {
    sourceType: 'price_sheet',
    title: 'Bulk Price Sheets',
    description: 'Drop many facility price sheets at once (PDF, image, .docx, .xlsx, .csv). Auto-routes each to its facility, then updates changed prices and adds new services — including per-unit "each" pricing.',
    format: 'PDF',
    href: '/master-admin/imports/price-sheets',
    category: 'Service History',
  },
]

export default async function ImportsHubPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) redirect('/dashboard')

  const [needsReviewRows, fullBatches] = await Promise.all([
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
    const ofType = fullBatches.filter((b) => b.sourceType === d.sourceType)
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
