import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { invites, facilities } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, desc } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { sendEmail } from '@/lib/email'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isSuperAdmin = !!(
      process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    )

    const body = await request.json()
    const { email, inviteRole } = body

    let facilityId: string
    if (isSuperAdmin) {
      if (!body.facilityId || typeof body.facilityId !== 'string') {
        return Response.json({ error: 'facilityId is required' }, { status: 422 })
      }
      facilityId = body.facilityId
    } else {
      const facilityUser = await getUserFacility(user.id)
      if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
      if (facilityUser.role !== 'admin') {
        return Response.json({ error: 'Admin access required' }, { status: 403 })
      }
      facilityId = facilityUser.facilityId
    }
    if (!email || typeof email !== 'string') {
      return Response.json({ error: 'Email is required' }, { status: 422 })
    }

    const validRoles = ['admin', 'stylist', 'viewer']
    if (inviteRole && !validRoles.includes(inviteRole)) {
      return Response.json({ error: 'Invalid role. Must be admin, stylist, or viewer' }, { status: 422 })
    }

    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const [invite] = await db
      .insert(invites)
      .values({
        facilityId,
        email: email.toLowerCase().trim(),
        invitedBy: user.id,
        inviteRole: inviteRole || 'stylist',
        token,
        expiresAt,
      })
      .returning()

    // Send invite email (fire-and-forget)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://senior-stylist.vercel.app'
    const facility = await db.query.facilities.findFirst({ where: eq(facilities.id, facilityId) })
    sendEmail({
      to: email,
      subject: "You're invited to Senior Stylist",
      html: `
        <p>You've been invited to join <strong>${facility?.name ?? 'Senior Stylist'}</strong> as a <strong>${inviteRole || 'stylist'}</strong>.</p>
        <p><a href="${appUrl}/invite/accept?token=${token}">Accept your invitation</a></p>
        <p>This link expires in 7 days.</p>
        <p style="color:#999;font-size:12px;">If you weren't expecting this, you can ignore this email.</p>
      `,
    })

    return Response.json({ data: invite }, { status: 201 })
  } catch (err) {
    console.error('POST /api/invites error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    // Admin only
    if (facilityUser.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 })
    }

    const data = await db.query.invites.findMany({
      where: eq(invites.facilityId, facilityId),
      with: {
        invitedByProfile: true,
      },
      orderBy: [desc(invites.createdAt)],
    })

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/invites error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
