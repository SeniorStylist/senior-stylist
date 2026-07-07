// Phase 16 G11 — delete a gallery photo (admin/facility_staff) or toggle its
// family sharing (PATCH). Facility-scoped through the resident.

import { createClient } from '@/lib/supabase/server'
import { createStorageClient, RESIDENT_PHOTOS_BUCKET } from '@/lib/supabase/storage'
import { db } from '@/db'
import { residentPhotos, residents } from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ensureResidentPhotosSchema } from '@/lib/resident-photos-ddl'

export const dynamic = 'force-dynamic'

async function authorize(userId: string, residentId: string) {
  const facilityUser = await getUserFacility(userId)
  if (!facilityUser) return null
  if (!isAdminOrAbove(facilityUser.role) && !isFacilityStaff(facilityUser.role)) return null
  const resident = await db.query.residents.findFirst({
    where: and(eq(residents.id, residentId), eq(residents.facilityId, facilityUser.facilityId)),
    columns: { id: true },
  })
  return resident ? facilityUser : null
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: residentId, photoId } = await params
    const fu = await authorize(user.id, residentId)
    if (!fu) return Response.json({ error: 'Forbidden' }, { status: 403 })

    await ensureResidentPhotosSchema()

    const photo = await db.query.residentPhotos.findFirst({
      where: and(eq(residentPhotos.id, photoId), eq(residentPhotos.residentId, residentId)),
      columns: { id: true, path: true },
    })
    if (!photo) return Response.json({ error: 'Not found' }, { status: 404 })

    const storage = createStorageClient()
    await storage.storage.from(RESIDENT_PHOTOS_BUCKET).remove([photo.path]).catch(() => {})
    await db.delete(residentPhotos).where(eq(residentPhotos.id, photo.id))

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('[DELETE /api/residents/[id]/photos/[photoId]] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const patchSchema = z.object({ sharedWithFamily: z.boolean() })

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: residentId, photoId } = await params
    const fu = await authorize(user.id, residentId)
    if (!fu) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    await ensureResidentPhotosSchema()

    const [updated] = await db
      .update(residentPhotos)
      .set({ sharedWithFamily: parsed.data.sharedWithFamily })
      .where(and(eq(residentPhotos.id, photoId), eq(residentPhotos.residentId, residentId)))
      .returning({ id: residentPhotos.id, sharedWithFamily: residentPhotos.sharedWithFamily })
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data: updated })
  } catch (err) {
    console.error('[PATCH /api/residents/[id]/photos/[photoId]] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
