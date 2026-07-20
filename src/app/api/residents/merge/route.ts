import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { residents, bookings, residentMergeLog } from '@/db/schema'
import { eq, and, count } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { ensureResidentMergeSchema } from '@/lib/resident-merge-ddl'
import { z } from 'zod'

const mergeSchema = z.object({
  keepId: z.string().uuid(),
  mergeId: z.string().uuid(),
  finalName: z.string().min(1).max(200),
  finalRoom: z.string().max(50).nullable(),
})

// P36 — the merge is a FULL data sweep, not just a bookings move. Every table
// with a resident FK is re-pointed to the survivor inside ONE transaction
// (set-based statements only, ZERO Stripe/network calls), POA/billing/tip
// fields are inherited copy-if-null (facility-merge pattern), and an audit row
// is written. Stripe rule: cards move ONLY when the survivor has no Stripe
// customer (the loser's customer is inherited with them, keeping
// collectForResident's customer+PM pairing valid); when BOTH residents have
// Stripe customers, the loser's cards stay behind (cardsLeftBehind in the
// response — never re-point a card at a mismatched customer, never call Stripe
// here). The response stays a strict superset of { data: { bookingsMoved } }
// (P34 client re-chain contract) and the 409 stale_pair path is unchanged.

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const isMasterAdmin = superAdminEmail && user.email === superAdminEmail
    // Bookkeepers may merge duplicate residents (they create them via OCR
    // log-sheet scanning); all other resident mutations stay admin-only.
    const canMerge = facilityUser.role === 'admin' || facilityUser.role === 'bookkeeper'
    if (!isMasterAdmin && !canMerge) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { facilityId } = facilityUser

    const body = await request.json()
    const parsed = mergeSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { keepId, mergeId, finalName, finalRoom } = parsed.data

    if (keepId === mergeId) {
      return Response.json({ error: 'keepId and mergeId must be different' }, { status: 422 })
    }

    await ensureResidentMergeSchema()

    // P34 — verify both residents BEFORE the transaction so a stale pair
    // (a resident already merged away in a previous step / another tab)
    // returns a clean machine-readable 409 instead of a generic 500. The
    // client uses code 'stale_pair' to drop the card and resync the list.
    // P36 — fetch the FULL rows here: the copy-if-null reconciliation and the
    // Stripe case decision are computed from these snapshots.
    const [keepRows, mergeRows] = await Promise.all([
      db.query.residents.findMany({
        where: and(eq(residents.id, keepId), eq(residents.facilityId, facilityId), eq(residents.active, true)),
      }),
      db.query.residents.findMany({
        where: and(eq(residents.id, mergeId), eq(residents.facilityId, facilityId), eq(residents.active, true)),
      }),
    ])
    const keep = keepRows[0]
    const merge = mergeRows[0]
    if (!keep || !merge) {
      return Response.json(
        {
          error: 'This pair is out of date — one of these residents was already merged.',
          code: 'stale_pair',
        },
        { status: 409 },
      )
    }

    // Stripe case decision (no Stripe API calls — DB-only):
    const inheritStripe = !keep.stripeCustomerId && !!merge.stripeCustomerId

    // Copy-if-null field reconciliation (survivor wins on conflict; the loser's
    // conflicting POA block is REPORTED, never silently applied).
    const inheritable: Array<[string, unknown]> = []
    const consider = (field: string, keepVal: unknown, mergeVal: unknown) => {
      if ((keepVal == null || keepVal === '') && mergeVal != null && mergeVal !== '') {
        inheritable.push([field, mergeVal])
      }
    }
    consider('phone', keep.phone, merge.phone)
    consider('notes', keep.notes, merge.notes)
    consider('poaName', keep.poaName, merge.poaName)
    consider('poaEmail', keep.poaEmail, merge.poaEmail)
    consider('poaPhone', keep.poaPhone, merge.poaPhone)
    consider('poaAddress', keep.poaAddress, merge.poaAddress)
    consider('poaCity', keep.poaCity, merge.poaCity)
    consider('poaPaymentMethod', keep.poaPaymentMethod, merge.poaPaymentMethod)
    consider('qbCustomerId', keep.qbCustomerId, merge.qbCustomerId)
    consider('dateOfBirth', keep.dateOfBirth, merge.dateOfBirth)
    consider('photoPath', keep.photoPath, merge.photoPath)
    consider('residentPaymentType', keep.residentPaymentType, merge.residentPaymentType)
    consider('defaultServiceId', keep.defaultServiceId, merge.defaultServiceId)
    // Tip preference is an atomic pair — copy both only when the survivor has neither.
    if (keep.defaultTipType == null && merge.defaultTipType != null) {
      inheritable.push(['defaultTipType', merge.defaultTipType])
      inheritable.push(['defaultTipValue', merge.defaultTipValue])
    }
    // portalToken is unique — the loser's is NULLed inside the tx BEFORE the
    // survivor inherits it.
    const inheritPortalToken = !keep.portalToken && !!merge.portalToken

    const conflicts: Record<string, string> = {}
    if (keep.poaEmail && merge.poaEmail && keep.poaEmail !== merge.poaEmail) {
      conflicts.poaEmail = merge.poaEmail
    }

    const moved: Record<string, number> = {}
    let bookingsMoved = 0
    let cardsLeftBehind = 0

    const countRows = (res: unknown): number => (res as unknown as unknown[]).length

    await db.transaction(async (tx) => {
      // Re-verify inside the transaction (guards a race between the pre-check
      // and the tx — throwing here rolls back and surfaces as 500, which is
      // acceptable for the true concurrent-write edge).
      const [keepRes, mergeRes] = await Promise.all([
        tx
          .select({ id: residents.id })
          .from(residents)
          .where(and(eq(residents.id, keepId), eq(residents.facilityId, facilityId), eq(residents.active, true))),
        tx
          .select({ id: residents.id })
          .from(residents)
          .where(and(eq(residents.id, mergeId), eq(residents.facilityId, facilityId), eq(residents.active, true))),
      ])

      if (!keepRes.length) throw new Error('keepId resident not found in facility')
      if (!mergeRes.length) throw new Error('mergeId resident not found in facility')

      // ── Portal access FOLLOWS the merge ──────────────────────────────────
      // unique(portal_account_id, resident_id): pre-delete loser links whose
      // account already links the survivor, then re-point the rest.
      await tx.execute(sql`
        DELETE FROM portal_account_residents
        WHERE resident_id = ${mergeId}
          AND portal_account_id IN (
            SELECT portal_account_id FROM portal_account_residents WHERE resident_id = ${keepId}
          )
      `)
      moved.portalLinks = countRows(
        await tx.execute(sql`
          UPDATE portal_account_residents SET resident_id = ${keepId}
          WHERE resident_id = ${mergeId} RETURNING 1
        `),
      )
      moved.magicLinks = countRows(
        await tx.execute(sql`
          UPDATE portal_magic_links SET resident_id = ${keepId}
          WHERE resident_id = ${mergeId} RETURNING 1
        `),
      )

      // ── Saved cards / Stripe customer (DB-only, see case rule above) ─────
      if (inheritStripe) {
        moved.cards = countRows(
          await tx.execute(sql`
            UPDATE payment_methods SET resident_id = ${keepId}
            WHERE resident_id = ${mergeId} RETURNING 1
          `),
        )
      } else {
        const behind = await tx.execute(sql`
          SELECT COUNT(*)::int AS n FROM payment_methods
          WHERE resident_id = ${mergeId} AND active = true
        `)
        cardsLeftBehind = Number((behind as unknown as Array<{ n: number | string }>)[0]?.n ?? 0)
      }

      // ── Billing history follows the survivor ─────────────────────────────
      moved.invoices = countRows(
        await tx.execute(sql`UPDATE qb_invoices SET resident_id = ${keepId} WHERE resident_id = ${mergeId} RETURNING 1`),
      )
      moved.payments = countRows(
        await tx.execute(sql`UPDATE qb_payments SET resident_id = ${keepId} WHERE resident_id = ${mergeId} RETURNING 1`),
      )
      moved.credits = countRows(
        await tx.execute(sql`UPDATE qb_unapplied_credits SET resident_id = ${keepId} WHERE resident_id = ${mergeId} RETURNING 1`),
      )
      await tx.execute(sql`
        UPDATE qb_unresolved_payments SET resolved_to_resident_id = ${keepId}
        WHERE resolved_to_resident_id = ${mergeId}
      `)
      // resident_breakdown jsonb blobs referencing the loser's uuid (guarded
      // text replace; uuids are collision-free substrings).
      await tx.execute(sql`
        UPDATE qb_payments
        SET resident_breakdown = replace(resident_breakdown::text, ${mergeId}, ${keepId})::jsonb
        WHERE resident_breakdown IS NOT NULL AND resident_breakdown::text LIKE ${'%' + mergeId + '%'}
      `)

      // ── Everything else with a resident FK ───────────────────────────────
      moved.couponRedemptions = countRows(
        await tx.execute(sql`UPDATE portal_coupon_redemptions SET resident_id = ${keepId} WHERE resident_id = ${mergeId} RETURNING 1`),
      )
      moved.claims = countRows(
        await tx.execute(sql`UPDATE portal_claim_requests SET resident_id = ${keepId} WHERE resident_id = ${mergeId} RETURNING 1`),
      )
      moved.signupEntries = countRows(
        await tx.execute(sql`UPDATE signup_sheet_entries SET resident_id = ${keepId} WHERE resident_id = ${mergeId} RETURNING 1`),
      )
      moved.waitlistEntries = countRows(
        await tx.execute(sql`UPDATE waitlist_entries SET resident_id = ${keepId} WHERE resident_id = ${mergeId} RETURNING 1`),
      )
      moved.photos = countRows(
        await tx.execute(sql`UPDATE resident_photos SET resident_id = ${keepId} WHERE resident_id = ${mergeId} RETURNING 1`),
      )

      // ── Bookings (pre-P36 behavior, kept) ────────────────────────────────
      const [{ bookingCount }] = await tx
        .select({ bookingCount: count() })
        .from(bookings)
        .where(and(eq(bookings.residentId, mergeId), eq(bookings.facilityId, facilityId)))
      bookingsMoved = bookingCount
      if (bookingsMoved > 0) {
        await tx
          .update(bookings)
          .set({ residentId: keepId })
          .where(and(eq(bookings.residentId, mergeId), eq(bookings.facilityId, facilityId)))
      }

      // ── Deactivate the loser (portalToken freed BEFORE survivor inherits;
      //    autopay off for hygiene; name suffixed for the unique constraint) ─
      await tx
        .update(residents)
        .set({
          active: false,
          name: sql`${residents.name} || '-merged'`,
          portalToken: null,
          autopayEnabled: false,
        })
        .where(and(eq(residents.id, mergeId), eq(residents.facilityId, facilityId)))

      // ── Survivor: operator-chosen name/room + inherited fields ───────────
      const survivorSet: Record<string, unknown> = { name: finalName, roomNumber: finalRoom }
      for (const [field, value] of inheritable) survivorSet[field] = value
      if (inheritPortalToken) survivorSet.portalToken = merge.portalToken
      if (inheritStripe) {
        survivorSet.stripeCustomerId = merge.stripeCustomerId
        survivorSet.autopayEnabled = merge.autopayEnabled
        survivorSet.autopayMethod = merge.autopayMethod
      }
      await tx
        .update(residents)
        .set(survivorSet)
        .where(and(eq(residents.id, keepId), eq(residents.facilityId, facilityId)))

      // ── Audit row (last statement of the tx) ─────────────────────────────
      await tx.insert(residentMergeLog).values({
        performedBy: user.id,
        facilityId,
        keepResidentId: keepId,
        mergedResidentId: mergeId,
        mergedResidentName: merge.name,
        moved: { ...moved, bookings: bookingsMoved },
        fieldsInherited: [
          ...inheritable.map(([f]) => f),
          ...(inheritPortalToken ? ['portalToken'] : []),
          ...(inheritStripe ? ['stripeCustomerId', 'autopay'] : []),
        ],
        cardsLeftBehind,
        notes: Object.keys(conflicts).length ? `conflicts: ${JSON.stringify(conflicts)}` : null,
      })
    })

    // Bookings + billing rows moved between residents — bust cached reports.
    revalidateTag('bookings', {})
    revalidateTag('billing', {})

    return Response.json({
      data: {
        bookingsMoved,
        moved,
        fieldsInherited: inheritable.map(([f]) => f),
        cardsLeftBehind,
        conflicts,
      },
    })
  } catch (err) {
    console.error('POST /api/residents/merge error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
