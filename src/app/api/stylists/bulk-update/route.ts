import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylists, stylistFacilityAssignments, franchiseFacilities } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const bodySchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(200),
    status: z.enum(['active', 'inactive', 'on_leave', 'terminated']).optional(),
    facilityId: z.string().uuid().optional(),
    commissionPercent: z.number().int().min(0).max(100).optional(),
  })
  .refine((d) => d.status || d.facilityId || d.commissionPercent !== undefined, {
    message: 'At least one field required',
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
      return Response.json({ error: parsed.error.issues[0].message }, { status: 422 })
    }

    const { ids, status, facilityId, commissionPercent } = parsed.data

    // Determine franchise scope
    const franchise = master ? null : await getUserFranchise(user.id)
    const allowedFacilityIds = franchise?.facilityIds ?? (facilityUser ? [facilityUser.facilityId] : [])
    const franchiseId = franchise?.franchiseId ?? null

    // Load the requested stylists to verify scope
    const rows = await db
      .select({ id: stylists.id, facilityId: stylists.facilityId, franchiseId: stylists.franchiseId })
      .from(stylists)
      .where(inArray(stylists.id, ids))

    let ownedIds: string[]
    if (master) {
      ownedIds = rows.map((s) => s.id)
    } else {
      const owned = rows.filter((s) => {
        const facilityOwned = s.facilityId && allowedFacilityIds.includes(s.facilityId)
        const franchiseOwned = franchiseId && s.franchiseId === franchiseId
        const poolOwned = franchiseId && s.franchiseId === franchiseId && s.facilityId === null
        return facilityOwned || franchiseOwned || poolOwned
      })
      ownedIds = owned.map((s) => s.id)
    }

    if (ownedIds.length === 0) {
      return Response.json({ data: { updated: 0 } })
    }

    if (status) {
      await db
        .update(stylists)
        .set({ status, updatedAt: new Date() })
        .where(inArray(stylists.id, ownedIds))
    } else if (facilityId) {
      // Verify the target facility is in the caller's franchise
      if (!master && franchiseId) {
        const facilityCheck = await db.query.franchiseFacilities.findFirst({
          where: (t, { and: andFn, eq: eqFn }) =>
            andFn(eqFn(t.franchiseId, franchiseId), eqFn(t.facilityId, facilityId)),
        })
        if (!facilityCheck) {
          return Response.json({ error: 'Facility not in franchise' }, { status: 403 })
        }
      }
      await db.transaction(async (tx) => {
        // Upsert assignment rows
        await tx
          .insert(stylistFacilityAssignments)
          .values(ownedIds.map((id) => ({ stylistId: id, facilityId, active: true })))
          .onConflictDoUpdate({
            target: [stylistFacilityAssignments.stylistId, stylistFacilityAssignments.facilityId],
            set: { active: true, updatedAt: new Date() },
          })
        // Update primary facilityId on stylists row
        await tx
          .update(stylists)
          .set({ facilityId, updatedAt: new Date() })
          .where(inArray(stylists.id, ownedIds))
      })
    } else if (commissionPercent !== undefined) {
      await db
        .update(stylists)
        .set({ commissionPercent, updatedAt: new Date() })
        .where(inArray(stylists.id, ownedIds))
    }

    return Response.json({ data: { updated: ownedIds.length } })
  } catch (err) {
    console.error('POST /api/stylists/bulk-update error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
