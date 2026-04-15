import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylists, stylistNotes } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { NextRequest } from 'next/server'

function isMasterAdmin(email: string | null | undefined) {
  const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  return !!su && email === su
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  try {
    const { id, noteId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const master = isMasterAdmin(user.email)
    const facilityUser = master ? null : await getUserFacility(user.id)
    if (!master && !facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!master && facilityUser!.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const franchise = master ? null : await getUserFranchise(user.id)
    const allowedFacilityIds =
      franchise?.facilityIds ?? (facilityUser ? [facilityUser.facilityId] : [])

    // Verify stylist is in scope
    const stylist = await db.query.stylists.findFirst({ where: eq(stylists.id, id) })
    if (!stylist) return Response.json({ error: 'Not found' }, { status: 404 })
    if (!master) {
      const owned =
        (stylist.facilityId && allowedFacilityIds.includes(stylist.facilityId)) ||
        (franchise && stylist.franchiseId === franchise.franchiseId)
      if (!owned) return Response.json({ error: 'Not found' }, { status: 404 })
    }

    // Verify note belongs to this stylist
    const note = await db.query.stylistNotes.findFirst({
      where: and(eq(stylistNotes.id, noteId), eq(stylistNotes.stylistId, id)),
    })
    if (!note) return Response.json({ error: 'Not found' }, { status: 404 })

    await db.delete(stylistNotes).where(eq(stylistNotes.id, noteId))

    return Response.json({ data: { deleted: true } })
  } catch (err) {
    console.error('DELETE /api/stylists/[id]/notes/[noteId] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
