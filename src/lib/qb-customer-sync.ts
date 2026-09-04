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
import { qbGet, qbPost, qbQuoteLiteral, qbRequestId } from '@/lib/quickbooks'
import { fuzzyBestMatch } from '@/lib/fuzzy'
import { parseResidentName } from '@/lib/qb-invoice-sync'
import { ensureQbLinksSchema } from '@/lib/qb-links-ddl'
import { capLabels, recordSyncRun, type SyncCustomersRunItems } from '@/lib/qb-runs'

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
  /** qb_sync_runs id — undo deactivates the customers this run CREATED. */
  runId: string | null
}

const PAGE_SIZE = 100
const CUSTOMER_CAP = 5000
const CREATE_CAP = 200
/** Stop creating with time to spare inside the route's 300s budget. Links are
 *  written per-create, so the next run picks up exactly where this one left off. */
const CREATE_BUDGET_MS = 4 * 60 * 1000

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

async function fetchAllQBCustomers(
  facilityId: string,
): Promise<{ customers: QBCustomer[]; capped: boolean }> {
  const all: QBCustomer[] = []
  let startPosition = 1
  let capped = false
  while (true) {
    const query = `SELECT * FROM Customer WHERE Active = true STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`
    const res = await qbGet<QBCustomerQueryResponse>(
      facilityId,
      `/query?query=${encodeURIComponent(query)}&minorversion=75`,
    )
    const page = res.QueryResponse?.Customer ?? []
    all.push(...page)
    if (page.length < PAGE_SIZE) break
    startPosition += PAGE_SIZE
    if (all.length >= CUSTOMER_CAP) {
      // A truncated list means "customer not found" can't be trusted — callers
      // must NOT create against it (duplicate-name suffix retries would mint
      // real duplicates in the books).
      capped = true
      break
    }
  }
  return { customers: all, capped }
}

/**
 * ONLY this facility's sub-customers, via the "<parent>:<child>"
 * FullyQualifiedName convention.
 *
 * This is the query the sync should almost always use. Production QuickBooks is
 * ONE company holding every facility, so scanning all customers to find one
 * facility's residents is thousands of rows at 100 per page — that is what blew
 * the route's time budget and surfaced as a bare "Customer sync failed".
 * Filtering by the parent prefix is a handful of calls, is immune to the
 * full-list cap, and cannot return another facility's customers.
 *
 * Returns null when the query is rejected, so the caller falls back to the
 * full scan rather than treating "no rows" as "no residents in QuickBooks".
 */
async function fetchQBChildCustomers(
  facilityId: string,
  parentDisplayName: string,
): Promise<{ customers: QBCustomer[]; capped: boolean } | null> {
  const prefix = parentDisplayName.replace(/[%_]/g, '').trim()
  if (!prefix) return null
  const all: QBCustomer[] = []
  let startPosition = 1
  let capped = false
  try {
    while (true) {
      const query =
        `SELECT * FROM Customer WHERE Active = true AND FullyQualifiedName LIKE ${qbQuoteLiteral(`${prefix}:%`)}` +
        ` STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`
      const res = await qbGet<QBCustomerQueryResponse>(
        facilityId,
        `/query?query=${encodeURIComponent(query)}`,
      )
      const page = res.QueryResponse?.Customer ?? []
      all.push(...page)
      if (page.length < PAGE_SIZE) break
      startPosition += PAGE_SIZE
      if (all.length >= CUSTOMER_CAP) {
        capped = true
        break
      }
    }
  } catch (err) {
    console.error('[qb-customer-sync] parent-prefix query failed; falling back to a full scan:', err)
    return null
  }
  return { customers: all, capped }
}

/**
 * Top-level customer whose DisplayName STARTS with the facility's F-code.
 * The books name facility customers "F123 - Autumn Lake Crofton" (the CSV
 * importer's convention), so an exact "F123" lookup misses and would otherwise
 * force a full-company scan. The code must be a whole token, so F12 can never
 * match F123.
 */
async function findQBParentByCodePrefix(
  facilityId: string,
  facilityCode: string,
): Promise<QBCustomer | null> {
  const code = facilityCode.replace(/[%_]/g, '').trim()
  if (!code) return null
  const query = `SELECT * FROM Customer WHERE Active = true AND DisplayName LIKE ${qbQuoteLiteral(`${code}%`)} MAXRESULTS 20`
  try {
    const res = await qbGet<QBCustomerQueryResponse>(
      facilityId,
      `/query?query=${encodeURIComponent(query)}`,
    )
    const boundary = new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    return (
      res.QueryResponse?.Customer?.find(
        (c) => !c.ParentRef && boundary.test((c.DisplayName ?? '').trim()),
      ) ?? null
    )
  } catch {
    return null
  }
}

/** One customer by numeric Intuit id — used to re-read an already-linked parent. */
async function findQBCustomerById(facilityId: string, id: string): Promise<QBCustomer | null> {
  try {
    const res = await qbGet<{ Customer?: QBCustomer }>(
      facilityId,
      `/customer/${encodeURIComponent(id)}`,
    )
    return res.Customer ?? null
  } catch {
    return null
  }
}

/** Exact DisplayName lookup — cheap, and immune to the full-list cap. */
async function findQBCustomerByDisplayName(
  facilityId: string,
  displayName: string,
): Promise<QBCustomer | null> {
  const query = `SELECT * FROM Customer WHERE DisplayName = ${qbQuoteLiteral(displayName)}`
  try {
    const res = await qbGet<QBCustomerQueryResponse>(
      facilityId,
      `/query?query=${encodeURIComponent(query)}&minorversion=75`,
    )
    return res.QueryResponse?.Customer?.[0] ?? null
  } catch {
    return null
  }
}

async function createQBCustomer(
  facilityId: string,
  body: Record<string, unknown>,
  fallbackSuffix: string,
): Promise<QBCustomer> {
  // Intuit RequestId: a dropped connection + retry replays the original
  // create instead of minting a duplicate customer.
  const requestId = qbRequestId('customer', facilityId, String(body.DisplayName ?? ''), String(body.ParentRef ? (body.ParentRef as { value: string }).value : ''))
  try {
    const res = await qbPost<QBCustomerCreateResponse>(facilityId, '/customer', body, { requestId })
    return res.Customer
  } catch (err) {
    // QB DisplayNames are unique across ALL customers/vendors/employees — a
    // same-named resident at another facility collides. Retry once with a
    // disambiguating suffix.
    const message = (err as Error).message ?? ''
    if (message.includes('6240') || message.toLowerCase().includes('duplicate name')) {
      const suffixed = `${body.DisplayName} ${fallbackSuffix}`
      const res = await qbPost<QBCustomerCreateResponse>(
        facilityId,
        '/customer',
        { ...body, DisplayName: suffixed },
        { requestId: qbRequestId('customer', facilityId, suffixed) },
      )
      return res.Customer
    }
    throw err
  }
}

/**
 * The facility's parent customer using only cheap, cap-immune queries: the
 * F-code as an exact DisplayName, then as a name prefix, then the stored
 * display name. Returns null when none hit — the caller then falls back to
 * scanning the company (slow on a shared realm, so it is the last resort).
 */
async function findParentByTargetedLookups(
  facilityId: string,
  facility: { name: string; facilityCode: string | null; qbCustomerId: string | null },
): Promise<QBCustomer | null> {
  const displayName = (facility.facilityCode ?? facility.name).replace(/:/g, '').trim()
  let parent =
    (await findQBCustomerByDisplayName(facilityId, displayName)) ??
    (facility.facilityCode ? await findQBParentByCodePrefix(facilityId, facility.facilityCode) : null) ??
    (facility.qbCustomerId && !facility.qbCustomerId.includes(':')
      ? await findQBCustomerByDisplayName(facilityId, facility.qbCustomerId)
      : null)
  if (parent?.ParentRef) parent = null // the facility customer must be top-level
  return parent
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

/** A QuickBooks customer this call resolved, and whether it had to CREATE it —
 *  creating a customer in the client's books is a real change history must name. */
export interface EnsuredCustomer {
  id: string
  displayName: string
  created: boolean
}

/** Numeric QB Customer.Id of the facility's parent customer, creating it if needed. */
export async function ensureQBFacilityParent(facilityId: string): Promise<EnsuredCustomer> {
  await ensureQbLinksSchema()
  const existing = await db.query.qbCustomerLinks.findFirst({
    where: and(
      eq(qbCustomerLinks.facilityId, facilityId),
      sql`${qbCustomerLinks.residentId} IS NULL`,
    ),
    columns: { qbCustomerId: true, qbDisplayName: true },
  })
  if (existing) {
    return { id: existing.qbCustomerId, displayName: existing.qbDisplayName ?? '', created: false }
  }

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: { name: true, facilityCode: true, qbCustomerId: true },
  })
  if (!facility) throw new Error('Facility not found')

  // Parent DisplayName follows the books' F-code convention so sub-customer
  // FullyQualifiedNames come out as "F177:Smith, Margaret - 12".
  const displayName = (facility.facilityCode ?? facility.name).replace(/:/g, '').trim()

  // Targeted lookups first (cap-immune), then the full-list detection.
  let parent = await findParentByTargetedLookups(facilityId, facility)

  if (!parent) {
    const { customers, capped } = await fetchAllQBCustomers(facilityId)
    parent = detectFacilityParent(
      customers,
      facility.facilityCode,
      facility.name,
      facility.qbCustomerId,
    )
    if (!parent && capped) {
      throw new Error(
        'QuickBooks customer list is too large to scan safely — could not confirm the facility parent customer',
      )
    }
  }
  let created = false
  if (!parent) {
    parent = await createQBCustomer(
      facilityId,
      { DisplayName: displayName, CompanyName: facility.name },
      '(SS)',
    )
    created = true
  }
  await upsertParentLink(facilityId, parent)
  return { id: parent.Id, displayName: parent.DisplayName ?? displayName, created }
}

/**
 * Numeric QB Customer.Id for a resident, linking an existing QB customer by
 * stored display name when possible and creating a sub-customer otherwise.
 * Used just-in-time by the invoice push.
 */
export async function ensureQBCustomerForResident(
  facilityId: string,
  residentId: string,
): Promise<EnsuredCustomer> {
  await ensureQbLinksSchema()
  const existing = await db.query.qbCustomerLinks.findFirst({
    where: and(
      eq(qbCustomerLinks.facilityId, facilityId),
      eq(qbCustomerLinks.residentId, residentId),
    ),
    columns: { qbCustomerId: true, qbDisplayName: true },
  })
  if (existing) {
    return { id: existing.qbCustomerId, displayName: existing.qbDisplayName ?? '', created: false }
  }

  const resident = await db.query.residents.findFirst({
    where: and(eq(residents.id, residentId), eq(residents.facilityId, facilityId)),
    columns: { id: true, name: true, roomNumber: true, qbCustomerId: true },
  })
  if (!resident) throw new Error('Resident not found at this facility')

  const parentId = (await ensureQBFacilityParent(facilityId)).id

  // Try to find the customer in QB before creating (stored display name first).
  let customer: QBCustomer | null = null
  if (resident.qbCustomerId) {
    const query = `SELECT * FROM Customer WHERE FullyQualifiedName = ${qbQuoteLiteral(resident.qbCustomerId)}`
    try {
      const res = await qbGet<QBCustomerQueryResponse>(
        facilityId,
        `/query?query=${encodeURIComponent(query)}&minorversion=75`,
      )
      customer = res.QueryResponse?.Customer?.[0] ?? null
    } catch {
      // fall through to create
    }
  }
  const desiredName = residentDisplayName(resident.name, resident.roomNumber)
  if (!customer) {
    // Exact DisplayName lookup before creating — a same-named sub-customer
    // already in the books must be LINKED, not duplicated via the 6240
    // suffix retry. Only accept it when it hangs under OUR parent.
    const existingByName = await findQBCustomerByDisplayName(facilityId, desiredName)
    if (existingByName?.ParentRef?.value === parentId) customer = existingByName
  }
  let created = false
  if (!customer) {
    customer = await createQBCustomer(
      facilityId,
      {
        DisplayName: desiredName,
        Job: true,
        ParentRef: { value: parentId },
      },
      `(${residentId.slice(0, 4)})`,
    )
    created = true
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

  return { id: customer.Id, displayName: customer.DisplayName ?? desiredName, created }
}

export async function syncQBCustomers(
  facilityId: string,
  opts: { createdBy?: string | null } = {},
): Promise<SyncQBCustomersResult> {
  await ensureQbLinksSchema()
  const startedAt = new Date()
  const createdLinks: SyncCustomersRunItems['createdLinks'] = []
  const result: SyncQBCustomersResult = {
    matchedExisting: 0,
    createdInQb: 0,
    updatedInQb: 0,
    skipped: 0,
    errors: [],
    runId: null,
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

  // ── Resolve the facility's parent customer with CHEAP targeted lookups ──
  // (an already-linked id, then the F-code DisplayName, then the stored name).
  // Only when all of those miss do we fall back to scanning the whole company.
  const parentDisplayName = (facility.facilityCode ?? facility.name).replace(/:/g, '').trim()
  const linkedParent = existingLinks.find((l) => !l.residentId)
  let parent: QBCustomer | null = linkedParent
    ? await findQBCustomerById(facilityId, linkedParent.qbCustomerId)
    : null
  if (!parent) {
    parent = await findParentByTargetedLookups(facilityId, {
      name: facility.name,
      facilityCode: facility.facilityCode,
      qbCustomerId: facility.qbCustomerId,
    })
  }

  // ── Pull the customers to match against ───────────────────────────────
  // With a known parent that is just its own sub-customers; otherwise the whole
  // company, which is slow and cap-limited (see fetchQBChildCustomers).
  let customers: QBCustomer[] = []
  let capped = false
  const targeted = parent
    ? await fetchQBChildCustomers(facilityId, parent.DisplayName ?? parentDisplayName)
    : null
  if (targeted) {
    customers = targeted.customers
    capped = targeted.capped
  } else {
    const full = await fetchAllQBCustomers(facilityId)
    customers = full.customers
    capped = full.capped
    parent ??= detectFacilityParent(
      customers,
      facility.facilityCode,
      facility.name,
      facility.qbCustomerId,
    )
  }
  if (capped) {
    result.errors.push(
      `QuickBooks holds more than ${CUSTOMER_CAP} customers — matched what was scanned; nothing was created (a truncated scan can't prove a customer is missing)`,
    )
  }
  // upsertParentLink RE-POINTS the facility→parent mapping on every run, so a
  // changed resolution silently moves every future invoice to a different
  // QuickBooks customer. Record which parent won, and what it replaced.
  let parentCreated = false
  let parentDisplayNameResolved = parent?.DisplayName ?? parentDisplayName
  const prevParentQbId = linkedParent?.qbCustomerId ?? null

  // ── Pass 1: match existing QB customers to residents ──────────────────

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
  const matchedLinks: NonNullable<SyncCustomersRunItems['matchedLinks']> = []
  const fuzzyPool = residentList.filter((r) => !claimed.has(r.id))

  for (const c of customers) {
    if (!c.ParentRef) continue // only sub-customers map to residents
    // SHARED-REALM GUARD: the realm holds every facility's sub-customers.
    // DisplayName + fuzzy matching are only safe under OUR parent; without a
    // detected parent, only an exact stored FullyQualifiedName (which embeds
    // the facility prefix) is unambiguous.
    const underOurParent = !!parent && c.ParentRef.value === parent.Id
    const dn = norm(c.DisplayName)
    const fqn = norm(c.FullyQualifiedName)

    // Track WHICH rule bound this resident — 'fuzzy' is the only one that can
    // be wrong, and a wrong bind silently misroutes that resident's invoices
    // forever, so the panel flags those for a glance.
    let matchMethod: 'stored_name' | 'display_name' | 'fuzzy' = 'stored_name'
    let match = byStoredName.get(fqn) ?? null
    if (!match && underOurParent) {
      match = byStoredName.get(dn) ?? null
      if (match) matchMethod = 'display_name'
    }
    if (match && claimed.has(match.id)) match = null
    if (!match && underOurParent) {
      const parsed = parseResidentName(c.FullyQualifiedName ?? c.DisplayName ?? '')
      if (parsed) {
        const hit = fuzzyBestMatch(
          fuzzyPool.filter((r) => !claimed.has(r.id)),
          parsed,
          0.7,
        )
        if (hit) {
          match = hit
          matchMethod = 'fuzzy'
        }
      }
    }
    if (!match) continue

    claimed.add(match.id)
    matchedLinks.push({
      residentName: match.name,
      roomNumber: match.roomNumber,
      qbDisplayName: c.DisplayName ?? null,
      matchMethod,
    })
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
  // Skipped entirely when the scan was truncated — "not found in a partial
  // list" is not "missing", and the duplicate-name retry would mint real
  // duplicates in the books.
  let parentId = parent?.Id ?? null
  const unlinked = capped ? [] : residentList.filter((r) => !claimed.has(r.id))
  if (unlinked.length > 0 && !parentId) {
    try {
      const ensured = await ensureQBFacilityParent(facilityId)
      parentId = ensured.id
      parentCreated = parentCreated || ensured.created
      parentDisplayNameResolved = ensured.displayName || parentDisplayNameResolved
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
      // Return partial progress instead of being killed mid-run by the
      // platform's function timeout (which yields an HTML page, not JSON).
      if (Date.now() - startedAt.getTime() > CREATE_BUDGET_MS) {
        result.errors.push(
          `Stopped after ${creates} new customers to stay inside the time limit — run Sync Customers again to continue`,
        )
        break
      }
      try {
        const desiredName = residentDisplayName(r.name, r.roomNumber)
        // LINK-BEFORE-CREATE. Never trust "absent from the fetched list" as
        // proof a customer doesn't exist: if the customer pull ever comes back
        // short, creating blindly would mint a duplicate for every resident
        // (and the 6240 retry would happily suffix them). An exact-name hit
        // under OUR parent is the same resident — link it.
        const alreadyInQb = await findQBCustomerByDisplayName(facilityId, desiredName)
        const customer =
          alreadyInQb?.ParentRef?.value === parentId
            ? alreadyInQb
            : await createQBCustomer(
                facilityId,
                { DisplayName: desiredName, Job: true, ParentRef: { value: parentId } },
                `(${r.id.slice(0, 4)})`,
              )
        const wasCreated = customer !== alreadyInQb
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
          .returning({ id: qbCustomerLinks.id })
          .then(([link]) => {
            // Undo deactivates the customers a run CREATED — a customer that
            // was already in the books and merely linked must never be listed
            // here, or undoing would deactivate the facility's real record.
            if (link?.id && wasCreated) {
              createdLinks.push({
                linkId: link.id,
                qbCustomerId: customer.Id,
                residentId: r.id,
                displayName: customer.DisplayName ?? null,
              })
            }
          })
        if (!r.qbCustomerId && customer.FullyQualifiedName) {
          displayNameBackfills.push({ residentId: r.id, displayName: customer.FullyQualifiedName })
        }
        if (wasCreated) result.createdInQb++
        else result.matchedExisting++
      } catch (err) {
        result.errors.push(`${r.name}: ${(err as Error).message?.slice(0, 200)}`)
      }
    }
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

  // Audit + undo record — undo deactivates ONLY the customers this run created
  // (matched links are just mappings; nothing to reverse in QB). matchedLinks
  // is a SEPARATE display key for exactly that reason.
  const matched = capLabels(matchedLinks)
  if (result.matchedExisting + result.createdInQb > 0 || result.errors.length > 0) {
    result.runId = await recordSyncRun({
      facilityId,
      action: 'sync_customers',
      startedAt,
      createdBy: opts.createdBy ?? null,
      summary: {
        matchedExisting: result.matchedExisting,
        createdInQb: result.createdInQb,
        skipped: result.skipped,
        capped,
        errors: result.errors.slice(0, 5),
      },
      items: {
        createdLinks,
        ...(matched.rows.length ? { matchedLinks: matched.rows } : {}),
        ...(matched.truncated ? { matchedTruncated: matched.truncated } : {}),
        ...(parentId
          ? {
              parentCustomer: {
                displayName: parentDisplayNameResolved,
                created: parentCreated,
                ...(prevParentQbId && prevParentQbId !== parentId
                  ? { repointedFrom: prevParentQbId }
                  : {}),
              },
            }
          : {}),
      },
    })
  }

  return result
}
