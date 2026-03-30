import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { franchises, franchiseFacilities, facilityUsers, profiles } from '@/db/schema'
import { eq, and, inArray, notInArray } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

async function getSuperAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) return null
  return user
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  ownerEmail: z.string().email().optional(),
  facilityIds: z.array(z.string().uuid()).optional(),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const existing = await db.query.franchises.findFirst({
      where: eq(franchises.id, id),
      with: { franchiseFacilities: true },
    })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    const { name, ownerEmail, facilityIds } = parsed.data

    let newOwnerUserId = existing.ownerUserId

    if (ownerEmail) {
      const ownerProfile = await db.query.profiles.findFirst({
        where: eq(profiles.email, ownerEmail),
      })
      if (!ownerProfile) {
        return Response.json({ error: 'No user found with that email' }, { status: 404 })
      }
      newOwnerUserId = ownerProfile.id
    }

    await db.transaction(async (tx) => {
      // Update franchise name/owner
      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (name) updateData.name = name
      if (newOwnerUserId !== existing.ownerUserId) updateData.ownerUserId = newOwnerUserId
      await tx.update(franchises).set(updateData).where(eq(franchises.id, id))

      if (facilityIds !== undefined) {
        const oldFacilityIds = existing.franchiseFacilities.map((ff) => ff.facilityId)
        const toAdd = facilityIds.filter((fid) => !oldFacilityIds.includes(fid))
        const toRemove = oldFacilityIds.filter((fid) => !facilityIds.includes(fid))

        // Add new franchise_facilities
        if (toAdd.length > 0) {
          await tx.insert(franchiseFacilities).values(
            toAdd.map((fid) => ({ franchiseId: id, facilityId: fid }))
          )
        }

        // Remove dropped franchise_facilities
        if (toRemove.length > 0) {
          await tx
            .delete(franchiseFacilities)
            .where(
              and(
                eq(franchiseFacilities.franchiseId, id),
                inArray(franchiseFacilities.facilityId, toRemove)
              )
            )
          // Remove facilityUsers rows for old owner on removed facilities
          if (existing.ownerUserId) {
            await tx
              .delete(facilityUsers)
              .where(
                and(
                  eq(facilityUsers.userId, existing.ownerUserId),
                  inArray(facilityUsers.facilityId, toRemove),
                  eq(facilityUsers.role, 'super_admin')
                )
              )
          }
        }

        // Upsert facilityUsers for owner on new facilities
        if (newOwnerUserId) {
          for (const facilityId of facilityIds) {
            await tx
              .insert(facilityUsers)
              .values({ userId: newOwnerUserId, facilityId, role: 'super_admin' })
              .onConflictDoUpdate({
                target: [facilityUsers.userId, facilityUsers.facilityId],
                set: { role: 'super_admin' },
              })
          }
        }
      } else if (newOwnerUserId && newOwnerUserId !== existing.ownerUserId) {
        // Owner changed but facilities unchanged — transfer facilityUsers
        const currentFacilityIds = existing.franchiseFacilities.map((ff) => ff.facilityId)
        if (existing.ownerUserId && currentFacilityIds.length > 0) {
          await tx
            .delete(facilityUsers)
            .where(
              and(
                eq(facilityUsers.userId, existing.ownerUserId),
                inArray(facilityUsers.facilityId, currentFacilityIds),
                eq(facilityUsers.role, 'super_admin')
              )
            )
        }
        for (const facilityId of currentFacilityIds) {
          await tx
            .insert(facilityUsers)
            .values({ userId: newOwnerUserId, facilityId, role: 'super_admin' })
            .onConflictDoUpdate({
              target: [facilityUsers.userId, facilityUsers.facilityId],
              set: { role: 'super_admin' },
            })
        }
      }
    })

    const data = await db.query.franchises.findFirst({
      where: eq(franchises.id, id),
      with: {
        owner: { columns: { email: true, fullName: true } },
        franchiseFacilities: {
          with: { facility: { columns: { id: true, name: true } } },
        },
      },
    })

    return Response.json({ data })
  } catch (err) {
    console.error('PUT /api/super-admin/franchises/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params

    const existing = await db.query.franchises.findFirst({
      where: eq(franchises.id, id),
      with: { franchiseFacilities: true },
    })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    await db.transaction(async (tx) => {
      const facilityIds = existing.franchiseFacilities.map((ff) => ff.facilityId)

      // Remove facilityUsers rows for owner
      if (existing.ownerUserId && facilityIds.length > 0) {
        await tx
          .delete(facilityUsers)
          .where(
            and(
              eq(facilityUsers.userId, existing.ownerUserId),
              inArray(facilityUsers.facilityId, facilityIds),
              eq(facilityUsers.role, 'super_admin')
            )
          )
      }

      // franchise_facilities cascade-deletes with franchise, but delete explicitly
      await tx.delete(franchiseFacilities).where(eq(franchiseFacilities.franchiseId, id))
      await tx.delete(franchises).where(eq(franchises.id, id))
    })

    return Response.json({ data: { deleted: true } })
  } catch (err) {
    console.error('DELETE /api/super-admin/franchises/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
