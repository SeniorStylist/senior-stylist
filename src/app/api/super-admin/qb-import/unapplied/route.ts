// QB "Customer Balance Detail" CSV import — Step 5. Extracts every payment/credit
// memo QB received but never applied to an invoice (the gap between gross open
// invoices and QB's net A/R), attributed to facility + resident. Snapshot semantics:
// the table is wiped and replaced on every import. Master admin only.

import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, qbUnappliedCredits } from '@/db/schema'
import { eq, gt } from 'drizzle-orm'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { parseCustomerBalanceDetailCsv, chunkArr } from '@/lib/imports/qb-csv'
import { ensureUnappliedSchema } from '@/lib/unapplied-ddl'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const MAX_WARNINGS = 200

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

// Identity key for matching incoming CSV rows against credits already applied on
// the site — QB still lists those as unapplied, so without this they'd reappear
// as fresh open credits and double-count against the decremented invoices.
function creditKey(r: { facilityId: string; qbCustomerId: string; txnDate: string; num: string | null; amountCents: number }): string {
  return `${r.facilityId}|${r.qbCustomerId}|${r.txnDate}|${r.num ?? ''}|${r.amountCents}`
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

    const { credits, skipped } = parseCustomerBalanceDetailCsv(await file.text())
    if (credits.length === 0) {
      return Response.json({
        error: 'No unapplied credits found — is this the QB "Customer Balance Detail" export (All Dates)? If every payment is applied, there is nothing to import.',
      }, { status: 400 })
    }

    await ensureUnappliedSchema()

    const warnings: string[] = []
    const warn = (msg: string) => { if (warnings.length < MAX_WARNINGS) warnings.push(msg) }

    // ── Lookup maps (same conventions as the invoices/payments importers) ───
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
      qbCustomerId: residents.qbCustomerId,
    }).from(residents).where(eq(residents.active, true))
    const residentByQbId = new Map<string, string>()
    // facilityId|post-colon suffix → resident, for sub-sections whose constructed
    // "FXXX:Name" key doesn't exactly match the stored qb_customer_id
    const residentBySuffix = new Map<string, string[]>()
    for (const r of residentRows) {
      if (!r.qbCustomerId) continue
      residentByQbId.set(r.qbCustomerId, r.id)
      const colonIdx = r.qbCustomerId.lastIndexOf(':')
      if (colonIdx >= 0) {
        const key = `${r.facilityId}|${normalizeKey(r.qbCustomerId.slice(colonIdx + 1))}`
        const list = residentBySuffix.get(key) ?? []
        list.push(r.id)
        residentBySuffix.set(key, list)
      }
    }

    let residentMatched = 0
    let residentUnmatched = 0
    let facilityLevel = 0
    let facilityMisses = 0
    let totalUnappliedCents = 0

    type InsertRow = typeof qbUnappliedCredits.$inferInsert
    const inserts: InsertRow[] = []
    for (const c of credits) {
      const facilityId = facilityByCode.get(c.fCode)
      if (!facilityId) {
        facilityMisses++
        warn(`${c.txnDate} ${c.txnType}${c.num ? ` #${c.num}` : ''}: no facility for "${c.fCode}"`)
        continue
      }
      let residentId: string | null = null
      if (c.subCustomer) {
        const qbKey = `${c.fCode}:${c.subCustomer}`
        residentId = residentByQbId.get(qbKey) ?? null
        if (!residentId) {
          const bySuffix = residentBySuffix.get(`${facilityId}|${normalizeKey(c.subCustomer)}`) ?? []
          if (bySuffix.length === 1) residentId = bySuffix[0]
        }
        if (residentId) residentMatched++
        else { residentUnmatched++; warn(`${c.txnDate} ${c.txnType}: resident not found for "${c.fCode}:${c.subCustomer}"`) }
      } else {
        facilityLevel++
      }
      totalUnappliedCents += c.openBalanceCents
      inserts.push({
        facilityId,
        residentId,
        qbCustomerId: c.subCustomer ? `${c.fCode}:${c.subCustomer}` : c.fCode,
        txnType: c.txnType,
        txnDate: c.txnDate,
        num: c.num,
        amountCents: c.amountCents,
        openBalanceCents: c.openBalanceCents,
      })
    }

    // Snapshot semantics with one exception: credits applied ON THE SITE survive
    // re-imports (QB still exports them as unapplied until mirrored in QB, and
    // recreating them as open would double-count against the decremented invoices).
    let preservedApplied = 0
    await db.transaction(async (tx) => {
      const appliedRows = await tx
        .select({
          facilityId: qbUnappliedCredits.facilityId,
          qbCustomerId: qbUnappliedCredits.qbCustomerId,
          txnDate: qbUnappliedCredits.txnDate,
          num: qbUnappliedCredits.num,
          amountCents: qbUnappliedCredits.amountCents,
        })
        .from(qbUnappliedCredits)
        .where(gt(qbUnappliedCredits.appliedCents, 0))
      const appliedKeys = new Set(appliedRows.map(creditKey))

      await tx.delete(qbUnappliedCredits).where(eq(qbUnappliedCredits.appliedCents, 0))

      const fresh = inserts.filter((r) => {
        const dupe = appliedKeys.has(creditKey(r as Parameters<typeof creditKey>[0]))
        if (dupe) preservedApplied++
        return !dupe
      })
      for (const ch of chunkArr(fresh, 200)) {
        await tx.insert(qbUnappliedCredits).values(ch)
      }
    })

    revalidateTag('billing', {})
    return Response.json({
      data: {
        imported: inserts.length - preservedApplied,
        preservedApplied,
        residentMatched,
        residentUnmatched,
        facilityLevel,
        skippedRows: skipped + facilityMisses,
        totalUnappliedCents,
        warnings,
      },
    })
  } catch (err) {
    console.error('qb-import/unapplied failed:', err)
    return Response.json({ error: 'Import failed — check file format and try again' }, { status: 500 })
  }
}
