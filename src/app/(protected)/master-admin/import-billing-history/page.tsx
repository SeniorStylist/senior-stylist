import { redirect } from 'next/navigation'

// Superseded by the QuickBooks Import Suite (handles invoices + payments + contacts,
// duplicate-proof). Kept as a redirect for saved bookmarks; the old API route at
// /api/super-admin/import-billing-history remains functional.
export default function ImportBillingHistoryPage() {
  redirect('/master-admin/imports/quickbooks')
}
