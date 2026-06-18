import { createClient } from '@/lib/supabase/server'
import { createStorageClient } from '@/lib/supabase/storage'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { residents } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { revalidateTag } from 'next/cache'

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 5 * 1024 * 1024 // 5 MB
const BUCKET = 'resident-photos'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (facilityUser.role !== 'admin' && facilityUser.role !== 'facility_staff') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await checkRateLimit('photoUpload', user.id)
  if (!rl.ok) return rateLimitResponse(rl.retryAfter)

  // Verify resident belongs to this facility
  const resident = await db.query.residents.findFirst({
    where: and(eq(residents.id, id), eq(residents.facilityId, facilityUser.facilityId)),
    columns: { id: true, photoPath: true },
  })
  if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

  // Parse multipart form
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('photo')
  if (!file || !(file instanceof Blob)) {
    return Response.json({ error: 'No photo provided' }, { status: 400 })
  }

  if (!ALLOWED_MIME.includes(file.type)) {
    return Response.json({ error: 'Only JPEG, PNG, and WebP images are allowed' }, { status: 400 })
  }

  if (file.size > MAX_SIZE) {
    return Response.json({ error: 'Image must be 5 MB or smaller' }, { status: 400 })
  }

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${facilityUser.facilityId}/${id}.${ext}`

  const storage = createStorageClient()
  const arrayBuffer = await file.arrayBuffer()

  const { error: uploadError } = await storage.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, {
      contentType: file.type,
      upsert: true,
    })

  if (uploadError) {
    console.error('[POST /api/residents/[id]/photo] Upload error:', uploadError)
    return Response.json({ error: 'Failed to upload photo' }, { status: 500 })
  }

  // Remove old photo if different path
  if (resident.photoPath && resident.photoPath !== path) {
    await storage.storage.from(BUCKET).remove([resident.photoPath]).catch(() => {})
  }

  try {
    await db
      .update(residents)
      .set({ photoPath: path })
      .where(and(eq(residents.id, id), eq(residents.facilityId, facilityUser.facilityId)))

    revalidateTag('facilities', {})

    // Return a 1-hour signed URL so the client can display the new photo immediately
    const { data: signedData } = await storage.storage.from(BUCKET).createSignedUrl(path, 3600)
    return Response.json({ data: { path, photoUrl: signedData?.signedUrl ?? null } })
  } catch (err) {
    console.error('[POST /api/residents/[id]/photo] DB error:', err)
    return Response.json({ error: 'Failed to save photo path' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (facilityUser.role !== 'admin' && facilityUser.role !== 'facility_staff') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const resident = await db.query.residents.findFirst({
    where: and(eq(residents.id, id), eq(residents.facilityId, facilityUser.facilityId)),
    columns: { id: true, photoPath: true },
  })
  if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })
  if (!resident.photoPath) return Response.json({ data: { ok: true } })

  const storage = createStorageClient()
  await storage.storage.from(BUCKET).remove([resident.photoPath]).catch(() => {})

  try {
    await db
      .update(residents)
      .set({ photoPath: null })
      .where(and(eq(residents.id, id), eq(residents.facilityId, facilityUser.facilityId)))

    revalidateTag('facilities', {})

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('[DELETE /api/residents/[id]/photo] DB error:', err)
    return Response.json({ error: 'Failed to remove photo' }, { status: 500 })
  }
}
