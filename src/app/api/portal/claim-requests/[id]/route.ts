import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import {
  facilities,
  portalAccounts,
  portalAccountResidents,
  portalClaimRequests,
  residents,
} from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { createMagicLink } from '@/lib/portal-auth'
import { issueWelcomeCoupon } from '@/lib/portal-coupons'
import { sendEmail, buildPortalMagicLinkEmailHtml, buildClaimRejectedEmailHtml } from '@/lib/email'
import { ensurePortalClaimsSchema } from '@/lib/portal-claims-ddl'

export const dynamic = 'force-dynamic'

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    residentId: z.string().uuid().optional(),
    // P52 — create the resident from the claim's details (no-match signups).
    createResident: z.boolean().optional(),
    notes: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    action: z.literal('reject'),
    notes: z.string().max(2000).optional().nullable(),
  }),
  // P54 — uniform account model: acknowledge an auto-created resident as
  // genuinely new (the merge path runs POST /api/residents/merge first,
  // then keep). Valid ONLY for status 'auto_created'.
  z.object({
    action: z.literal('keep'),
    notes: z.string().max(2000).optional().nullable(),
  }),
])

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    // P50 — this handler does a full-row claim read; bootstrap the new columns
    // so a pre-migration deploy can't break approvals.
    await ensurePortalClaimsSchema()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster = user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser && !isMaster) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (facilityUser && facilityUser.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 })

    const claim = await db.query.portalClaimRequests.findFirst({
      where: eq(portalClaimRequests.id, id),
    })
    if (!claim) return Response.json({ error: 'Not found' }, { status: 404 })

    // Facility scope check
    if (!isMaster && facilityUser!.facilityId !== claim.facilityId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { action, notes } = parsed.data

    // P54 — 'keep' reviews auto_created claims; approve/reject review the
    // legacy pending_review queue. Anything else is already settled.
    const reviewableStatus = action === 'keep' ? 'auto_created' : 'pending_review'
    if (claim.status !== reviewableStatus) {
      return Response.json({ error: 'Claim already reviewed' }, { status: 409 })
    }

    if (action === 'keep') {
      // The account + resident are already live (created at signup time) —
      // keep is a pure acknowledgment. No email, no linking, no coupon.
      await db.update(portalClaimRequests)
        .set({
          status: 'approved',
          reviewedBy: user.id,
          reviewedAt: new Date(),
          notes: notes ?? null,
        })
        .where(eq(portalClaimRequests.id, id))
      return Response.json({ data: { status: 'approved' } })
    }

    if (action === 'reject') {
      await db.update(portalClaimRequests)
        .set({
          status: 'rejected',
          reviewedBy: user.id,
          reviewedAt: new Date(),
          notes: notes ?? null,
        })
        .where(eq(portalClaimRequests.id, id))

      // P50 — the applicant hears back instead of a black hole. Internal
      // admin `notes` are deliberately NOT included. P55 — phone-only claims
      // have no email to write to (SMS notice arrives with the Twilio rollout).
      if (claim.email) {
        const claimEmail = claim.email
        const rejFacility = await db.query.facilities.findFirst({
          where: eq(facilities.id, claim.facilityId),
          columns: { name: true },
        })
        sendEmail({
          to: claimEmail,
          subject: `About your salon account request — ${rejFacility?.name ?? 'Senior Stylist'}`,
          html: buildClaimRejectedEmailHtml({
            fullName: claim.fullName,
            facilityName: rejFacility?.name ?? 'the facility',
            residentName: claim.residentName ?? null,
          }),
        }).catch(() => {})
      }

      return Response.json({ data: { status: 'rejected' } })
    }

    // action === 'approve'
    // P52 resolution precedence: explicit residentId override → createResident
    // → the claim's matched resident. Approving must ALWAYS end with a linked
    // resident — the old code returned 200 with zero linkage on a no-match
    // claim, minting a dead account that could never sign in.
    const explicitResidentId = (parsed.data as { residentId?: string }).residentId ?? null
    const wantsCreate = (parsed.data as { createResident?: boolean }).createResident === true

    let resident: { id: string; name: string; roomNumber: string | null } | null = null
    if (explicitResidentId) {
      resident =
        (await db.query.residents.findFirst({
          where: and(
            eq(residents.id, explicitResidentId),
            eq(residents.facilityId, claim.facilityId),
            eq(residents.active, true),
          ),
          columns: { id: true, name: true, roomNumber: true },
        })) ?? null
      if (!resident) {
        return Response.json({ error: 'That resident was not found at this facility.' }, { status: 422 })
      }
    } else if (wantsCreate) {
      // Create the resident from what the family told us. poaEmail is set
      // unconditionally (it's the portal login identity — a 'self' resident
      // signs in with their own email), which also makes future re-signups
      // tier-1 email matches and lets linkResidentsForEmail auto-discover.
      const [created] = await db
        .insert(residents)
        .values({
          facilityId: claim.facilityId,
          name: (claim.residentName ?? claim.fullName).trim(),
          roomNumber: claim.roomNumber?.trim() || null,
          poaName: claim.relationship === 'self' ? null : claim.fullName,
          poaEmail: claim.email,
          poaPhone: claim.phone ?? null,
          // P53 — every resident needs a portalToken: the POA booking-
          // confirmation email (bookings POST) gates on it, so without this
          // the QR-onboarded cohort silently never got confirmations.
          portalToken: randomBytes(8).toString('hex'),
        })
        .returning({ id: residents.id, name: residents.name, roomNumber: residents.roomNumber })
      resident = created
    } else if (claim.residentId) {
      resident =
        (await db.query.residents.findFirst({
          where: and(
            eq(residents.id, claim.residentId),
            eq(residents.facilityId, claim.facilityId),
            eq(residents.active, true),
          ),
          columns: { id: true, name: true, roomNumber: true },
        })) ?? null
    }

    if (!resident) {
      return Response.json(
        { error: 'Pick a resident to link — or create one from the request details.' },
        { status: 422 },
      )
    }

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, claim.facilityId),
      columns: { id: true, name: true, facilityCode: true },
    })
    if (!facility?.facilityCode) {
      return Response.json({ error: 'Facility has no facility code' }, { status: 400 })
    }

    // P55 — phone-only claims are only ever auto_approved/auto_created (the
    // signup route handles them end to end); the legacy approve flow is
    // email-driven (account upsert + magic link) and must not run without one.
    const claimEmail = claim.email
    if (!claimEmail) {
      return Response.json(
        { error: 'This family signed up by phone — their account was handled at signup. Use Keep or Merge.' },
        { status: 422 },
      )
    }

    // Upsert portal account
    const existing = await db.query.portalAccounts.findFirst({
      where: eq(portalAccounts.email, claimEmail),
      columns: { id: true, fullName: true, phone: true, dateOfBirth: true },
    })

    let portalAccountId: string
    if (existing) {
      // P53 — fill-if-null only: a multi-facility family's profile must not be
      // rewritten by whichever facility approved last.
      const fills = {
        ...(!existing.fullName && claim.fullName ? { fullName: claim.fullName } : {}),
        ...(!existing.phone && claim.phone ? { phone: claim.phone } : {}),
        ...(!existing.dateOfBirth && claim.dateOfBirth ? { dateOfBirth: claim.dateOfBirth } : {}),
      }
      if (Object.keys(fills).length > 0) {
        await db.update(portalAccounts).set(fills).where(eq(portalAccounts.id, existing.id))
      }
      portalAccountId = existing.id
    } else {
      const [created] = await db.insert(portalAccounts)
        .values({
          email: claimEmail,
          fullName: claim.fullName,
          phone: claim.phone,
          dateOfBirth: claim.dateOfBirth ?? null,
        })
        .returning({ id: portalAccounts.id })
      portalAccountId = created.id
    }

    // Link the resident (always — resident is guaranteed above)
    await db.insert(portalAccountResidents)
      .values({ portalAccountId, residentId: resident.id, facilityId: claim.facilityId })
      .onConflictDoNothing()

    // Mark claim as approved
    await db.update(portalClaimRequests)
      .set({
        status: 'approved',
        residentId: resident.id,
        reviewedBy: user.id,
        reviewedAt: new Date(),
        notes: notes ?? null,
      })
      .where(eq(portalClaimRequests.id, id))

    // Issue welcome coupon (fire-and-forget)
    issueWelcomeCoupon(claim.facilityId, portalAccountId, resident.id).catch(() => {})

    // Send magic link — AWAITED (user-initiated "send" path)
    const magicLink = await createMagicLink(claimEmail, resident.id, facility.facilityCode)
    await sendEmail({
      to: claimEmail,
      subject: `Welcome to your ${facility.name} salon account`,
      html: buildPortalMagicLinkEmailHtml({
        residentNames: [resident.name],
        facilityName: facility.name,
        link: magicLink,
        expiresInHours: 72,
      }),
    })

    return Response.json({ data: { status: 'approved', portalAccountId } })
  } catch (err) {
    console.error('PATCH /api/portal/claim-requests/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
