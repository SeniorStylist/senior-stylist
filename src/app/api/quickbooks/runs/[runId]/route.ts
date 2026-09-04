// Per-run breakdown for the Sync History card: everything one QuickBooks
// operation changed, split into "In QuickBooks" and "On the site".
//
// Two shapes matter here:
//  • AUTHORIZE FIRST. A by-id route has no facility in its WHERE clause, so the
//    run is fetched thin (id/facility/action), checked, rate-limited, and only
//    then read in full. Doing the DDL bootstrap and the items jsonb read before
//    the guard would hand work (and a timing signal) to any signed-in user.
//  • NO PER-ITEM QUERIES. Ids are resolved with one batched, facility-scoped
//    query per table — six round-trips regardless of run size. With max:1 a
//    per-item loop is the documented starvation failure mode.
//
// Nothing that leaves here is an id: the response is display strings only.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, facilities, qbInvoices, qbSyncRuns } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { getUserFacility, canManageQuickBooksBilling } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { ensureQbSafetySchema } from '@/lib/qb-safety-ddl'
import { buildRunDetail, type DetailContext } from '@/lib/qb-run-detail'
import { formatDateChip } from '@/lib/format'
import { formatDateInTz } from '@/lib/time'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Rows resolved per table. Slicing happens BEFORE the id sets are built. */
const MAX_ROWS = 200

export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params
    if (!UUID_RE.test(runId)) return Response.json({ error: 'Invalid run id' }, { status: 400 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    // Thin fetch → authorize → rate-limit → full read.
    const scoped = await db.query.qbSyncRuns.findFirst({
      where: eq(qbSyncRuns.id, runId),
      columns: { id: true, facilityId: true, action: true },
    })
    if (!scoped) return Response.json({ error: 'Run not found' }, { status: 404 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!isMaster) {
      const fu = await getUserFacility(user.id)
      if (!fu || !canManageQuickBooksBilling(fu.role) || fu.facilityId !== scoped.facilityId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const rl = await checkRateLimit('qbRunDetail', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    await ensureQbSafetySchema()
    const run = await db.query.qbSyncRuns.findFirst({
      where: eq(qbSyncRuns.id, runId),
      columns: {
        id: true,
        facilityId: true,
        action: true,
        startedAt: true,
        finishedAt: true,
        summary: true,
        items: true,
        undoneAt: true,
        undoSummary: true,
      },
    })
    if (!run) return Response.json({ error: 'Run not found' }, { status: 404 })

    const items = (run.items ?? {}) as Record<string, unknown>
    const facilityId = run.facilityId

    // ── Collect the ids worth resolving, capped BEFORE the query ──────────
    const invoiceIds = new Set<string>()
    const bookingIds = new Set<string>()

    const pushInvoices = Array.isArray(items.invoices) ? (items.invoices as Array<Record<string, unknown>>) : []
    for (const inv of pushInvoices.slice(0, MAX_ROWS)) {
      if (typeof inv.localInvoiceId === 'string') invoiceIds.add(inv.localInvoiceId)
      // Only needed when the run predates recorded line labels.
      if (!Array.isArray(inv.bookings) && Array.isArray(inv.bookingIds)) {
        for (const id of (inv.bookingIds as unknown[]).slice(0, MAX_ROWS)) {
          if (typeof id === 'string') bookingIds.add(id)
        }
      }
    }
    for (const id of (Array.isArray(items.insertedInvoiceIds) ? items.insertedInvoiceIds : []).slice(0, MAX_ROWS)) {
      if (typeof id === 'string') invoiceIds.add(id)
    }
    for (const u of (Array.isArray(items.updated) ? items.updated : []).slice(0, MAX_ROWS)) {
      const id = (u as Record<string, unknown>)?.id
      if (typeof id === 'string') invoiceIds.add(id)
    }

    // ── Resolve: one query per table, every one facility-scoped ───────────
    const [facility, invRows, bookRows] = await Promise.all([
      db.query.facilities.findFirst({
        where: eq(facilities.id, facilityId),
        columns: { id: true, name: true, timezone: true },
      }),
      invoiceIds.size
        ? db.query.qbInvoices.findMany({
            where: and(eq(qbInvoices.facilityId, facilityId), inArray(qbInvoices.id, [...invoiceIds])),
            columns: { id: true, invoiceNum: true, status: true, openBalanceCents: true },
          })
        : Promise.resolve([]),
      bookingIds.size
        ? db.query.bookings.findMany({
            where: and(eq(bookings.facilityId, facilityId), inArray(bookings.id, [...bookingIds])),
            columns: {
              id: true,
              startTime: true,
              serviceNames: true,
              rawServiceName: true,
              priceCents: true,
              addonTotalCents: true,
            },
          })
        : Promise.resolve([]),
    ])

    // facilities.timezone is nullable — a null into Intl throws and would 500
    // the whole panel, so default at the boundary like the push engine does.
    const tz = facility?.timezone ?? 'America/New_York'

    const ctx: DetailContext = {
      facilityName: facility?.name ?? 'This facility',
      // Date-only columns ('YYYY-MM-DD') go through formatDateChip; feeding
      // them to an instant formatter re-reads them as UTC midnight and shifts
      // them a day west of GMT.
      formatDate: (d) => (d ? formatDateChip(d, tz) : '—'),
      invoiceById: new Map(
        invRows.map((r) => [
          r.id,
          { invoiceNum: r.invoiceNum, status: r.status, openBalanceCents: r.openBalanceCents },
        ]),
      ),
      bookingById: new Map(
        bookRows.map((b) => [
          b.id,
          {
            dateLabel: formatDateInTz(b.startTime, tz),
            description: b.serviceNames?.join(', ') || b.rawServiceName || 'Service',
            amountCents: (b.priceCents ?? 0) + (b.addonTotalCents ?? 0),
          },
        ]),
      ),
      undone: !!run.undoneAt,
      undoSkipped: Number((run.undoSummary as Record<string, unknown> | null)?.skipped ?? 0) || 0,
    }

    const detail = buildRunDetail({
      id: run.id,
      action: run.action,
      items,
      summary: (run.summary ?? {}) as Record<string, unknown>,
      ctx,
    })

    const undoSummary = (run.undoSummary ?? null) as Record<string, unknown> | null
    const undoNotes = Array.isArray(undoSummary?.notes) ? (undoSummary!.notes as unknown[]).map(String) : []
    const undoErrors = Array.isArray(undoSummary?.errors) ? (undoSummary!.errors as unknown[]).map(String) : []

    return Response.json({
      data: {
        ...detail,
        undo: run.undoneAt
          ? {
              at: run.undoneAt.toISOString(),
              reversed: Number(undoSummary?.reversed ?? 0) || 0,
              // "Undone" only means no ERRORS — it says nothing about rows the
              // undo deliberately left alone, so both numbers are surfaced.
              skipped: ctx.undoSkipped,
              notes: undoNotes,
              errors: undoErrors,
            }
          : undoErrors.length > 0
            ? { at: null, reversed: 0, skipped: 0, notes: undoNotes, errors: undoErrors }
            : null,
      },
    })
  } catch (err) {
    console.error('[quickbooks/runs/[runId]] error:', err)
    return Response.json({ error: 'Could not load this run’s details' }, { status: 500 })
  }
}
