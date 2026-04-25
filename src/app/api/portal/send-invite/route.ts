import { db } from '@/db'
import { facilities, residents } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { createClient } from '@/lib/supabase/server'
import { createMagicLink } from '@/lib/portal-auth'
import { buildPortalMagicLinkEmailHtml, sendEmail } from '@/lib/email'
import { eq, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({ residentId: z.string().uuid() })

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    const isMaster = user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!facilityUser && !isMaster) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 })

    const resident = await db.query.residents.findFirst({
      where: eq(residents.id, parsed.data.residentId),
    })
    if (!resident) return Response.json({ error: 'Resident not found' }, { status: 404 })

    if (!isMaster) {
      if (!facilityUser || facilityUser.facilityId !== resident.facilityId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (facilityUser.role !== 'admin') {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    if (!resident.poaEmail) {
      return Response.json({ error: 'Resident has no POA email' }, { status: 400 })
    }

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, resident.facilityId),
      columns: { id: true, name: true, facilityCode: true },
    })
    if (!facility?.facilityCode) {
      return Response.json({ error: 'Facility has no facility code — set one before sending portal invites' }, { status: 400 })
    }

    const link = await createMagicLink(resident.poaEmail, resident.id, facility.facilityCode, 72)

    sendEmail({
      to: resident.poaEmail,
      subject: `Your portal access for ${resident.name} at ${facility.name}`,
      html: buildPortalMagicLinkEmailHtml({
        residentNames: [resident.name],
        facilityName: facility.name,
        link,
        expiresInHours: 72,
      }),
    })

    await db.update(residents).set({ lastPortalInviteSentAt: sql`now()` }).where(eq(residents.id, resident.id))

    return Response.json({ data: { sent: true } })
  } catch (err) {
    console.error('POST /api/portal/send-invite error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
