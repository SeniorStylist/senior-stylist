import { createClient } from '@/lib/supabase/server'
import { createStorageClient } from '@/lib/supabase/storage'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { residents } from '@/db/schema'
import { eq, and } from 'drizzle-orm'

const BUCKET = 'resident-photos'

export async function GET(
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

  const resident = await db.query.residents.findFirst({
    where: and(eq(residents.id, id), eq(residents.facilityId, facilityUser.facilityId)),
    columns: { id: true, photoPath: true },
  })
  if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })
  if (!resident.photoPath) return Response.json({ data: { url: null } })

  const storage = createStorageClient()
  const { data, error } = await storage.storage
    .from(BUCKET)
    .createSignedUrl(resident.photoPath, 3600) // 1-hour TTL

  if (error || !data) {
    console.error('[GET /api/residents/[id]/photo-url] Signed URL error:', error)
    return Response.json({ data: { url: null } })
  }

  return Response.json({ data: { url: data.signedUrl } })
}
