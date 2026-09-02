// P48 — nightly QuickBooks pull for every connected facility.
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
// Realm-level (2026-09-02): facilities are grouped by QuickBooks company and
// each company is pulled ONCE per entity (qb-realm-sync.ts), then applied per
// facility — 100 attached facilities cost one pull, not one hundred. The
// selection is two queries (never a per-facility lookup loop); the per-facility
// apply is DB-only and cheap. No db.transaction spans a QB call.

import { db } from '@/db'
import { facilityUsers, profiles, quickbooksSyncLog } from '@/db/schema'
import { and, eq, gte, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { ensureQbConnectionsSchema } from '@/lib/qb-connection'
import { facilitiesByRealm, syncRealm } from '@/lib/qb-realm-sync'
import { notifyManyUsers } from '@/lib/notify'
import { sendEmail, buildQBSyncFailureEmailHtml } from '@/lib/email'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

/** Facilities applied per night. The pull is per realm, so this bounds only the
 *  DB-side apply work (a handful of queries each on the max:1 pool). */
const MAX_PER_RUN = 120
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
    await ensureQbConnectionsSchema()

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

    // (2) Eligible facilities grouped by realm, oldest-synced first.
    const byRealm = await facilitiesByRealm(suppressed)
    let budget = MAX_PER_RUN
    let eligible = 0
    let succeeded = 0
    let created = 0
    let updated = 0
    let skipped = 0
    let mirrored = 0
    let unrouted = 0
    const failures: { facilityId: string; name: string; message: string }[] = []

    for (const [realmId, facs] of byRealm) {
      if (budget <= 0) break
      const slice = facs.slice(0, budget)
      budget -= slice.length
      eligible += slice.length

      let realmResult
      try {
        realmResult = await syncRealm(realmId, slice.map((f) => f.id))
      } catch (err) {
        // The realm pull itself failed (token dead, Intuit down) — every
        // facility in it counts as failed for the cooldown + notifications.
        const message = (err as Error).message?.slice(0, 300) ?? 'Unknown error'
        console.error(`[cron/qb-invoice-sync] realm ${realmId} threw:`, err)
        for (const f of slice) {
          failures.push({ facilityId: f.id, name: f.name, message })
          logSync(f.id, 'sync_invoices', 'error', null, message)
        }
        continue
      }
      unrouted += realmResult.unroutedInvoices + realmResult.unroutedPayments + realmResult.unroutedCredits

      for (const out of realmResult.facilities) {
        mirrored += out.mirrored
        const inv = out.invoices
        if (out.error && !inv) {
          failures.push({ facilityId: out.facilityId, name: out.name, message: out.error })
          logSync(out.facilityId, 'sync_invoices', 'error', null, out.error)
          continue
        }
        if (!inv) continue
        created += inv.created
        updated += inv.updated
        skipped += inv.skipped

        // cursorAdvanced (not errors.length) is the real success signal: a
        // safety-cap run reports an error but DID progress, while a token
        // failure reports an error and did not.
        if (!inv.cursorAdvanced) {
          const message = inv.errors[0] ?? 'Sync made no progress'
          failures.push({ facilityId: out.facilityId, name: out.name, message })
          logSync(out.facilityId, 'sync_invoices', 'error', null, message)
          continue
        }
        succeeded++
        logSync(
          out.facilityId,
          'sync_invoices',
          'success',
          `${inv.created} created, ${inv.updated} updated, ${inv.skipped} skipped${inv.warnings.length ? ` · ${inv.warnings[0]}` : ''}`,
          inv.errors[0] ?? null,
        )

        const pay = out.payments
        if (pay?.cursorAdvanced) {
          logSync(
            out.facilityId,
            'sync_payments',
            'success',
            `${pay.created} created, ${pay.upgraded} upgraded, ${pay.skipped} skipped, ${pay.creditsUpserted} credits`,
            pay.errors[0] ?? null,
          )
        } else {
          const message = out.error ?? pay?.errors[0] ?? 'Payment sync made no progress'
          failures.push({ facilityId: out.facilityId, name: out.name, message })
          logSync(out.facilityId, 'sync_payments', 'error', null, message)
        }
      }
    }

    const capped = budget <= 0
    if (capped) {
      console.warn(`[cron/qb-invoice-sync] hit MAX_PER_RUN=${MAX_PER_RUN}; the rest rotate in on the next run`)
    }
    if (unrouted > 0) {
      console.warn(`[cron/qb-invoice-sync] ${unrouted} QuickBooks rows matched no attached facility (multi-facility realm) — skipped`)
    }

    // Notify admins of failed facilities — ONE join + ONE batched insert.
    // The 24h cooldown above doubles as notification de-dup, so a dead refresh
    // token pings once rather than every night forever.
    let notified = 0
    if (failures.length > 0) {
      const failedIds = [...new Set(failures.map((f) => f.facilityId))]
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
        realms: byRealm.size,
        eligible,
        attempted: eligible,
        succeeded,
        failed: failures.length,
        suppressed: suppressed.length,
        created,
        updated,
        skipped,
        mirrored,
        unrouted,
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
function logSync(
  facilityId: string,
  action: 'sync_invoices' | 'sync_payments',
  status: 'success' | 'error',
  responseSummary: string | null,
  errorMessage: string | null,
) {
  db.insert(quickbooksSyncLog)
    .values({
      facilityId,
      action,
      status,
      responseSummary,
      errorMessage: errorMessage?.slice(0, 500) ?? null,
    })
    .catch((e) => console.error('[qb-log]', e))
}
