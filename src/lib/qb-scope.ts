// Shared-realm guard for QB pulls. The production books are ONE QuickBooks
// company holding every facility as a parent customer ("F177" → sub-customers
// "F177:Smith, Margaret - 12" as FullyQualifiedNames). A realm-wide
// SELECT * FROM Invoice/Payment therefore returns EVERY facility's rows —
// without this gate each connected facility would ingest (and attribute to
// itself) every other facility's money.
//
// Verdict semantics: `true` = belongs to this facility, `false` = provably
// another facility's (skip it), `null` = unknown — callers keep the historic
// behavior for unknowns (single-facility realms have plain customer names
// with no F-prefix, and those must keep syncing).

import { db } from '@/db'
import { facilities, qbCustomerLinks } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { ensureQbLinksSchema } from '@/lib/qb-links-ddl'

export interface FacilityQbScope {
  /** Numeric QB Customer.Id of this facility's parent customer (from qb_customer_links). */
  parentId: string | null
  /** The parent customer's DisplayName (usually the F-code, e.g. "F177"). */
  parentName: string | null
  /** This facility's own F-code. */
  facilityCode: string | null
}

const F_CODE_RE = /^f\d{2,5}$/

export async function getFacilityQbScope(facilityId: string): Promise<FacilityQbScope> {
  await ensureQbLinksSchema()
  const [facility, parentLink] = await Promise.all([
    db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { facilityCode: true },
    }),
    db.query.qbCustomerLinks
      .findFirst({
        where: and(
          eq(qbCustomerLinks.facilityId, facilityId),
          sql`${qbCustomerLinks.residentId} IS NULL`,
        ),
        columns: { qbCustomerId: true, qbDisplayName: true },
      })
      .catch(() => null),
  ])
  return {
    parentId: parentLink?.qbCustomerId ?? null,
    parentName: parentLink?.qbDisplayName ?? null,
    facilityCode: facility?.facilityCode ?? null,
  }
}

/**
 * Does a QB CustomerRef belong to this facility? `linkedIds` is the set of
 * numeric Customer.Ids already linked to this facility (residents + parent).
 */
export function customerBelongsToFacility(
  ref: { value?: string; name?: string } | undefined,
  scope: FacilityQbScope,
  linkedIds: ReadonlySet<string>,
): boolean | null {
  if (!ref) return null
  if (ref.value && linkedIds.has(ref.value)) return true
  if (ref.value && scope.parentId && ref.value === scope.parentId) return true

  const name = (ref.name ?? '').trim()
  if (!name) return null
  const lower = name.toLowerCase()
  const parentLower = scope.parentName?.trim().toLowerCase() ?? null
  const codeLower = scope.facilityCode?.trim().toLowerCase() ?? null

  const colonIdx = name.indexOf(':')
  if (colonIdx > 0) {
    // Sub-customer: the prefix is the parent's DisplayName.
    const prefix = lower.slice(0, colonIdx).trim()
    if (parentLower && prefix === parentLower) return true
    if (codeLower && prefix === codeLower) return true
    if (parentLower || F_CODE_RE.test(prefix)) return false // another facility's
    return null
  }

  // Top-level customer — a facility parent (facility-level payment/invoice).
  if (parentLower && lower === parentLower) return true
  if (codeLower && (lower === codeLower || lower.startsWith(`${codeLower} `))) return true
  // An F-code-shaped top-level name that didn't match ours = another facility's.
  if (F_CODE_RE.test(lower.split(/\s/)[0] ?? '')) return false
  return null
}
