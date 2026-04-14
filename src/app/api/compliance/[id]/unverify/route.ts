import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { complianceDocuments } from '@/db/schema'
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

    const [document] = await db
      .update(complianceDocuments)
      .set({ verified: false, verifiedBy: null, verifiedAt: null })
      .where(
        and(
          eq(complianceDocuments.id, id),
          eq(complianceDocuments.facilityId, facilityId)
        )
      )
      .returning()

    if (!document) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data: { document } })
  } catch (err) {
    console.error('PUT /api/compliance/[id]/unverify error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
