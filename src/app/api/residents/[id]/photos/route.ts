// Phase 16 G11 — resident style gallery + booking photos.
// POST: upload a photo (admin/facility_staff freely; a stylist must attach it to
// a booking THEY own). GET: list with SIGNED URLs only — raw storage paths are
// never returned to clients (documented invariant, same as residents.photo_path).

import { createClient } from '@/lib/supabase/server'
import { createStorageClient, RESIDENT_PHOTOS_BUCKET } from '@/lib/supabase/storage'
import { db } from '@/db'
import { bookings, profiles, residentPhotos, residents } from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { and, desc, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { ensureResidentPhotosSchema } from '@/lib/resident-photos-ddl'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

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
    const { facilityId, role } = facilityUser
    const isStaff = isAdminOrAbove(role) || isFacilityStaff(role)
    if (!isStaff && role !== 'stylist') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const rl = await checkRateLimit('residentPhotos', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    await ensureResidentPhotosSchema()

    const { id: residentId } = await params
    const resident = await db.query.residents.findFirst({
      where: and(eq(residents.id, residentId), eq(residents.facilityId, facilityId), eq(residents.active, true)),
      columns: { id: true, isDemo: true },
    })
    if (!resident) return Response.json({ error: 'Resident not found' }, { status: 404 })

    const form = await request.formData()
    const file = form.get('file')
    const caption = String(form.get('caption') ?? '').slice(0, 300).trim() || null
    const sharedWithFamily = String(form.get('sharedWithFamily') ?? '') === 'true'
    const bookingIdRaw = String(form.get('bookingId') ?? '').trim()
    const bookingId = /^[0-9a-f-]{36}$/.test(bookingIdRaw) ? bookingIdRaw : null

    if (!(file instanceof File)) return Response.json({ error: 'Missing file' }, { status: 422 })
    if (file.size === 0) return Response.json({ error: 'Empty file' }, { status: 422 })
    if (file.size > MAX_BYTES) return Response.json({ error: 'File exceeds 5MB' }, { status: 422 })
    if (!ALLOWED_MIME.has(file.type)) {
      return Response.json({ error: 'Only JPG, PNG, WebP, HEIC allowed' }, { status: 422 })
    }

    // Booking link — must be this resident's booking at this facility. Stylists
    // MUST link a booking they own (that's their only upload path).
    if (bookingId) {
      const booking = await db.query.bookings.findFirst({
        where: and(eq(bookings.id, bookingId), eq(bookings.facilityId, facilityId), eq(bookings.residentId, residentId)),
        columns: { id: true, stylistId: true },
      })
      if (!booking) return Response.json({ error: 'Booking not found' }, { status: 404 })
      if (!isStaff) {
        const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id), columns: { stylistId: true } })
        if (!profile?.stylistId || profile.stylistId !== booking.stylistId) {
          return Response.json({ error: 'Forbidden' }, { status: 403 })
        }
      }
    } else if (!isStaff) {
      return Response.json({ error: 'Attach the photo to one of your bookings' }, { status: 403 })
    }

    const ext = MIME_EXT[file.type] ?? 'jpg'
    const path = `${facilityId}/${residentId}/gallery/${Date.now()}.${ext}`

    // Upload BEFORE the row insert — no orphan rows on failed uploads.
    const storage = createStorageClient()
    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: uploadError } = await storage.storage
      .from(RESIDENT_PHOTOS_BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: true })
    if (uploadError) {
      console.error('[POST /api/residents/[id]/photos] upload error:', uploadError)
      return Response.json({ error: 'Upload failed' }, { status: 500 })
    }

    const [row] = await db
      .insert(residentPhotos)
      .values({
        facilityId,
        residentId,
        bookingId,
        path,
        caption,
        sharedWithFamily,
        createdBy: user.id,
        isDemo: resident.isDemo,
      })
      .returning({ id: residentPhotos.id, caption: residentPhotos.caption, sharedWithFamily: residentPhotos.sharedWithFamily, createdAt: residentPhotos.createdAt })

    const { data: signedData } = await storage.storage.from(RESIDENT_PHOTOS_BUCKET).createSignedUrl(path, 3600)

    return Response.json({ data: { ...row, photoUrl: signedData?.signedUrl ?? null } })
  } catch (err) {
    console.error('[POST /api/residents/[id]/photos] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role === 'viewer') return Response.json({ error: 'Forbidden' }, { status: 403 })

    await ensureResidentPhotosSchema()

    const { id: residentId } = await params
    const resident = await db.query.residents.findFirst({
      where: and(eq(residents.id, residentId), eq(residents.facilityId, facilityUser.facilityId)),
      columns: { id: true },
    })
    if (!resident) return Response.json({ error: 'Resident not found' }, { status: 404 })

    const rows = await db.query.residentPhotos.findMany({
      where: eq(residentPhotos.residentId, residentId),
      orderBy: [desc(residentPhotos.createdAt)],
      limit: 30,
      columns: { id: true, path: true, caption: true, sharedWithFamily: true, bookingId: true, createdAt: true },
    })

    const storage = createStorageClient()
    const data = await Promise.all(
      rows.map(async (r) => {
        const { data: signed } = await storage.storage.from(RESIDENT_PHOTOS_BUCKET).createSignedUrl(r.path, 3600)
        // Signed URL only — the raw storage path never leaves the server.
        return {
          id: r.id,
          caption: r.caption,
          sharedWithFamily: r.sharedWithFamily,
          bookingId: r.bookingId,
          createdAt: r.createdAt,
          photoUrl: signed?.signedUrl ?? null,
        }
      }),
    )

    return Response.json({ data })
  } catch (err) {
    console.error('[GET /api/residents/[id]/photos] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
