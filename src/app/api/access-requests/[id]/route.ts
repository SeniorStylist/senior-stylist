import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { accessRequests, profiles, facilityUsers, stylists } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and, ilike } from 'drizzle-orm'
import { z } from 'zod'
import { sendEmail } from '@/lib/email'
import { generateStylistCode } from '@/lib/stylist-code'
import { revalidateTag } from 'next/cache'

const actionSchema = z.object({
  action: z.enum(['approve', 'deny']),
  facilityId: z.string().uuid().optional(),
  role: z.enum(['stylist', 'admin', 'viewer']).optional(),
  commissionPercent: z.number().int().min(0).max(100).optional(),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isSuperAdmin = !!(
      process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    )

    let facilityUser: { facilityId: string; role: string } | null = null
    if (!isSuperAdmin) {
      const fu = await getUserFacility(user.id)
      if (!fu || fu.role !== 'admin') {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      facilityUser = fu
    }

    const { id } = await params
    const body = await request.json()
    const parsed = actionSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    // Load the access request — super admin: any; facility admin: scoped to their facility
    const accessRequest = await db.query.accessRequests.findFirst({
      where: (t) => isSuperAdmin
        ? eq(t.id, id)
        : and(eq(t.id, id), eq(t.facilityId, facilityUser!.facilityId)),
    })

    if (!accessRequest) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const { action, commissionPercent } = parsed.data
    const assignRole = parsed.data.role ?? accessRequest.role ?? 'stylist'

    if (action === 'deny') {
      await db
        .update(accessRequests)
        .set({ status: 'denied', updatedAt: new Date() })
        .where(eq(accessRequests.id, id))

      revalidateTag('access-requests', {})

      return Response.json({ data: { denied: true } })
    }

    // approve — resolve facilityId
    const assignFacilityId = parsed.data.facilityId ?? accessRequest.facilityId
    if (!assignFacilityId) {
      return Response.json(
        { error: 'A facility must be selected to approve this request' },
        { status: 422 }
      )
    }

    // Update the request record
    await db
      .update(accessRequests)
      .set({ status: 'approved', facilityId: assignFacilityId, updatedAt: new Date() })
      .where(eq(accessRequests.id, id))

    // Provision access if we have a userId
    if (accessRequest.userId) {
      await db
        .insert(profiles)
        .values({
          id: accessRequest.userId,
          email: accessRequest.email,
          fullName: accessRequest.fullName ?? null,
          avatarUrl: null,
        })
        .onConflictDoNothing()

      await db
        .insert(facilityUsers)
        .values({
          userId: accessRequest.userId,
          facilityId: assignFacilityId,
          role: assignRole,
        })
        .onConflictDoNothing()
    }

    // For stylist role: upsert stylist record with commissionPercent
    if (assignRole === 'stylist' && commissionPercent != null && accessRequest.fullName) {
      const existingStylist = await db.query.stylists.findFirst({
        where: (t) => and(
          eq(t.facilityId, assignFacilityId),
          ilike(t.name, accessRequest.fullName!)
        ),
      })

      if (existingStylist) {
        await db
          .update(stylists)
          .set({ commissionPercent, updatedAt: new Date() })
          .where(eq(stylists.id, existingStylist.id))
      } else {
        await db.transaction(async (tx) => {
          const stylistCode = await generateStylistCode(tx)
          await tx.insert(stylists).values({
            facilityId: assignFacilityId,
            stylistCode,
            name: accessRequest.fullName!,
            commissionPercent,
            active: true,
          })
        })
      }
    }

    // Notify user of approval (fire-and-forget)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://senior-stylist.vercel.app'
    sendEmail({
      to: accessRequest.email,
      subject: "You've been approved — Senior Stylist",
      html: `
        <p>Your access request has been approved.</p>
        <p>You can now sign in at <a href="${appUrl}">${appUrl}</a>.</p>
      `,
    })

    revalidateTag('access-requests', {})

    return Response.json({ data: { approved: true } })
  } catch (err) {
    console.error('PUT /api/access-requests/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
