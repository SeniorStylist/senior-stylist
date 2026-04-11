import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { facilityUsers, profiles, invites } from '@/db/schema'
import { and, eq, count } from 'drizzle-orm'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (userId === user.id) return Response.json({ error: 'Cannot remove yourself' }, { status: 400 })

    const facilityId = facilityUser.facilityId

    const targetRow = await db.query.facilityUsers.findFirst({
      where: and(eq(facilityUsers.facilityId, facilityId), eq(facilityUsers.userId, userId)),
    })
    if (!targetRow) return Response.json({ error: 'User not found' }, { status: 404 })

    // Guard: cannot remove the last admin
    if (targetRow.role === 'admin') {
      const [{ value: adminCount }] = await db
        .select({ value: count() })
        .from(facilityUsers)
        .where(and(eq(facilityUsers.facilityId, facilityId), eq(facilityUsers.role, 'admin')))
      if (Number(adminCount) <= 1) {
        return Response.json({ error: 'Cannot remove the last admin' }, { status: 400 })
      }
    }

    // Fetch profile email before deletion so we can cancel pending invites
    const profileRow = await db.query.profiles.findFirst({
      where: eq(profiles.id, userId),
      columns: { email: true },
    })
    const revokedEmail = profileRow?.email?.toLowerCase().trim() ?? null

    await db.transaction(async (tx) => {
      await tx
        .delete(facilityUsers)
        .where(and(eq(facilityUsers.facilityId, facilityId), eq(facilityUsers.userId, userId)))

      // Clear stylist linkage so the stylist record can be re-linked to a future user
      await tx
        .update(profiles)
        .set({ stylistId: null, updatedAt: new Date() })
        .where(eq(profiles.id, userId))

      // Cancel any pending invites for this email at this facility
      if (revokedEmail) {
        await tx
          .update(invites)
          .set({ used: true })
          .where(
            and(
              eq(invites.email, revokedEmail),
              eq(invites.facilityId, facilityId),
              eq(invites.used, false)
            )
          )
      }
    })

    // Invalidate the removed user's Supabase sessions so they can't continue navigating
    try {
      const adminClient = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
      await adminClient.auth.admin.signOut(userId, 'global')
    } catch (signOutErr) {
      // Non-fatal — facilityUser is already deleted, middleware will catch them on next server request
      console.error('[removeUser] session invalidation failed:', signOutErr)
    }

    return Response.json({ data: { removed: userId } })
  } catch (err) {
    console.error('DELETE /api/facility/users/[userId] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
