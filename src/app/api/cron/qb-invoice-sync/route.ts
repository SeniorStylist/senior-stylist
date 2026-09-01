// P48 — nightly QuickBooks invoice pull for every connected facility.
//
// Ships DORMANT: until Intuit grants production approval and
// QB_INVOICE_SYNC_ENABLED is set to 'true' in Vercel, this returns a 200 no-op
// (not a 503 — a cron that 503s every night for months just fills the Vercel
// log with false failures).
//
// Scheduling: `0 5 * * *`, deliberately one hour BEFORE autopay-sweep (0 6).
// The sweep charges residents off residents.qb_outstanding_balance_cents,
// which is the exact column syncQBInvoices recomputes — syncing first means
// autopay bills fresh balances instead of up-to-24h-stale ones.
//
// max:1 pool: the SELECTION is two queries (never a per-facility lookup loop),
// but the WORK is inherently per-facility — each sync is a paginated HTTP pull
// from Intuit. That follows the monthly-reports precedent: a hard per-run cap,
// maxDuration 300, and a try/catch INSIDE the loop so one bad facility can't
// abort the run. syncQBInvoices holds no db.transaction, so it is safe to call
// in a loop across multi-second network calls.

import { db } from '@/db'
import { facilities, facilityUsers, profiles, quickbooksSyncLog } from '@/db/schema'
import { and, eq, gte, inArray, isNotNull, notInArray, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { syncQBInvoices } from '@/lib/qb-invoice-sync'
import { syncQBPayments } from '@/lib/qb-payment-sync'
import { notifyManyUsers } from '@/lib/notify'
import { sendEmail, buildQBSyncFailureEmailHtml } from '@/lib/email'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

/** 20 × (invoice pull + payment/credit pull + upserts) fits inside
 *  maxDuration 300 — lowered from 25 when the payment pull was chained in. */
const MAX_PER_RUN = 20
/** A facility that failed recently is skipped so one dead OAuth connection
 *  can't starve the staleness rotation — and admins aren't re-pinged nightly. */
const RETRY_COOLDOWN_HOURS = 24

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Dormant until Intuit production approval. 200, not 503 — see header note.
  if (process.env.QB_INVOICE_SYNC_ENABLED !== 'true') {
    return Response.json({
      data: { attempted: 0, reason: 'QB_INVOICE_SYNC_ENABLED not set — invoice sync is awaiting Intuit production approval' },
    })
  }

  try {
    // (1) Facilities whose last nightly attempt failed inside the cooldown.
    const cooldownStart = new Date(Date.now() - RETRY_COOLDOWN_HOURS * 60 * 60 * 1000)
    const recentlyFailed = await db
      .selectDistinct({ facilityId: quickbooksSyncLog.facilityId })
      .from(quickbooksSyncLog)
      .where(
        and(
          // Both nightly actions count toward the cooldown — a persistently
          // failing PAYMENT pull must suppress the facility (and its nightly
          // notifications) exactly like a failing invoice pull.
          inArray(quickbooksSyncLog.action, ['sync_invoices', 'sync_payments']),
          eq(quickbooksSyncLog.status, 'error'),
          gte(quickbooksSyncLog.createdAt, cooldownStart),
        ),
      )
    const suppressed = recentlyFailed.map((r) => r.facilityId).filter((id): id is string => !!id)

    // (2) Eligible facilities, oldest-synced first. Ordering by staleness
    // self-rotates the cap with no extra cursor column, because the engine
    // stamps qbInvoicesLastSyncedAt itself on success.
    const eligible = await db.query.facilities.findMany({
      where: and(
        eq(facilities.active, true),
        eq(facilities.isDemo, false),
        isNotNull(facilities.qbRealmId),
        isNotNull(facilities.qbAccessToken),
        isNotNull(facilities.qbRefreshToken),
        ...(suppressed.length > 0 ? [notInArray(facilities.id, suppressed)] : []),
      ),
      columns: { id: true, name: true, facilityCode: true },
      orderBy: sql`qb_invoices_last_synced_at ASC NULLS FIRST`,
      limit: MAX_PER_RUN,
    })

    let succeeded = 0
    let created = 0
    let updated = 0
    let skipped = 0
    const failures: { facilityId: string; name: string; message: string }[] = []

    for (const f of eligible) {
      try {
        // Never fullSync from the cron — it ignores the cursor and pulls up to
        // 5000 invoices per facility. Full re-syncs stay operator-initiated.
        const out = await syncQBInvoices(f.id, {})
        created += out.created
        updated += out.updated
        skipped += out.skipped

        // cursorAdvanced (not errors.length) is the real success signal: a
        // safety-cap run reports an error but DID progress, while a token
        // failure reports an error and did not.
        if (out.cursorAdvanced) {
          succeeded++
          logSync(
            f.id,
            'success',
            `${out.created} created, ${out.updated} updated, ${out.skipped} skipped${out.warnings.length ? ` · ${out.warnings[0]}` : ''}`,
            out.errors[0] ?? null,
          )

          // Chain the payment/credit pull AFTER a successful invoice pull so
          // the 06:00 autopay sweep sees fresh applied-payment data too. Its
          // own cursorAdvanced contract applies; a payment failure marks the
          // facility failed (cooldown) but never blocks other facilities.
          try {
            const pay = await syncQBPayments(f.id, {})
            if (pay.cursorAdvanced) {
              logPaymentSync(f.id, 'success', `${pay.created} created, ${pay.upgraded} upgraded, ${pay.skipped} skipped, ${pay.creditsUpserted} credits`, pay.errors[0] ?? null)
            } else {
              const message = pay.errors[0] ?? 'Payment sync made no progress'
              failures.push({ facilityId: f.id, name: f.name, message })
              logPaymentSync(f.id, 'error', null, message)
            }
          } catch (err) {
            const message = (err as Error).message?.slice(0, 300) ?? 'Unknown error'
            console.error(`[cron/qb-invoice-sync] payment sync for ${f.id} threw:`, err)
            failures.push({ facilityId: f.id, name: f.name, message })
            logPaymentSync(f.id, 'error', null, message)
          }
        } else {
          const message = out.errors[0] ?? 'Sync made no progress'
          failures.push({ facilityId: f.id, name: f.name, message })
          logSync(f.id, 'error', null, message)
        }
      } catch (err) {
        const message = (err as Error).message?.slice(0, 300) ?? 'Unknown error'
        console.error(`[cron/qb-invoice-sync] facility ${f.id} threw:`, err)
        failures.push({ facilityId: f.id, name: f.name, message })
        logSync(f.id, 'error', null, message)
      }
    }

    const capped = eligible.length === MAX_PER_RUN
    if (capped) {
      console.warn(`[cron/qb-invoice-sync] hit MAX_PER_RUN=${MAX_PER_RUN}; the rest rotate in on the next run`)
    }

    // Notify admins of failed facilities — ONE join + ONE batched insert.
    // The 24h cooldown above doubles as notification de-dup, so a dead refresh
    // token pings once rather than every night forever.
    let notified = 0
    if (failures.length > 0) {
      const failedIds = failures.map((f) => f.facilityId)
      const admins = await db
        .select({ userId: facilityUsers.userId, facilityId: facilityUsers.facilityId })
        .from(facilityUsers)
        .innerJoin(profiles, eq(profiles.id, facilityUsers.userId))
        .where(and(inArray(facilityUsers.facilityId, failedIds), eq(facilityUsers.role, 'admin')))
      await notifyManyUsers(
        admins.map((a) => ({
          userId: a.userId,
          payload: {
            type: 'qb_sync_failed' as const,
            title: 'QuickBooks sync needs attention',
            body: "Last night's QuickBooks invoice sync didn't go through — your QuickBooks connection may need to be reconnected in Settings → Billing.",
            url: '/settings?section=billing',
            facilityId: a.facilityId,
          },
        })),
      )
      notified = admins.length
    }

    // One awaited owner summary on failures — in a cron the send IS the work.
    let emailSent = false
    const owner = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (failures.length > 0 && owner) {
      emailSent = await sendEmail({
        to: owner,
        subject: `QuickBooks sync failed for ${failures.length} facilit${failures.length === 1 ? 'y' : 'ies'}`,
        html: buildQBSyncFailureEmailHtml({ failures }),
      })
    }

    // Once at the end — revalidateTag is process-global, so per-facility calls
    // would just be redundant no-ops.
    if (succeeded > 0) {
      revalidateTag('billing', {})
      revalidateTag('facilities', {})
    }

    return Response.json({
      data: {
        eligible: eligible.length,
        attempted: eligible.length,
        succeeded,
        failed: failures.length,
        suppressed: suppressed.length,
        created,
        updated,
        skipped,
        capped,
        notified,
        emailSent,
      },
    })
  } catch (err) {
    console.error('[cron/qb-invoice-sync] run failed:', err)
    return Response.json({ error: 'Internal — logged' }, { status: 500 })
  }
}

/** Fire-and-forget audit row (never awaited — the repo's qb-log convention).
 *  This is also what the master QB dashboard reads to show "Needs reconnect". */
function logSync(facilityId: string, status: 'success' | 'error', responseSummary: string | null, errorMessage: string | null) {
  db.insert(quickbooksSyncLog)
    .values({
      facilityId,
      action: 'sync_invoices',
      status,
      responseSummary,
      errorMessage: errorMessage?.slice(0, 500) ?? null,
    })
    .catch((e) => console.error('[qb-log]', e))
}

function logPaymentSync(facilityId: string, status: 'success' | 'error', responseSummary: string | null, errorMessage: string | null) {
  db.insert(quickbooksSyncLog)
    .values({
      facilityId,
      action: 'sync_payments',
      status,
      responseSummary,
      errorMessage: errorMessage?.slice(0, 500) ?? null,
    })
    .catch((e) => console.error('[qb-log]', e))
}
