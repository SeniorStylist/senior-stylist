import { createClient } from '@/lib/supabase/server'
import { createStorageClient, RESIDENT_PHOTOS_BUCKET } from '@/lib/supabase/storage'
import { db } from '@/db'
import { residents } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin' && facilityUser.role !== 'facility_staff') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: residentId } = await params

    const resident = await db.query.residents.findFirst({
      where: and(eq(residents.id, residentId), eq(residents.facilityId, facilityUser.facilityId), eq(residents.active, true)),
      columns: { id: true, facilityId: true, photoPath: true },
    })
    if (!resident) return Response.json({ error: 'Resident not found' }, { status: 404 })

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return Response.json({ error: 'Missing file' }, { status: 422 })
    if (file.size === 0) return Response.json({ error: 'Empty file' }, { status: 422 })
    if (file.size > MAX_BYTES) return Response.json({ error: 'File exceeds 5MB' }, { status: 422 })
    if (!ALLOWED_MIME.has(file.type)) {
      return Response.json({ error: 'Only JPG, PNG, WebP, HEIC allowed' }, { status: 422 })
    }

    const ext = MIME_EXT[file.type] ?? 'jpg'
    const ts = Date.now()
    const path = `${facilityUser.facilityId}/${residentId}/${ts}.${ext}`

    const storage = createStorageClient()

    // Delete old photo if present
    if (resident.photoPath) {
      await storage.storage.from(RESIDENT_PHOTOS_BUCKET).remove([resident.photoPath]).catch(() => {})
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: uploadError } = await storage.storage
      .from(RESIDENT_PHOTOS_BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: true })
    if (uploadError) {
      console.error('[POST /api/residents/[id]/photo] upload error:', uploadError)
      return Response.json({ error: 'Upload failed' }, { status: 500 })
    }

    await db.update(residents).set({ photoPath: path }).where(eq(residents.id, residentId))

    // Return a short-lived signed URL for immediate display
    const { data: signedData } = await storage.storage
      .from(RESIDENT_PHOTOS_BUCKET)
      .createSignedUrl(path, 3600)

    // Signed URL only — raw storage paths are never returned to clients (documented invariant).
    return Response.json({ data: { photoUrl: signedData?.signedUrl ?? null } })
  } catch (err) {
    console.error('[POST /api/residents/[id]/photo] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin' && facilityUser.role !== 'facility_staff') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: residentId } = await params
    const resident = await db.query.residents.findFirst({
      where: and(eq(residents.id, residentId), eq(residents.facilityId, facilityUser.facilityId)),
      columns: { id: true, photoPath: true },
    })
    if (!resident) return Response.json({ error: 'Resident not found' }, { status: 404 })

    if (resident.photoPath) {
      const storage = createStorageClient()
      await storage.storage.from(RESIDENT_PHOTOS_BUCKET).remove([resident.photoPath]).catch(() => {})
      await db.update(residents).set({ photoPath: null }).where(eq(residents.id, residentId))
    }

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('[DELETE /api/residents/[id]/photo] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
