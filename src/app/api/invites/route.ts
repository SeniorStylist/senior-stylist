import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { invites, facilities, profiles, facilityUsers, franchises, franchiseFacilities } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, desc, and } from 'drizzle-orm'
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

      if (facilityUser.role === 'super_admin') {
        // Franchise owner — allow inviting only to facilities inside their franchise
        const targetFacilityId =
          (typeof body.facilityId === 'string' && body.facilityId) || facilityUser.facilityId

        const ownedFranchise = await db.query.franchises.findFirst({
          where: eq(franchises.ownerUserId, user.id),
          columns: { id: true },
        })
        if (!ownedFranchise) {
          return Response.json({ error: 'Forbidden' }, { status: 403 })
        }
        const covers = await db.query.franchiseFacilities.findFirst({
          where: and(
            eq(franchiseFacilities.franchiseId, ownedFranchise.id),
            eq(franchiseFacilities.facilityId, targetFacilityId)
          ),
        })
        if (!covers) {
          return Response.json({ error: 'Facility not in your franchise' }, { status: 403 })
        }
        facilityId = targetFacilityId
      } else if (facilityUser.role !== 'admin') {
        return Response.json({ error: 'Admin access required' }, { status: 403 })
      } else {
        facilityId = facilityUser.facilityId
      }
    }
    if (!email || typeof email !== 'string') {
      return Response.json({ error: 'Email is required' }, { status: 422 })
    }

    const validRoles = ['admin', 'stylist', 'viewer']
    if (inviteRole && !validRoles.includes(inviteRole)) {
      return Response.json({ error: 'Invalid role. Must be admin, stylist, or viewer' }, { status: 422 })
    }

    const normalizedEmail = email.toLowerCase().trim()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://senior-stylist.vercel.app'
    const facility = await db.query.facilities.findFirst({ where: eq(facilities.id, facilityId) })
    const facilityName = facility?.name ?? 'Senior Stylist'
    const role = inviteRole || 'stylist'

    // Dedup: check for an existing invite at this email + facility
    const existingInvite = await db.query.invites.findFirst({
      where: and(eq(invites.email, normalizedEmail), eq(invites.facilityId, facilityId)),
    })

    if (existingInvite) {
      if (existingInvite.used) {
        // used=true means the invite was consumed OR cancelled — check if they actually still have access
        const profileForEmail = await db.query.profiles.findFirst({
          where: eq(profiles.email, normalizedEmail),
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
            { error: 'This person already has access to this facility' },
            { status: 409 }
          )
        }
        // No active access (revoked or never provisioned) — delete stale invite and fall through to fresh insert
        await db.delete(invites).where(eq(invites.id, existingInvite.id))
      }
      // Pending (used=false) — refresh token + expiry and re-send
      const newToken = crypto.randomBytes(32).toString('hex')
      const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      const [refreshed] = await db
        .update(invites)
        .set({ token: newToken, expiresAt: newExpiresAt, inviteRole: role })
        .where(eq(invites.id, existingInvite.id))
        .returning()
      sendEmail({
        to: normalizedEmail,
        subject: `You're invited to join ${facilityName}`,
        html: buildInviteEmailHtml({ facilityName, role, acceptUrl: `${appUrl}/invite/accept?token=${newToken}` }),
      })
      return Response.json({ data: refreshed, refreshed: true })
    }

    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const [invite] = await db
      .insert(invites)
      .values({
        facilityId,
        email: normalizedEmail,
        invitedBy: user.id,
        inviteRole: role,
        token,
        expiresAt,
      })
      .returning()

    // Send invite email (fire-and-forget)
    const acceptUrl = `${appUrl}/invite/accept?token=${token}`
    sendEmail({
      to: normalizedEmail,
      subject: `You're invited to join ${facilityName}`,
      html: buildInviteEmailHtml({ facilityName, role, acceptUrl }),
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

export function buildInviteEmailHtml({
  facilityName,
  role,
  acceptUrl,
}: {
  facilityName: string
  role: string
  acceptUrl: string
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#8B2E4A;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">You're Invited</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 20px;color:#1C1917;font-size:15px;line-height:1.6;">
        You've been invited to join <strong>${facilityName}</strong> as a <strong>${role}</strong> on Senior Stylist.
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${acceptUrl}" style="display:inline-block;background:#8B2E4A;color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:12px;">
          Accept Invitation
        </a>
      </div>
      <p style="margin:20px 0 0;color:#78716C;font-size:13px;line-height:1.5;">
        This link expires in 7 days. If the button doesn't work, copy and paste this URL into your browser:
      </p>
      <p style="margin:8px 0 0;color:#8B2E4A;font-size:12px;word-break:break-all;">
        ${acceptUrl}
      </p>
      <hr style="border:none;border-top:1px solid #F5F5F4;margin:24px 0;" />
      <p style="margin:0;color:#A8A29E;font-size:12px;">
        If you weren't expecting this invitation, you can safely ignore this email.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim()
}
