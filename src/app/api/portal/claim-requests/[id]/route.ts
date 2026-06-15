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
import { z } from 'zod'
import { createMagicLink } from '@/lib/portal-auth'
import { issueWelcomeCoupon } from '@/lib/portal-coupons'
import { sendEmail, buildPortalMagicLinkEmailHtml } from '@/lib/email'

export const dynamic = 'force-dynamic'

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    residentId: z.string().uuid().optional(),
    notes: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    action: z.literal('reject'),
    notes: z.string().max(2000).optional().nullable(),
  }),
])

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

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

    if (claim.status !== 'pending_review') {
      return Response.json({ error: 'Claim already reviewed' }, { status: 409 })
    }

    const { action, notes } = parsed.data

    if (action === 'reject') {
      await db.update(portalClaimRequests)
        .set({
          status: 'rejected',
          reviewedBy: user.id,
          reviewedAt: new Date(),
          notes: notes ?? null,
        })
        .where(eq(portalClaimRequests.id, id))

      return Response.json({ data: { status: 'rejected' } })
    }

    // action === 'approve'
    const overrideResidentId = (parsed.data as { residentId?: string }).residentId ?? claim.residentId

    // Look up the resident to link (use override if provided, else original match)
    const resident = overrideResidentId
      ? await db.query.residents.findFirst({
          where: and(
            eq(residents.id, overrideResidentId),
            eq(residents.facilityId, claim.facilityId),
            eq(residents.active, true),
          ),
          columns: { id: true, name: true, roomNumber: true },
        })
      : null

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, claim.facilityId),
      columns: { id: true, name: true, facilityCode: true },
    })
    if (!facility?.facilityCode) {
      return Response.json({ error: 'Facility has no facility code' }, { status: 400 })
    }

    // Upsert portal account
    const existing = await db.query.portalAccounts.findFirst({
      where: eq(portalAccounts.email, claim.email),
      columns: { id: true },
    })

    let portalAccountId: string
    if (existing) {
      await db.update(portalAccounts)
        .set({
          fullName: claim.fullName || undefined,
          phone: claim.phone ?? undefined,
          ...(claim.dateOfBirth ? { dateOfBirth: claim.dateOfBirth } : {}),
        })
        .where(eq(portalAccounts.id, existing.id))
      portalAccountId = existing.id
    } else {
      const [created] = await db.insert(portalAccounts)
        .values({
          email: claim.email,
          fullName: claim.fullName,
          phone: claim.phone,
          dateOfBirth: claim.dateOfBirth ?? null,
        })
        .returning({ id: portalAccounts.id })
      portalAccountId = created.id
    }

    // Link resident if matched
    if (resident) {
      await db.insert(portalAccountResidents)
        .values({ portalAccountId, residentId: resident.id, facilityId: claim.facilityId })
        .onConflictDoNothing()
    }

    // Mark claim as approved
    await db.update(portalClaimRequests)
      .set({
        status: 'approved',
        residentId: resident?.id ?? claim.residentId ?? null,
        reviewedBy: user.id,
        reviewedAt: new Date(),
        notes: notes ?? null,
      })
      .where(eq(portalClaimRequests.id, id))

    // Issue welcome coupon (fire-and-forget)
    issueWelcomeCoupon(claim.facilityId, portalAccountId, resident?.id ?? null).catch(() => {})

    // Send magic link — AWAITED (user-initiated "send" path)
    const magicLink = await createMagicLink(claim.email, resident?.id ?? null, facility.facilityCode)
    await sendEmail({
      to: claim.email,
      subject: `Welcome to the ${facility.name} Family Portal`,
      html: buildPortalMagicLinkEmailHtml({
        residentNames: resident ? [resident.name] : [],
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
