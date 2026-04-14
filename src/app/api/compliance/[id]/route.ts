import { createClient } from '@/lib/supabase/server'
import { createStorageClient, COMPLIANCE_BUCKET } from '@/lib/supabase/storage'
import { db } from '@/db'
import { complianceDocuments, profiles } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const doc = await db.query.complianceDocuments.findFirst({
      where: and(
        eq(complianceDocuments.id, id),
        eq(complianceDocuments.facilityId, facilityId)
      ),
    })
    if (!doc) return Response.json({ error: 'Not found' }, { status: 404 })

    if (facilityUser.role !== 'admin') {
      const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { stylistId: true },
      })
      if (!profile?.stylistId || profile.stylistId !== doc.stylistId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (doc.verified) {
        return Response.json({ error: 'Cannot delete a verified document' }, { status: 403 })
      }
    }

    const storage = createStorageClient()
    const { error: removeErr } = await storage.storage
      .from(COMPLIANCE_BUCKET)
      .remove([doc.fileUrl])
    if (removeErr) console.error('compliance storage remove error:', removeErr)

    await db.delete(complianceDocuments).where(eq(complianceDocuments.id, id))

    return Response.json({ data: { deleted: true } })
  } catch (err) {
    console.error('DELETE /api/compliance/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
