// QuickBooks customer sync — residents (and the facility parent customer) ↔
// QB Customers via the API, storing NUMERIC Intuit Customer.Ids in
// qb_customer_links. residents.qb_customer_id keeps its display-name meaning
// ("F177:Smith, Margaret - 12" — a QB FullyQualifiedName: parent "F177", sub
// "Smith, Margaret - 12"); QB forbids colons in DisplayName, so the colon form
// only ever appears as FullyQualifiedName.
//
// Match-first, then create: existing QB customers are linked before anything
// is created, so a facility whose books already hold every resident gets
// zero new customers on the first run.

import { db } from '@/db'
import { facilities, residents, qbCustomerLinks } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { qbGet, qbPost } from '@/lib/quickbooks'
import { fuzzyBestMatch } from '@/lib/fuzzy'
import { parseResidentName } from '@/lib/qb-invoice-sync'
import { ensureQbLinksSchema } from '@/lib/qb-links-ddl'

interface QBCustomer {
  Id: string
  SyncToken: string
  DisplayName?: string
  FullyQualifiedName?: string
  Job?: boolean
  ParentRef?: { value: string }
  Active?: boolean
}

interface QBCustomerQueryResponse {
  QueryResponse: { Customer?: QBCustomer[] }
}

interface QBCustomerCreateResponse {
  Customer: QBCustomer
}

export interface SyncQBCustomersResult {
  matchedExisting: number
  createdInQb: number
  updatedInQb: number
  skipped: number
  errors: string[]
}

const PAGE_SIZE = 100
const CUSTOMER_CAP = 2000
const CREATE_CAP = 200

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/** "Last, First[ - room]" — the sub-customer DisplayName convention in the books. */
function residentDisplayName(name: string, roomNumber: string | null): string {
  const clean = name.trim().replace(/:/g, '')
  const parts = clean.split(/\s+/)
  const base =
    parts.length >= 2
      ? `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`
      : clean
  const room = roomNumber?.trim()
  return room ? `${base} - ${room}` : base
}

async function fetchAllQBCustomers(facilityId: string): Promise<QBCustomer[]> {
  const all: QBCustomer[] = []
  let startPosition = 1
  while (true) {
    const query = `SELECT * FROM Customer WHERE Active = true STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`
    const res = await qbGet<QBCustomerQueryResponse>(
      facilityId,
      `/query?query=${encodeURIComponent(query)}&minorversion=65`,
    )
    const page = res.QueryResponse?.Customer ?? []
    all.push(...page)
    if (page.length < PAGE_SIZE) break
    startPosition += PAGE_SIZE
    if (all.length >= CUSTOMER_CAP) break
  }
  return all
}

async function createQBCustomer(
  facilityId: string,
  body: Record<string, unknown>,
  fallbackSuffix: string,
): Promise<QBCustomer> {
  try {
    const res = await qbPost<QBCustomerCreateResponse>(
      facilityId,
      '/customer?minorversion=65',
      body,
    )
    return res.Customer
  } catch (err) {
    // QB DisplayNames are unique across ALL customers/vendors/employees — a
    // same-named resident at another facility collides. Retry once with a
    // disambiguating suffix.
    const message = (err as Error).message ?? ''
    if (message.includes('6240') || message.toLowerCase().includes('duplicate name')) {
      const res = await qbPost<QBCustomerCreateResponse>(
        facilityId,
        '/customer?minorversion=65',
        { ...body, DisplayName: `${body.DisplayName} ${fallbackSuffix}` },
      )
      return res.Customer
    }
    throw err
  }
}

function detectFacilityParent(
  customers: QBCustomer[],
  facilityCode: string | null,
  facilityName: string,
  facilityQbCustomerId: string | null,
): QBCustomer | null {
  const topLevel = customers.filter((c) => !c.ParentRef)
  const code = norm(facilityCode)
  const storedName = norm(facilityQbCustomerId)
  // Exact stored-name match first, then the F-code convention, then name fuzzy.
  for (const c of topLevel) {
    const dn = norm(c.DisplayName)
    if (storedName && (dn === storedName || norm(c.FullyQualifiedName) === storedName)) return c
    if (code && (dn === code || dn.startsWith(`${code} `) || dn.startsWith(`${code} -`))) return c
  }
  const named = fuzzyBestMatch(
    topLevel.map((c) => ({ name: c.DisplayName ?? '', customer: c })),
    facilityName,
    0.7,
  )
  return named?.customer ?? null
}

async function upsertParentLink(
  facilityId: string,
  customer: QBCustomer,
): Promise<void> {
  await db
    .insert(qbCustomerLinks)
    .values({
      facilityId,
      residentId: null,
      qbCustomerId: customer.Id,
      qbDisplayName: customer.DisplayName ?? null,
      qbSyncToken: customer.SyncToken ?? null,
      qbParentId: null,
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [qbCustomerLinks.facilityId],
      targetWhere: sql`resident_id IS NULL`,
      set: {
        qbCustomerId: sql`excluded.qb_customer_id`,
        qbDisplayName: sql`excluded.qb_display_name`,
        qbSyncToken: sql`excluded.qb_sync_token`,
        lastSyncedAt: sql`excluded.last_synced_at`,
        updatedAt: new Date(),
      },
    })
}

/** Numeric QB Customer.Id of the facility's parent customer, creating it if needed. */
export async function ensureQBFacilityParent(facilityId: string): Promise<string> {
  await ensureQbLinksSchema()
  const existing = await db.query.qbCustomerLinks.findFirst({
    where: and(
      eq(qbCustomerLinks.facilityId, facilityId),
      sql`${qbCustomerLinks.residentId} IS NULL`,
    ),
    columns: { qbCustomerId: true },
  })
  if (existing) return existing.qbCustomerId

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: { name: true, facilityCode: true, qbCustomerId: true },
  })
  if (!facility) throw new Error('Facility not found')

  // Look for an existing top-level customer before creating one.
  const customers = await fetchAllQBCustomers(facilityId)
  let parent = detectFacilityParent(
    customers,
    facility.facilityCode,
    facility.name,
    facility.qbCustomerId,
  )
  if (!parent) {
    // Parent DisplayName follows the books' F-code convention so sub-customer
    // FullyQualifiedNames come out as "F177:Smith, Margaret - 12".
    const displayName = (facility.facilityCode ?? facility.name).replace(/:/g, '').trim()
    parent = await createQBCustomer(
      facilityId,
      { DisplayName: displayName, CompanyName: facility.name },
      '(SS)',
    )
  }
  await upsertParentLink(facilityId, parent)
  return parent.Id
}

/**
 * Numeric QB Customer.Id for a resident, linking an existing QB customer by
 * stored display name when possible and creating a sub-customer otherwise.
 * Used just-in-time by the invoice push.
 */
export async function ensureQBCustomerForResident(
  facilityId: string,
  residentId: string,
): Promise<string> {
  await ensureQbLinksSchema()
  const existing = await db.query.qbCustomerLinks.findFirst({
    where: and(
      eq(qbCustomerLinks.facilityId, facilityId),
      eq(qbCustomerLinks.residentId, residentId),
    ),
    columns: { qbCustomerId: true },
  })
  if (existing) return existing.qbCustomerId

  const resident = await db.query.residents.findFirst({
    where: and(eq(residents.id, residentId), eq(residents.facilityId, facilityId)),
    columns: { id: true, name: true, roomNumber: true, qbCustomerId: true },
  })
  if (!resident) throw new Error('Resident not found at this facility')

  const parentId = await ensureQBFacilityParent(facilityId)

  // Try to find the customer in QB before creating (stored display name first).
  let customer: QBCustomer | null = null
  if (resident.qbCustomerId) {
    const stored = resident.qbCustomerId.replace(/'/g, "\\'")
    const query = `SELECT * FROM Customer WHERE FullyQualifiedName = '${stored}'`
    try {
      const res = await qbGet<QBCustomerQueryResponse>(
        facilityId,
        `/query?query=${encodeURIComponent(query)}&minorversion=65`,
      )
      customer = res.QueryResponse?.Customer?.[0] ?? null
    } catch {
      // fall through to create
    }
  }
  if (!customer) {
    customer = await createQBCustomer(
      facilityId,
      {
        DisplayName: residentDisplayName(resident.name, resident.roomNumber),
        Job: true,
        ParentRef: { value: parentId },
      },
      `(${residentId.slice(0, 4)})`,
    )
  }

  await db
    .insert(qbCustomerLinks)
    .values({
      facilityId,
      residentId,
      qbCustomerId: customer.Id,
      qbDisplayName: customer.DisplayName ?? null,
      qbSyncToken: customer.SyncToken ?? null,
      qbParentId: parentId,
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [qbCustomerLinks.facilityId, qbCustomerLinks.residentId],
      targetWhere: sql`resident_id IS NOT NULL`,
      set: {
        qbCustomerId: sql`excluded.qb_customer_id`,
        qbDisplayName: sql`excluded.qb_display_name`,
        qbSyncToken: sql`excluded.qb_sync_token`,
        qbParentId: sql`excluded.qb_parent_id`,
        lastSyncedAt: sql`excluded.last_synced_at`,
        updatedAt: new Date(),
      },
    })

  // Backfill the display-name column when empty (existing column — its
  // display-name semantics are load-bearing for CSV import + invoice matching).
  if (!resident.qbCustomerId && customer.FullyQualifiedName) {
    await db
      .update(residents)
      .set({ qbCustomerId: customer.FullyQualifiedName })
      .where(and(eq(residents.id, residentId), sql`qb_customer_id IS NULL`))
  }

  return customer.Id
}

export async function syncQBCustomers(facilityId: string): Promise<SyncQBCustomersResult> {
  await ensureQbLinksSchema()
  const result: SyncQBCustomersResult = {
    matchedExisting: 0,
    createdInQb: 0,
    updatedInQb: 0,
    skipped: 0,
    errors: [],
  }

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: { id: true, name: true, facilityCode: true, qbRealmId: true, qbCustomerId: true },
  })
  if (!facility?.qbRealmId) throw new Error('QuickBooks not connected for this facility')

  const residentList = await db.query.residents.findMany({
    where: and(
      eq(residents.facilityId, facilityId),
      eq(residents.active, true),
      eq(residents.isDemo, false), // is_demo filter — Phase 13
    ),
    columns: { id: true, name: true, roomNumber: true, qbCustomerId: true },
  })

  const existingLinks = await db.query.qbCustomerLinks.findMany({
    where: eq(qbCustomerLinks.facilityId, facilityId),
  })
  const linkByResident = new Map(
    existingLinks.filter((l) => l.residentId).map((l) => [l.residentId as string, l]),
  )

  const customers = await fetchAllQBCustomers(facilityId)

  // ── Pass 1: match existing QB customers to residents ──────────────────
  const parent = detectFacilityParent(
    customers,
    facility.facilityCode,
    facility.name,
    facility.qbCustomerId,
  )

  const byStoredName = new Map<string, (typeof residentList)[number]>()
  for (const r of residentList) {
    if (r.qbCustomerId) byStoredName.set(norm(r.qbCustomerId), r)
  }

  const claimed = new Set<string>(linkByResident.keys())
  const newLinks: Array<{
    residentId: string
    qbCustomerId: string
    qbDisplayName: string | null
    qbSyncToken: string | null
    qbParentId: string | null
  }> = []
  const displayNameBackfills: Array<{ residentId: string; displayName: string }> = []
  const fuzzyPool = residentList.filter((r) => !claimed.has(r.id))

  for (const c of customers) {
    if (!c.ParentRef) continue // only sub-customers map to residents
    const dn = norm(c.DisplayName)
    const fqn = norm(c.FullyQualifiedName)

    let match =
      byStoredName.get(fqn) ??
      byStoredName.get(dn) ??
      null
    if (match && claimed.has(match.id)) match = null
    if (!match) {
      const parsed = parseResidentName(c.FullyQualifiedName ?? c.DisplayName ?? '')
      if (parsed) {
        const hit = fuzzyBestMatch(
          fuzzyPool.filter((r) => !claimed.has(r.id)),
          parsed,
          0.7,
        )
        if (hit) match = hit
      }
    }
    if (!match) continue

    claimed.add(match.id)
    newLinks.push({
      residentId: match.id,
      qbCustomerId: c.Id,
      qbDisplayName: c.DisplayName ?? null,
      qbSyncToken: c.SyncToken ?? null,
      qbParentId: c.ParentRef?.value ?? null,
    })
    if (!match.qbCustomerId && c.FullyQualifiedName) {
      displayNameBackfills.push({ residentId: match.id, displayName: c.FullyQualifiedName })
    }
    result.matchedExisting++
  }

  if (newLinks.length > 0) {
    // One batched upsert (max:1 pool — never per-row inserts).
    await db
      .insert(qbCustomerLinks)
      .values(
        newLinks.map((l) => ({
          facilityId,
          residentId: l.residentId,
          qbCustomerId: l.qbCustomerId,
          qbDisplayName: l.qbDisplayName,
          qbSyncToken: l.qbSyncToken,
          qbParentId: l.qbParentId,
          lastSyncedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [qbCustomerLinks.facilityId, qbCustomerLinks.residentId],
        targetWhere: sql`resident_id IS NOT NULL`,
        set: {
          qbCustomerId: sql`excluded.qb_customer_id`,
          qbDisplayName: sql`excluded.qb_display_name`,
          qbSyncToken: sql`excluded.qb_sync_token`,
          qbParentId: sql`excluded.qb_parent_id`,
          lastSyncedAt: sql`excluded.last_synced_at`,
          updatedAt: new Date(),
        },
      })
  }

  if (parent) await upsertParentLink(facilityId, parent)

  // ── Pass 2: create missing sub-customers ─────────────────────────────
  let parentId = parent?.Id ?? null
  const unlinked = residentList.filter((r) => !claimed.has(r.id))
  if (unlinked.length > 0 && !parentId) {
    try {
      parentId = await ensureQBFacilityParent(facilityId)
    } catch (err) {
      result.errors.push(`Facility parent customer: ${(err as Error).message?.slice(0, 200)}`)
    }
  }

  if (parentId) {
    let creates = 0
    for (const r of unlinked) {
      if (creates >= CREATE_CAP) {
        result.errors.push(`Stopped after ${CREATE_CAP} new customers — run Sync Customers again to continue`)
        break
      }
      try {
        const customer = await createQBCustomer(
          facilityId,
          {
            DisplayName: residentDisplayName(r.name, r.roomNumber),
            Job: true,
            ParentRef: { value: parentId },
          },
          `(${r.id.slice(0, 4)})`,
        )
        creates++
        // Link immediately after each create (not batched at the end) so a
        // mid-run crash never leaves a created-but-unlinked QB customer that
        // a re-run would duplicate.
        await db
          .insert(qbCustomerLinks)
          .values({
            facilityId,
            residentId: r.id,
            qbCustomerId: customer.Id,
            qbDisplayName: customer.DisplayName ?? null,
            qbSyncToken: customer.SyncToken ?? null,
            qbParentId: parentId,
            lastSyncedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [qbCustomerLinks.facilityId, qbCustomerLinks.residentId],
            targetWhere: sql`resident_id IS NOT NULL`,
            set: {
              qbCustomerId: sql`excluded.qb_customer_id`,
              qbSyncToken: sql`excluded.qb_sync_token`,
              qbDisplayName: sql`excluded.qb_display_name`,
              lastSyncedAt: sql`excluded.last_synced_at`,
              updatedAt: new Date(),
            },
          })
        if (!r.qbCustomerId && customer.FullyQualifiedName) {
          displayNameBackfills.push({ residentId: r.id, displayName: customer.FullyQualifiedName })
        }
        result.createdInQb++
      } catch (err) {
        result.errors.push(`${r.name}: ${(err as Error).message?.slice(0, 200)}`)
      }
    }
  } else if (unlinked.length > 0) {
    result.skipped += unlinked.length
  }

  // ── Display-name backfill (batched — max:1 pool) ─────────────────────
  if (displayNameBackfills.length > 0) {
    const CHUNK = 200
    for (let i = 0; i < displayNameBackfills.length; i += CHUNK) {
      const chunk = displayNameBackfills.slice(i, i + CHUNK)
      const values = sql.join(
        chunk.map((b) => sql`(${b.residentId}::uuid, ${b.displayName}::text)`),
        sql`, `,
      )
      await db.execute(sql`
        UPDATE residents SET qb_customer_id = v.display_name
        FROM (VALUES ${values}) AS v(id, display_name)
        WHERE residents.id = v.id AND residents.qb_customer_id IS NULL
      `)
    }
  }

  result.skipped = residentList.length - result.matchedExisting - result.createdInQb

  return result
}
