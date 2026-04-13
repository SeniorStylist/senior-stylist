import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { residents, facilities } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { sendEmail } from '@/lib/email'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const { id } = await params

    const resident = await db.query.residents.findFirst({
      where: and(
        eq(residents.id, id),
        eq(residents.facilityId, facilityUser.facilityId),
        eq(residents.active, true)
      ),
    })

    if (!resident) return Response.json({ error: 'Resident not found' }, { status: 404 })
    if (!resident.poaEmail) return Response.json({ error: 'No POA email on file' }, { status: 400 })
    if (!resident.portalToken) return Response.json({ error: 'No portal token' }, { status: 400 })

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityUser.facilityId),
    })

    const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/${resident.portalToken}`
    const facilityName = facility?.name ?? 'Senior Stylist'

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#0D7377;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">Salon Portal Access</h1>
      <p style="margin:6px 0 0;color:#E0F2F1;font-size:13px;">${facilityName}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 16px;font-size:14px;color:#44403C;">You have been granted access to the salon booking portal for <strong>${resident.name}</strong>.</p>
      <p style="margin:0 0 24px;font-size:14px;color:#78716C;">Use the link below to view upcoming appointments and book new ones on their behalf.</p>
      <p style="margin:0 0 24px;">
        <a href="${portalUrl}" style="display:inline-block;background:#0D7377;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">Open Portal</a>
      </p>
      <p style="margin:0;font-size:12px;color:#A8A29E;">This link is unique to ${resident.name}. Keep it private.</p>
    </div>
  </div>
</body>
</html>`.trim()

    sendEmail({
      to: resident.poaEmail,
      subject: `Salon portal access for ${resident.name}`,
      html,
    }).catch(console.error)

    return Response.json({ data: { sent: true } })
  } catch (err) {
    console.error('POST /api/residents/[id]/send-portal-link error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
