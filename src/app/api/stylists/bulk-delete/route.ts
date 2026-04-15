import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylists } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
})

function isMasterAdmin(email: string | null | undefined) {
  const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  return !!su && email === su
}

export async function POST(request: NextRequest) {
  try {
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

    const body = await request.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { ids } = parsed.data

    // Determine ownership scope
    const franchise = master ? null : await getUserFranchise(user.id)
    const allowedFacilityIds = franchise?.facilityIds ?? (facilityUser ? [facilityUser.facilityId] : [])
    const franchiseId = franchise?.franchiseId ?? null

    // Load the requested stylists
    const rows = await db
      .select({ id: stylists.id, facilityId: stylists.facilityId, franchiseId: stylists.franchiseId })
      .from(stylists)
      .where(inArray(stylists.id, ids))

    if (!master) {
      // Verify every requested stylist is in scope
      const unauthorized = rows.filter((s) => {
        const facilityOwned = s.facilityId && allowedFacilityIds.includes(s.facilityId)
        const franchiseOwned = franchiseId && s.franchiseId === franchiseId
        // Also allow franchise-pool stylists (facilityId = null) that belong to this franchise
        const poolOwned = franchiseId && s.franchiseId === franchiseId && s.facilityId === null
        return !facilityOwned && !franchiseOwned && !poolOwned
      })
      if (unauthorized.length > 0) {
        return Response.json(
          { error: 'Some stylists are outside your scope', ids: unauthorized.map((s) => s.id) },
          { status: 403 },
        )
      }
    }

    const ownedIds = rows.map((s) => s.id)
    if (ownedIds.length === 0) {
      return Response.json({ data: { deleted: 0 } })
    }

    await db
      .update(stylists)
      .set({ active: false, updatedAt: new Date() })
      .where(inArray(stylists.id, ownedIds))

    return Response.json({ data: { deleted: ownedIds.length } })
  } catch (err) {
    console.error('POST /api/stylists/bulk-delete error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
