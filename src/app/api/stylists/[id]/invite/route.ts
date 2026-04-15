import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { db } from '@/db'
import { stylists, profiles } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'

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

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin')
      return Response.json({ error: 'Forbidden' }, { status: 403 })

    const { id: stylistId } = await params

    const stylist = await db.query.stylists.findFirst({
      where: and(eq(stylists.id, stylistId), eq(stylists.active, true)),
    })
    if (!stylist) return Response.json({ error: 'Stylist not found' }, { status: 404 })

    // Scope guard: stylist must be in caller's franchise or same facility
    const franchise = await getUserFranchise(user.id)
    const inFranchise =
      franchise && stylist.franchiseId === franchise.franchiseId
    const inFacility = stylist.facilityId === facilityUser.facilityId
    if (!inFranchise && !inFacility) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
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

    // Rate limit: 1 invite per 24 hours
    if (stylist.lastInviteSentAt) {
      const hoursSince =
        (Date.now() - new Date(stylist.lastInviteSentAt as unknown as string).getTime()) /
        3_600_000
      if (hoursSince < 24) {
        return Response.json(
          {
            error: `Invite sent ${Math.floor(hoursSince)} hour${Math.floor(hoursSince) === 1 ? '' : 's'} ago — wait 24h before resending`,
          },
          { status: 429 },
        )
      }
    }

    // Send invite via service-role admin client
    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      stylist.email,
      {
        data: { stylist_id: stylistId },
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/invite/accept`,
      },
    )

    if (inviteError) {
      console.error('POST /api/stylists/[id]/invite error:', inviteError)
      return Response.json({ error: inviteError.message }, { status: 500 })
    }

    // Record the invite timestamp
    await db
      .update(stylists)
      .set({ lastInviteSentAt: new Date() })
      .where(eq(stylists.id, stylistId))

    return Response.json({ data: { invited: true } })
  } catch (err) {
    console.error('POST /api/stylists/[id]/invite error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
