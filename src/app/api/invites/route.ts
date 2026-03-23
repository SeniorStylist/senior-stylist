import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { invites, facilities } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, desc } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const { email, inviteRole } = body
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

    // Send email via Resend (fire-and-forget, non-fatal)
    if (process.env.RESEND_API_KEY) {
      try {
        const facility = await db.query.facilities.findFirst({
          where: eq(facilities.id, facilityId),
        })
        const facilityName = facility?.name ?? 'Senior Stylist'
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://senior-stylist.vercel.app'
        const acceptLink = `${appUrl}/invite/accept?token=${token}`

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Senior Stylist <noreply@senior-stylist.vercel.app>',
            to: email,
            subject: "You've been invited to Senior Stylist",
            html: `
              <p>You've been invited to join <strong>${facilityName}</strong> on Senior Stylist.</p>
              <p><a href="${acceptLink}">Accept your invitation</a></p>
              <p>This link expires in 7 days.</p>
              <p style="color:#999;font-size:12px;">If you weren't expecting this invitation, you can ignore this email.</p>
            `,
          }),
        })
      } catch (emailErr) {
        console.error('Failed to send invite email:', emailErr)
      }
    }

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
