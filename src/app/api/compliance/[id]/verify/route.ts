import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { complianceDocuments, stylists } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function PUT(
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
    if (facilityUser.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { facilityId } = facilityUser

    const doc = await db.query.complianceDocuments.findFirst({
      where: and(
        eq(complianceDocuments.id, id),
        eq(complianceDocuments.facilityId, facilityId)
      ),
    })
    if (!doc) return Response.json({ error: 'Not found' }, { status: 404 })

    const document = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(complianceDocuments)
        .set({ verified: true, verifiedBy: user.id, verifiedAt: new Date() })
        .where(eq(complianceDocuments.id, id))
        .returning()

      const stylistPatch: Partial<typeof stylists.$inferInsert> = { updatedAt: new Date() }
      if (doc.documentType === 'license') {
        if (doc.expiresAt) stylistPatch.licenseExpiresAt = doc.expiresAt
      } else if (doc.documentType === 'insurance') {
        stylistPatch.insuranceVerified = true
        if (doc.expiresAt) stylistPatch.insuranceExpiresAt = doc.expiresAt
      } else if (doc.documentType === 'background_check') {
        stylistPatch.backgroundCheckVerified = true
      }

      if (Object.keys(stylistPatch).length > 1) {
        await tx.update(stylists).set(stylistPatch).where(eq(stylists.id, doc.stylistId))
      }

      return updated
    })

    return Response.json({ data: { document } })
  } catch (err) {
    console.error('PUT /api/compliance/[id]/verify error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
