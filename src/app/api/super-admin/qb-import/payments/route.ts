// QB payment history import — accepts BOTH grouped-by-customer exports:
//   • "Invoices and Received Payments"  (resident-level payments, no memos)
//   • "Transaction List by Customer"    (facility + resident payments, with memos)
// Idempotent: existing payments matching (facility, resident, date, amount) are treated
// as duplicates (multiset semantics — two genuine same-day same-amount payments survive).
// A resident-level payment that matches an older facility-level row (resident_id null)
// UPGRADES that row in place instead of double-counting the money. Master admin only.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, qbPayments } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { parseGroupedTransactionsCsv, extractCheckNum, chunkArr, type CustomerSection } from '@/lib/imports/qb-csv'
import { revalidateTag } from 'next/cache'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const MAX_WARNINGS = 200
const IMPORTABLE_TYPES = new Set(['Payment', 'Sales Receipt'])

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!superAdminEmail || user.email !== superAdminEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await checkRateLimit('billingImport', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    const parsed = parseGroupedTransactionsCsv(await file.text())
    if (!parsed || parsed.sections.length === 0) {
      return Response.json({
        error: 'Could not read this file — expected the QB "Invoices and Received Payments" or "Transaction List by Customer" export',
      }, { status: 400 })
    }

    const warnings: string[] = []
    const warn = (msg: string) => { if (warnings.length < MAX_WARNINGS) warnings.push(msg) }

    // ── Lookup maps ──────────────────────────────────────────────────────────
    const facilityRows = await db.select({
      id: facilities.id,
      facilityCode: facilities.facilityCode,
      qbCustomerId: facilities.qbCustomerId,
    }).from(facilities)
    const facilityByCode = new Map<string, string>()
    for (const f of facilityRows) {
      if (f.facilityCode) facilityByCode.set(f.facilityCode, f.id)
      if (f.qbCustomerId && !facilityByCode.has(f.qbCustomerId)) facilityByCode.set(f.qbCustomerId, f.id)
    }

    const residentRows = await db.select({
      id: residents.id,
      facilityId: residents.facilityId,
      name: residents.name,
      roomNumber: residents.roomNumber,
      qbCustomerId: residents.qbCustomerId,
    }).from(residents).where(eq(residents.active, true))

    const residentByQbId = new Map<string, { id: string; facilityId: string }>()
    // QB customer key suffix ("Last, First - Room") → residents — resolves the
    // "Invoices and Received Payments" sections which omit the F-code prefix
    const residentsBySuffix = new Map<string, { id: string; facilityId: string }[]>()
    const residentsByNameRoom = new Map<string, { id: string; facilityId: string }[]>()
    for (const r of residentRows) {
      if (r.qbCustomerId) {
        residentByQbId.set(r.qbCustomerId, r)
        const colonIdx = r.qbCustomerId.lastIndexOf(':')
        if (colonIdx >= 0) {
          const suffix = normalizeKey(r.qbCustomerId.slice(colonIdx + 1))
          const list = residentsBySuffix.get(suffix) ?? []
          list.push(r)
          residentsBySuffix.set(suffix, list)
        }
      }
      const nameRoomKey = `${normalizeKey(r.name)}|${normalizeKey(r.roomNumber ?? '')}`
      const list = residentsByNameRoom.get(nameRoomKey) ?? []
      list.push(r)
      residentsByNameRoom.set(nameRoomKey, list)
    }

    function resolveResident(section: CustomerSection): { id: string; facilityId: string } | 'ambiguous' | null {
      if (section.qbCustomerId) return residentByQbId.get(section.qbCustomerId) ?? null
      // Suffix match — the section header IS the post-colon part of the QB customer key
      const bySuffix = residentsBySuffix.get(normalizeKey(section.raw)) ?? []
      if (bySuffix.length === 1) return bySuffix[0]
      if (bySuffix.length > 1) return 'ambiguous'
      // Fall back to parsed display name + room (residents created in-app without a QB link)
      if (section.residentKey) {
        const key = `${normalizeKey(section.residentKey.name)}|${normalizeKey(section.residentKey.room ?? '')}`
        const byName = residentsByNameRoom.get(key) ?? []
        if (byName.length === 1) return byName[0]
        if (byName.length > 1) return 'ambiguous'
      }
      return null
    }

    // ── Collect importable payment rows ─────────────────────────────────────
    type PaymentRow = {
      facilityId: string
      residentId: string | null
      qbCustomerId: string | null
      paymentDate: string
      amountCents: number
      memo: string | null
      invoiceRef: string | null
      checkNum: string | null
    }

    const incoming: PaymentRow[] = []
    const skippedByType: Record<string, number> = {}
    let unresolvedSections = 0
    let unresolvedPayments = 0
    let ambiguousSections = 0

    for (const section of parsed.sections) {
      let facilityId: string | null = null
      let residentId: string | null = null
      let qbCustomerId: string | null = null

      if (section.kind === 'facility') {
        facilityId = facilityByCode.get(section.fCode!) ?? null
        if (!facilityId) {
          unresolvedSections++
          warn(`No facility for "${section.raw}"`)
        }
      } else {
        const resolved = resolveResident(section)
        if (resolved === 'ambiguous') {
          ambiguousSections++
          unresolvedSections++
          warn(`Ambiguous resident "${section.raw}" — matches multiple residents, skipped`)
        } else if (resolved) {
          facilityId = resolved.facilityId
          residentId = resolved.id
          qbCustomerId = section.qbCustomerId
        } else {
          unresolvedSections++
          warn(`No resident match for "${section.raw}"`)
        }
      }

      for (const txn of section.txns) {
        if (!IMPORTABLE_TYPES.has(txn.type)) {
          skippedByType[txn.type] = (skippedByType[txn.type] ?? 0) + 1
          continue
        }
        if (txn.amountCents <= 0) continue
        if (!facilityId) { unresolvedPayments++; continue }
        incoming.push({
          facilityId,
          residentId,
          qbCustomerId,
          paymentDate: txn.date,
          amountCents: txn.amountCents,
          memo: txn.memo,
          invoiceRef: txn.refNum,
          checkNum: extractCheckNum(txn.memo) ?? txn.refNum,
        })
      }
    }

    // ── Dedup against existing payments (multiset — pop one match per incoming row) ──
    const existingRows = await db.select({
      id: qbPayments.id,
      facilityId: qbPayments.facilityId,
      residentId: qbPayments.residentId,
      paymentDate: qbPayments.paymentDate,
      amountCents: qbPayments.amountCents,
      memo: qbPayments.memo,
    }).from(qbPayments).where(eq(qbPayments.isDemo, false))

    const pool = new Map<string, { id: string; memo: string | null }[]>()
    const keyOf = (fac: string, res: string | null, date: string, amt: number) => `${fac}|${res ?? ''}|${date}|${amt}`
    for (const p of existingRows) {
      const k = keyOf(p.facilityId, p.residentId, p.paymentDate, p.amountCents)
      const list = pool.get(k) ?? []
      list.push({ id: p.id, memo: p.memo })
      pool.set(k, list)
    }
    const popFrom = (k: string) => {
      const list = pool.get(k)
      if (!list || list.length === 0) return null
      return list.pop()!
    }

    const toInsert: PaymentRow[] = []
    const toUpdate: { id: string; set: Record<string, unknown> }[] = []
    let duplicatesSkipped = 0
    let upgraded = 0
    let memoEnriched = 0

    for (const p of incoming) {
      const exact = popFrom(keyOf(p.facilityId, p.residentId, p.paymentDate, p.amountCents))
      if (exact) {
        duplicatesSkipped++
        if (p.memo && !exact.memo) {
          toUpdate.push({ id: exact.id, set: { memo: p.memo } })
          memoEnriched++
        }
        continue
      }
      if (p.residentId) {
        // Same money may exist as an older facility-level row — claim and upgrade it
        const facLevel = popFrom(keyOf(p.facilityId, null, p.paymentDate, p.amountCents))
        if (facLevel) {
          upgraded++
          toUpdate.push({
            id: facLevel.id,
            set: {
              residentId: p.residentId,
              ...(p.qbCustomerId ? { qbCustomerId: p.qbCustomerId } : {}),
              ...(p.memo && !facLevel.memo ? { memo: p.memo } : {}),
            },
          })
          continue
        }
      }
      toInsert.push(p)
    }

    // Batched UPDATE…FROM (VALUES…) — per-row updates over the max:1 pooled
    // connection serialize thousands of round-trips and time out on large files.
    // Memo is only written when the existing row's memo is null (enrichment),
    // so COALESCE(p.memo, v.memo) keeps existing memos; resident_id/qb_customer_id
    // are only provided on upgrades where the existing value is null.
    for (const ch of chunkArr(toUpdate, 200)) {
      const valueRows = ch.map(({ id, set }) => sql`(
        ${id}::uuid,
        ${(set.residentId as string | undefined) ?? null}::uuid,
        ${(set.qbCustomerId as string | undefined) ?? null}::text,
        ${(set.memo as string | undefined) ?? null}::text
      )`)
      await db.execute(sql`
        UPDATE qb_payments p SET
          resident_id = COALESCE(v.resident_id, p.resident_id),
          qb_customer_id = COALESCE(v.qb_customer_id, p.qb_customer_id),
          memo = COALESCE(p.memo, v.memo)
        FROM (VALUES ${sql.join(valueRows, sql`, `)}) AS v(id, resident_id, qb_customer_id, memo)
        WHERE p.id = v.id
      `)
    }

    let created = 0
    for (const ch of chunkArr(toInsert, 100)) {
      await db.insert(qbPayments).values(ch.map((p) => ({
        facilityId: p.facilityId,
        residentId: p.residentId,
        qbCustomerId: p.qbCustomerId,
        paymentDate: p.paymentDate,
        amountCents: p.amountCents,
        memo: p.memo,
        invoiceRef: p.invoiceRef,
        checkNum: p.checkNum,
        recordedVia: 'qb_import',
      })))
      created += ch.length
    }

    revalidateTag('billing', {})

    const totalReceivedCents = incoming.reduce((s, p) => s + p.amountCents, 0)

    return Response.json({
      data: {
        format: parsed.format,
        paymentsCreated: created,
        duplicatesSkipped,
        upgraded,
        memoEnriched,
        unresolvedSections,
        ambiguousSections,
        unresolvedPayments,
        skippedByType,
        totalReceivedCents,
        warnings,
      },
    })
  } catch (err) {
    console.error('qb-import/payments failed:', err)
    return Response.json({ error: 'Import failed — check file format and try again' }, { status: 500 })
  }
}
