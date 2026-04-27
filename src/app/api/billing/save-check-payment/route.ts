import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  qbPayments,
  qbInvoices,
  qbUnresolvedPayments,
  residents,
  facilities,
  scanCorrections,
} from '@/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { calculateRevShare } from '@/lib/rev-share'
import { NextRequest } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MatchConfidenceEnum = z.enum(['high', 'medium', 'low', 'none'])
const PaymentMethodEnum = z.enum(['check', 'cash', 'ach', 'other'])

const ResidentLineSchema = z.object({
  name: z.string().max(200),
  residentId: z.string().uuid().nullable(),
  amountCents: z.number().int().min(0).max(10_000_000),
  matchConfidence: MatchConfidenceEnum,
})

const ExtractedSchema = z
  .object({
    rawOcrJson: z.record(z.string(), z.unknown()).optional(),
    extractedCheckNum: z.string().max(200).optional(),
    extractedCheckDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    extractedAmountCents: z.number().int().min(0).max(10_000_000).optional(),
    extractedPayerName: z.string().max(500).optional(),
    extractedInvoiceRef: z.string().max(200).optional(),
    extractedInvoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    extractedResidentLines: z
      .array(
        z.object({
          rawName: z.string().max(200),
          amountCents: z.number().int().min(0).max(10_000_000),
          serviceCategory: z.string().max(200).nullable().optional(),
          residentId: z.string().uuid().nullable().optional(),
          matchConfidence: MatchConfidenceEnum.optional(),
        }),
      )
      .max(100)
      .optional(),
    confidenceOverall: z.enum(['high', 'medium', 'low']).optional(),
    unresolvedReason: z.string().max(500).optional(),
  })
  .optional()

const BaseSchema = z.object({
  mode: z.enum(['resolve', 'save_unresolved']),
  facilityId: z.string().uuid(),
  matchedFacilityId: z.string().uuid().nullable().optional(),
  storagePath: z.string().max(500).nullable().optional(),
  paymentMethod: PaymentMethodEnum.default('check'),
  paymentType: z.enum(['ip', 'rfms', 'facility', 'hybrid']).nullable().optional(),
  checkNum: z.string().max(50).nullable().optional(),
  checkDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int().min(0).max(10_000_000),
  memo: z.string().max(2000).nullable().optional(),
  invoiceRef: z.string().max(200).nullable().optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),

  // IP / Hybrid-IP slice — per-resident payment rows
  residentPayments: z.array(ResidentLineSchema).max(100).optional(),

  // RFMS / Hybrid-RFMS slice — facility-level payment with jsonb breakdown
  residentBreakdown: z.array(ResidentLineSchema).max(100).optional(),

  // Cash also received (rolls into its own row, never into the main payment)
  cashAlsoReceivedCents: z.number().int().min(0).max(10_000_000).optional(),
  cashAttributionResidentId: z.string().uuid().nullable().optional(),

  // Invoice matching
  matchedInvoiceIds: z.array(z.string().uuid()).max(20).optional(),
  invoiceMatchConfidence: z.enum(['high', 'partial', 'none']).optional(),

  // Resolve-from-unresolved mode
  unresolvedId: z.string().uuid().optional(),

  // Snapshot for save_unresolved and for posterity on resolved records
  extracted: ExtractedSchema,

  // Field corrections — recorded when user edits Gemini-extracted values before saving
  corrections: z.array(z.object({
    fieldName: z.string().max(50),
    geminiExtracted: z.string().max(2000).nullable(),
    correctedValue: z.string().max(2000),
  })).max(20).optional(),

  // Remittance slip invoice line breakdown
  documentType: z.string().max(50).optional(),
  invoiceLines: z
    .array(
      z.object({
        ref: z.string().max(200).nullable(),
        invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        amountCents: z.number().int().min(0).max(10_000_000),
        confidence: z.enum(['high', 'medium', 'low']),
      }),
    )
    .max(100)
    .optional(),
})

type SaveBody = z.infer<typeof BaseSchema>

function sumLines(lines: { amountCents: number }[] | undefined): number {
  if (!lines) return 0
  return lines.reduce((s, l) => s + (l.amountCents || 0), 0)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    const facilityUser = await getUserFacility(user.id)
    if (!isMaster && (!facilityUser || !canAccessBilling(facilityUser.role))) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const json = await request.json()
    const parse = BaseSchema.safeParse(json)
    if (!parse.success) {
      return Response.json(
        { error: 'Invalid request', details: parse.error.flatten() },
        { status: 400 },
      )
    }
    const body: SaveBody = parse.data

    if (!isMaster && facilityUser?.facilityId !== body.facilityId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // ─── save_unresolved mode ────────────────────────────────────────────────
    if (body.mode === 'save_unresolved') {
      const targetFacilityId = body.matchedFacilityId ?? body.facilityId
      const ext = body.extracted ?? {}
      const [row] = await db
        .insert(qbUnresolvedPayments)
        .values({
          facilityId: targetFacilityId,
          totalAmountCents: body.amountCents ?? 0,
          checkImageUrl: body.storagePath ?? null,
          rawOcrJson: ext.rawOcrJson ?? null,
          extractedCheckNum: ext.extractedCheckNum ?? body.checkNum ?? null,
          extractedCheckDate: ext.extractedCheckDate ?? body.checkDate ?? null,
          extractedAmountCents: ext.extractedAmountCents ?? body.amountCents ?? null,
          extractedPayerName: ext.extractedPayerName ?? null,
          extractedInvoiceRef: ext.extractedInvoiceRef ?? body.invoiceRef ?? null,
          extractedInvoiceDate: ext.extractedInvoiceDate ?? body.invoiceDate ?? null,
          extractedResidentLines:
            ext.extractedResidentLines?.map((l) => ({
              rawName: l.rawName,
              amountCents: l.amountCents,
              serviceCategory: l.serviceCategory ?? null,
              residentId: l.residentId ?? null,
              matchConfidence: l.matchConfidence ?? 'none',
            })) ?? null,
          confidenceOverall: ext.confidenceOverall ?? null,
          unresolvedReason: ext.unresolvedReason ?? 'Saved without matching',
        })
        .returning({ id: qbUnresolvedPayments.id })

      return Response.json({ data: { unresolvedId: row?.id, paymentIds: [] } })
    }

    // ─── resolve mode ────────────────────────────────────────────────────────
    // Validate totals invariant: resident lines + cash must equal amountCents.
    const residentPaymentsTotal = sumLines(body.residentPayments)
    const residentBreakdownTotal = sumLines(body.residentBreakdown)
    const cashTotal = body.cashAlsoReceivedCents ?? 0
    const lineTotal = residentPaymentsTotal + residentBreakdownTotal
    if (lineTotal !== body.amountCents && lineTotal > 0) {
      return Response.json(
        {
          error: `Line items total ${lineTotal} does not match check amount ${body.amountCents}`,
        },
        { status: 400 },
      )
    }

    // Verify every matchedInvoiceId belongs to this facility before touching it
    if (body.matchedInvoiceIds && body.matchedInvoiceIds.length > 0) {
      const invs = await db.query.qbInvoices.findMany({
        where: and(
          inArray(qbInvoices.id, body.matchedInvoiceIds),
          eq(qbInvoices.facilityId, body.facilityId),
        ),
        columns: { id: true },
      })
      if (invs.length !== body.matchedInvoiceIds.length) {
        return Response.json(
          { error: 'One or more matched invoices do not belong to this facility' },
          { status: 400 },
        )
      }
    }

    // Verify every residentId provided belongs to this facility
    const residentIds = [
      ...(body.residentPayments ?? []).map((l) => l.residentId).filter(Boolean),
      ...(body.residentBreakdown ?? []).map((l) => l.residentId).filter(Boolean),
      ...(body.cashAttributionResidentId ? [body.cashAttributionResidentId] : []),
    ] as string[]
    let residentMap = new Map<string, { id: string; qbCustomerId: string | null }>()
    if (residentIds.length > 0) {
      const residentRows = await db.query.residents.findMany({
        where: and(
          inArray(residents.id, residentIds),
          eq(residents.facilityId, body.facilityId),
        ),
        columns: { id: true, qbCustomerId: true },
      })
      if (residentRows.length !== new Set(residentIds).size) {
        return Response.json(
          { error: 'One or more residents do not belong to this facility' },
          { status: 400 },
        )
      }
      residentMap = new Map(residentRows.map((r) => [r.id, r]))
    }

    // Phase 11L — fetch facility rev share config to compute split on every insert
    const facilityRow = await db.query.facilities.findFirst({
      where: eq(facilities.id, body.facilityId),
      columns: { revSharePercentage: true, qbRevShareType: true },
    })
    const revSharePercentage = facilityRow?.revSharePercentage ?? null
    const revShareType = facilityRow?.qbRevShareType ?? null

    // Collect residentIds whose balances we'll recompute after the transaction
    const residentsToRecompute = new Set<string>()

    const paymentIds = await db.transaction(async (tx) => {
      const inserted: string[] = []

      // 1. Per-resident IP rows
      if (body.residentPayments && body.residentPayments.length > 0) {
        for (const line of body.residentPayments) {
          if (!line.residentId) continue
          const resident = residentMap.get(line.residentId)
          const ipRev = calculateRevShare(line.amountCents, revSharePercentage, revShareType)
          const [row] = await tx
            .insert(qbPayments)
            .values({
              facilityId: body.facilityId,
              residentId: line.residentId,
              qbCustomerId: resident?.qbCustomerId ?? null,
              checkNum: body.checkNum ?? null,
              checkDate: body.checkDate ?? null,
              paymentDate: body.paymentDate,
              amountCents: line.amountCents,
              memo: body.memo ?? null,
              invoiceRef: body.invoiceRef ?? null,
              paymentType: body.paymentType ?? null,
              paymentMethod: body.paymentMethod,
              recordedVia: 'check_scan',
              checkImageUrl: body.storagePath ?? null,
              revShareAmountCents: ipRev.facilityShareCents,
              revShareType: ipRev.revShareType,
              seniorStylistAmountCents: ipRev.seniorStylistCents,
            })
            .returning({ id: qbPayments.id })
          if (row?.id) inserted.push(row.id)
          residentsToRecompute.add(line.residentId)
        }
      }

      // 2. Facility-level RFMS / hybrid-RFMS row with jsonb breakdown
      if (body.residentBreakdown && body.residentBreakdown.length > 0) {
        const rfmsTotal = sumLines(body.residentBreakdown)
        const isRemittance =
          body.documentType === 'RFMS_REMITTANCE_SLIP' &&
          body.invoiceLines &&
          body.invoiceLines.length > 0
        const breakdown = isRemittance
          ? {
              type: 'remittance_lines' as const,
              lines: body.invoiceLines!.map((l) => ({
                ref: l.ref,
                invoiceDate: l.invoiceDate,
                amountCents: l.amountCents,
              })),
            }
          : body.residentBreakdown.map((l) => ({
              name: l.name,
              residentId: l.residentId,
              amountCents: l.amountCents,
              matchConfidence: l.matchConfidence,
            }))
        const effectiveMemo =
          body.memo ||
          (isRemittance
            ? (() => {
                const dates = body
                  .invoiceLines!.filter((l) => l.invoiceDate)
                  .map((l) => l.invoiceDate!.slice(5).replace('-', '/'))
                const ck = body.checkNum ? ` — Check #${body.checkNum}` : ''
                return `${body.invoiceLines!.length} invoice${body.invoiceLines!.length === 1 ? '' : 's'}: ${dates.join(', ')}${ck}`
              })()
            : null)
        const rfmsRev = calculateRevShare(rfmsTotal, revSharePercentage, revShareType)
        const [row] = await tx
          .insert(qbPayments)
          .values({
            facilityId: body.facilityId,
            residentId: null,
            qbCustomerId: null,
            checkNum: body.checkNum ?? null,
            checkDate: body.checkDate ?? null,
            paymentDate: body.paymentDate,
            amountCents: rfmsTotal,
            memo: effectiveMemo ?? null,
            invoiceRef: body.invoiceRef ?? null,
            paymentType: body.paymentType ?? null,
            paymentMethod: body.paymentMethod,
            recordedVia: 'check_scan',
            checkImageUrl: body.storagePath ?? null,
            residentBreakdown: breakdown,
            revShareAmountCents: rfmsRev.facilityShareCents,
            revShareType: rfmsRev.revShareType,
            seniorStylistAmountCents: rfmsRev.seniorStylistCents,
          })
          .returning({ id: qbPayments.id })
        if (row?.id) inserted.push(row.id)
        // Track any matched residents so their balances can be recomputed
        for (const l of body.residentBreakdown) {
          if (l.residentId) residentsToRecompute.add(l.residentId)
        }
      }

      // 3. Lump facility check with no breakdown — only when neither slice above
      //    produced a row AND there is an amount to record.
      if (
        (!body.residentPayments || body.residentPayments.length === 0) &&
        (!body.residentBreakdown || body.residentBreakdown.length === 0) &&
        body.amountCents > 0
      ) {
        const isRemittanceLump =
          body.documentType === 'RFMS_REMITTANCE_SLIP' &&
          body.invoiceLines &&
          body.invoiceLines.length > 0
        const lumpBreakdown = isRemittanceLump
          ? {
              type: 'remittance_lines' as const,
              lines: body.invoiceLines!.map((l) => ({
                ref: l.ref,
                invoiceDate: l.invoiceDate,
                amountCents: l.amountCents,
              })),
            }
          : undefined
        const lumpMemo =
          body.memo ||
          (isRemittanceLump
            ? (() => {
                const dates = body
                  .invoiceLines!.filter((l) => l.invoiceDate)
                  .map((l) => l.invoiceDate!.slice(5).replace('-', '/'))
                const ck = body.checkNum ? ` — Check #${body.checkNum}` : ''
                return `${body.invoiceLines!.length} invoice${body.invoiceLines!.length === 1 ? '' : 's'}: ${dates.join(', ')}${ck}`
              })()
            : null)
        const lumpRev = calculateRevShare(body.amountCents, revSharePercentage, revShareType)
        const [row] = await tx
          .insert(qbPayments)
          .values({
            facilityId: body.facilityId,
            residentId: null,
            qbCustomerId: null,
            checkNum: body.checkNum ?? null,
            checkDate: body.checkDate ?? null,
            paymentDate: body.paymentDate,
            amountCents: body.amountCents,
            memo: lumpMemo ?? null,
            invoiceRef: body.invoiceRef ?? null,
            paymentType: body.paymentType ?? null,
            paymentMethod: body.paymentMethod,
            recordedVia: 'check_scan',
            checkImageUrl: body.storagePath ?? null,
            residentBreakdown: lumpBreakdown,
            revShareAmountCents: lumpRev.facilityShareCents,
            revShareType: lumpRev.revShareType,
            seniorStylistAmountCents: lumpRev.seniorStylistCents,
          })
          .returning({ id: qbPayments.id })
        if (row?.id) inserted.push(row.id)
      }

      // 4. Cash-also-received row (separate payment method)
      if (cashTotal > 0) {
        const attributionId = body.cashAttributionResidentId ?? null
        const cashResident = attributionId ? residentMap.get(attributionId) : null
        const cashRev = calculateRevShare(cashTotal, revSharePercentage, revShareType)
        const [row] = await tx
          .insert(qbPayments)
          .values({
            facilityId: body.facilityId,
            residentId: attributionId,
            qbCustomerId: cashResident?.qbCustomerId ?? null,
            checkNum: null,
            checkDate: null,
            paymentDate: body.paymentDate,
            amountCents: cashTotal,
            memo: body.memo ?? null,
            invoiceRef: body.invoiceRef ?? null,
            paymentType: body.paymentType ?? null,
            paymentMethod: 'cash',
            recordedVia: 'check_scan',
            checkImageUrl: body.storagePath ?? null,
            revShareAmountCents: cashRev.facilityShareCents,
            revShareType: cashRev.revShareType,
            seniorStylistAmountCents: cashRev.seniorStylistCents,
          })
          .returning({ id: qbPayments.id })
        if (row?.id) inserted.push(row.id)
        if (attributionId) residentsToRecompute.add(attributionId)
      }

      // 5. Decrement matched invoices (exact-match only)
      if (
        body.invoiceMatchConfidence === 'high' &&
        body.matchedInvoiceIds &&
        body.matchedInvoiceIds.length > 0
      ) {
        await tx
          .update(qbInvoices)
          .set({ openBalanceCents: 0, status: 'paid' })
          .where(
            and(
              inArray(qbInvoices.id, body.matchedInvoiceIds),
              eq(qbInvoices.facilityId, body.facilityId),
            ),
          )
      }

      // 6. Recompute facility balance from qb_invoices
      await tx.execute(sql`
        UPDATE facilities
        SET qb_outstanding_balance_cents = COALESCE((
          SELECT SUM(open_balance_cents) FROM qb_invoices WHERE facility_id = ${body.facilityId}
        ), 0)
        WHERE id = ${body.facilityId}
      `)

      // 7. Recompute affected resident balances
      for (const residentId of residentsToRecompute) {
        await tx.execute(sql`
          UPDATE residents
          SET qb_outstanding_balance_cents = COALESCE((
            SELECT SUM(open_balance_cents) FROM qb_invoices WHERE resident_id = ${residentId}
          ), 0)
          WHERE id = ${residentId}
        `)
      }

      // 8. Resolve the unresolved record if we were fixing one
      if (body.unresolvedId) {
        await tx
          .update(qbUnresolvedPayments)
          .set({ resolvedAt: new Date(), resolvedBy: user.id })
          .where(eq(qbUnresolvedPayments.id, body.unresolvedId))
      }

      // 9. Record field corrections for few-shot learning
      if (body.corrections && body.corrections.length > 0) {
        await tx.insert(scanCorrections).values(
          body.corrections.map((c) => ({
            facilityId: body.matchedFacilityId ?? body.facilityId,
            documentType: body.documentType ?? 'UNKNOWN',
            fieldName: c.fieldName,
            geminiExtracted: c.geminiExtracted ?? null,
            correctedValue: c.correctedValue,
            createdBy: user.id,
          })),
        )
      }

      return inserted
    })

    // Return the latest facility balance (single read outside the transaction)
    const [fac] = await db
      .select({ qbOutstandingBalanceCents: facilities.qbOutstandingBalanceCents })
      .from(facilities)
      .where(eq(facilities.id, body.facilityId))

    return Response.json({
      data: {
        paymentIds,
        updatedBalanceCents: fac?.qbOutstandingBalanceCents ?? 0,
      },
    })
  } catch (err) {
    console.error('[save-check-payment] unexpected error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
