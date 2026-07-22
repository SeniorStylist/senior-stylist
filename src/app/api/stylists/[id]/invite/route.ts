import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { invites, stylists, profiles, facilityUsers, facilities } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { ensureInviteTrackingSchema } from '@/lib/invite-ddl'
import { sendEmail } from '@/lib/email'
import { buildInviteEmailHtml } from '@/app/api/invites/route'
import crypto from 'crypto'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    // P39 — master admin (env email, no facility row) may invite any stylist,
    // consistent with the rest of /api/stylists/*.
    const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const master = !!su && user.email === su
    const facilityUser = master ? null : await getUserFacility(user.id)
    if (!master && !facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!master && facilityUser!.role !== 'admin')
      return Response.json({ error: 'Forbidden' }, { status: 403 })

    const { id: stylistId } = await params

    const stylist = await db.query.stylists.findFirst({
      where: and(eq(stylists.id, stylistId), eq(stylists.active, true)),
    })
    if (!stylist) return Response.json({ error: 'Stylist not found' }, { status: 404 })

    // Scope guard: stylist must be in caller's franchise or same facility
    // (master bypasses — supervises everything).
    if (!master) {
      const franchise = await getUserFranchise(user.id)
      const inFranchise = franchise && stylist.franchiseId === franchise.franchiseId
      const inFacility = stylist.facilityId === facilityUser!.facilityId
      if (!inFranchise && !inFacility) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    if (!stylist.email) {
      return Response.json(
        { error: 'This stylist has no email address on file' },
        { status: 400 },
      )
    }

    // Check if a profile is already linked
    const linked = await db.query.profiles.findFirst({
      where: eq(profiles.stylistId, stylistId),
      columns: { id: true },
    })
    if (linked) {
      return Response.json(
        { error: 'This stylist already has a linked account' },
        { status: 409 },
      )
    }

    await ensureInviteTrackingSchema()

    const normalizedEmail = stylist.email.toLowerCase().trim()
    // Master: anchor the invite at the stylist's home facility.
    const facilityId = facilityUser?.facilityId ?? stylist.facilityId
    if (!facilityId) {
      return Response.json({ error: 'This stylist has no facility to invite into yet.' }, { status: 422 })
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://senior-stylist.vercel.app'

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { name: true },
    })
    const facilityName = facility?.name ?? 'Senior Stylist'

    // Dedup: check for an existing invite at this email + facility
    const existingInvite = await db.query.invites.findFirst({
      where: and(eq(invites.email, normalizedEmail), eq(invites.facilityId, facilityId)),
    })

    if (existingInvite) {
      if (existingInvite.used) {
        // Check if they actually have active access
        const profileForEmail = await db.query.profiles.findFirst({
          where: (p, { eq: eqFn }) => eqFn(p.email, normalizedEmail),
          columns: { id: true },
        })
        const hasActiveAccess = profileForEmail
          ? !!(await db.query.facilityUsers.findFirst({
              where: and(
                eq(facilityUsers.facilityId, facilityId),
                eq(facilityUsers.userId, profileForEmail.id)
              ),
            }))
          : false

        if (hasActiveAccess) {
          return Response.json(
            { error: 'This stylist already has access to this facility' },
            { status: 409 }
          )
        }
        // No active access — delete stale invite and fall through to fresh insert
        await db.delete(invites).where(eq(invites.id, existingInvite.id))
      } else {
        // Pending invite — refresh token + expiry and resend
        const newToken = crypto.randomBytes(32).toString('hex')
        const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        await db
          .update(invites)
          .set({ token: newToken, expiresAt: newExpiresAt })
          .where(eq(invites.id, existingInvite.id))

        const acceptUrl = `${appUrl}/invite/accept?token=${newToken}`
        const emailSent = await sendEmail({
          to: normalizedEmail,
          subject: `You're invited to join ${facilityName}`,
          html: buildInviteEmailHtml({ facilityName, role: 'stylist', acceptUrl }),
        })
        await db
          .update(invites)
          .set({ lastSentAt: new Date(), emailFailed: !emailSent })
          .where(eq(invites.id, existingInvite.id))

        await db.update(stylists).set({ lastInviteSentAt: new Date() }).where(eq(stylists.id, stylistId))
        return Response.json({ data: { invited: true, emailSent } })
      }
    }

    // Create a new invite
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const [invite] = await db
      .insert(invites)
      .values({
        facilityId,
        email: normalizedEmail,
        invitedBy: user.id,
        inviteRole: 'stylist',
        token,
        expiresAt,
      })
      .returning()

    const acceptUrl = `${appUrl}/invite/accept?token=${token}`
    const emailSent = await sendEmail({
      to: normalizedEmail,
      subject: `You're invited to join ${facilityName}`,
      html: buildInviteEmailHtml({ facilityName, role: 'stylist', acceptUrl }),
    })
    await db
      .update(invites)
      .set({ lastSentAt: new Date(), emailFailed: !emailSent })
      .where(eq(invites.id, invite.id))

    await db.update(stylists).set({ lastInviteSentAt: new Date() }).where(eq(stylists.id, stylistId))

    return Response.json({ data: { invited: true, emailSent } })
  } catch (err) {
    console.error('POST /api/stylists/[id]/invite error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
