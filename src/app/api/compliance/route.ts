import { createClient } from '@/lib/supabase/server'
import { createStorageClient, COMPLIANCE_BUCKET } from '@/lib/supabase/storage'
import { db } from '@/db'
import { complianceDocuments, profiles } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { and, desc, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const stylistId = request.nextUrl.searchParams.get('stylistId')
    if (!stylistId) return Response.json({ error: 'stylistId required' }, { status: 422 })

    if (facilityUser.role !== 'admin') {
      const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { stylistId: true },
      })
      if (!profile?.stylistId || profile.stylistId !== stylistId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const docs = await db.query.complianceDocuments.findMany({
      where: and(
        eq(complianceDocuments.stylistId, stylistId),
        eq(complianceDocuments.facilityId, facilityId)
      ),
      orderBy: [desc(complianceDocuments.uploadedAt)],
    })

    const storage = createStorageClient()
    const documents = await Promise.all(
      docs.map(async (doc) => {
        const { data, error } = await storage.storage
          .from(COMPLIANCE_BUCKET)
          .createSignedUrl(doc.fileUrl, 3600)
        if (error) console.error('signed URL error:', error)
        return { ...doc, signedUrl: data?.signedUrl ?? null }
      })
    )

    return Response.json({ data: { documents } })
  } catch (err) {
    console.error('GET /api/compliance error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
