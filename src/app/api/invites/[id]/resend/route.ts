import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { invites, facilities } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { sendEmail } from '@/lib/email'
import { buildInviteEmailHtml } from '@/app/api/invites/route'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isSuperAdmin = !!(
      process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    )

    let facilityId: string
    if (isSuperAdmin) {
      // Super admin can resend any invite — look it up directly
      const invite = await db.query.invites.findFirst({
        where: eq(invites.id, id),
      })
      if (!invite) return Response.json({ error: 'Not found' }, { status: 404 })
      facilityId = invite.facilityId
    } else {
      const facilityUser = await getUserFacility(user.id)
      if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
      if (facilityUser.role !== 'admin') {
        return Response.json({ error: 'Admin access required' }, { status: 403 })
      }
      facilityId = facilityUser.facilityId
    }

    const invite = await db.query.invites.findFirst({
      where: and(eq(invites.id, id), eq(invites.facilityId, facilityId)),
    })

    if (!invite) return Response.json({ error: 'Not found' }, { status: 404 })
    if (invite.used) {
      return Response.json({ error: 'Invite already accepted' }, { status: 409 })
    }
    if (new Date(invite.expiresAt) < new Date()) {
      return Response.json({ error: 'Invite has expired' }, { status: 410 })
    }

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://senior-stylist.vercel.app'
    const facilityName = facility?.name ?? 'Senior Stylist'
    const acceptUrl = `${appUrl}/invite/accept?token=${invite.token}`

    sendEmail({
      to: invite.email,
      subject: `You're invited to join ${facilityName}`,
      html: buildInviteEmailHtml({
        facilityName,
        role: invite.inviteRole || 'stylist',
        acceptUrl,
      }),
    })

    return Response.json({ data: { sent: true } })
  } catch (err) {
    console.error('POST /api/invites/[id]/resend error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
