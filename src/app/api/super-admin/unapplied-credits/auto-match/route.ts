// Auto-match unapplied QB credits to open invoices by amount. A credit matches
// when its remaining balance equals (a) a single open invoice for the same
// resident ("exact"), or (b) the resident's oldest open invoices summed
// oldest-first ("fifo" — e.g. 12 monthly payments covering 12 monthly invoices).
// `apply: false` previews; `apply: true` re-derives matches on fresh data inside
// one transaction and applies them. Site-side only — mirror in QuickBooks.
// Master admin only.

import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, qbInvoices, qbUnappliedCredits, residents } from '@/db/schema'
import { and, asc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ensureUnappliedSchema } from '@/lib/unapplied-ddl'
import { applyCreditToInvoices, recomputeFacilityBalances } from '@/lib/unapplied-apply'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const schema = z.object({
  facilityId: z.string().uuid().optional(),
  creditIds: z.array(z.string().uuid()).max(500).optional(),
  apply: z.boolean(),
})

interface CreditRow {
  id: string
  facilityId: string
  facilityName: string
  facilityCode: string | null
  residentId: string | null
  residentName: string | null
  txnDate: string
  num: string | null
  openBalanceCents: number
  appliedCents: number
  appliedDetail: Array<{ invoiceId: string; invoiceNum: string; invoiceDate: string; amountCents: number }> | null
}

interface InvoiceRow {
  id: string
  residentId: string | null
  invoiceNum: string
  invoiceDate: string
  openBalanceCents: number
}

interface MatchProposal {
  creditId: string
  facilityId: string
  facilityName: string
  facilityCode: string | null
  residentName: string | null
  txnDate: string
  num: string | null
  remainingCents: number
  confidence: 'exact' | 'fifo'
  invoices: { id: string; invoiceNum: string; invoiceDate: string; openBalanceCents: number }[]
}

function computeMatches(credits: CreditRow[], invoices: InvoiceRow[]): MatchProposal[] {
  const poolByResident = new Map<string, InvoiceRow[]>()
  for (const inv of invoices) {
    if (!inv.residentId || inv.openBalanceCents <= 0) continue
    const list = poolByResident.get(inv.residentId) ?? []
    list.push(inv)
    poolByResident.set(inv.residentId, list)
  }
  for (const list of poolByResident.values()) {
    list.sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate))
  }

  const claimed = new Set<string>()
  const proposals: MatchProposal[] = []

  // Oldest credits first so multi-credit residents allocate in payment order
  const ordered = [...credits].sort((a, b) => a.txnDate.localeCompare(b.txnDate))
  for (const c of ordered) {
    if (!c.residentId) continue
    const remaining = c.openBalanceCents - c.appliedCents
    if (remaining <= 0) continue
    const pool = (poolByResident.get(c.residentId) ?? []).filter((i) => !claimed.has(i.id))
    if (pool.length === 0) continue

    // (a) exact single — oldest invoice whose open balance equals the credit
    const exact = pool.find((i) => i.openBalanceCents === remaining)
    let matched: InvoiceRow[] | null = null
    let confidence: 'exact' | 'fifo' = 'exact'
    if (exact) {
      matched = [exact]
    } else {
      // (b) FIFO-exact — cumulative sum of the oldest invoices hits the credit exactly
      let cum = 0
      const taken: InvoiceRow[] = []
      for (const inv of pool) {
        cum += inv.openBalanceCents
        taken.push(inv)
        if (cum === remaining) { matched = taken; confidence = 'fifo'; break }
        if (cum > remaining) break
      }
    }

    if (!matched) continue
    for (const inv of matched) claimed.add(inv.id)
    proposals.push({
      creditId: c.id,
      facilityId: c.facilityId,
      facilityName: c.facilityName,
      facilityCode: c.facilityCode,
      residentName: c.residentName,
      txnDate: c.txnDate,
      num: c.num,
      remainingCents: remaining,
      confidence,
      invoices: matched.map((i) => ({
        id: i.id,
        invoiceNum: i.invoiceNum,
        invoiceDate: i.invoiceDate,
        openBalanceCents: i.openBalanceCents,
      })),
    })
  }
  return proposals
}

async function loadData(facilityId?: string, creditIds?: string[]) {
  const creditWhere = [
    gt(sql`${qbUnappliedCredits.openBalanceCents} - ${qbUnappliedCredits.appliedCents}`, 0),
    isNotNull(qbUnappliedCredits.residentId),
  ]
  if (facilityId) creditWhere.push(eq(qbUnappliedCredits.facilityId, facilityId))
  if (creditIds && creditIds.length > 0) creditWhere.push(inArray(qbUnappliedCredits.id, creditIds))

  const credits: CreditRow[] = await db
    .select({
      id: qbUnappliedCredits.id,
      facilityId: qbUnappliedCredits.facilityId,
      facilityName: facilities.name,
      facilityCode: facilities.facilityCode,
      residentId: qbUnappliedCredits.residentId,
      residentName: residents.name,
      txnDate: qbUnappliedCredits.txnDate,
      num: qbUnappliedCredits.num,
      openBalanceCents: qbUnappliedCredits.openBalanceCents,
      appliedCents: qbUnappliedCredits.appliedCents,
      appliedDetail: qbUnappliedCredits.appliedDetail,
    })
    .from(qbUnappliedCredits)
    .innerJoin(facilities, eq(qbUnappliedCredits.facilityId, facilities.id))
    .leftJoin(residents, eq(qbUnappliedCredits.residentId, residents.id))
    .where(and(...creditWhere))
    .orderBy(asc(qbUnappliedCredits.txnDate))

  const residentIds = Array.from(new Set(credits.map((c) => c.residentId).filter((x): x is string => !!x)))
  const invoices: InvoiceRow[] = residentIds.length === 0 ? [] : await db
    .select({
      id: qbInvoices.id,
      residentId: qbInvoices.residentId,
      invoiceNum: qbInvoices.invoiceNum,
      invoiceDate: qbInvoices.invoiceDate,
      openBalanceCents: qbInvoices.openBalanceCents,
    })
    .from(qbInvoices)
    .where(and(
      inArray(qbInvoices.residentId, residentIds),
      gt(qbInvoices.openBalanceCents, 0),
      eq(qbInvoices.isDemo, false),
    ))

  return { credits, invoices }
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

    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    await ensureUnappliedSchema()

    const { credits, invoices } = await loadData(parsed.data.facilityId, parsed.data.creditIds)
    const proposals = computeMatches(credits, invoices)

    if (!parsed.data.apply) {
      return Response.json({
        data: {
          proposals,
          totalCents: proposals.reduce((s, p) => s + p.remainingCents, 0),
          unmatchedCredits: credits.length - proposals.length,
        },
      })
    }

    // Apply path: matches were just re-derived on fresh data; run all of them
    // in one transaction so a single failure rolls everything back.
    const creditById = new Map(credits.map((c) => [c.id, c]))
    let appliedTotal = 0
    await db.transaction(async (tx) => {
      for (const p of proposals) {
        const credit = creditById.get(p.creditId)!
        const r = await applyCreditToInvoices(tx, credit, p.invoices.map((i) => i.id), user.id)
        appliedTotal += r.appliedCents
      }
      await recomputeFacilityBalances(tx, proposals.map((p) => p.facilityId))
    })

    revalidateTag('billing', {})
    return Response.json({
      data: {
        appliedCount: proposals.length,
        appliedTotalCents: appliedTotal,
        proposals,
      },
    })
  } catch (err) {
    console.error('[unapplied-credits/auto-match] error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
