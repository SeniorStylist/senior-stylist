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

    // P39 — master admin bypass (supervisor model).
    const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const master = !!su && user.email === su
    const facilityUser = master ? null : await getUserFacility(user.id)
    if (!master && !facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!master && facilityUser!.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [document] = await db
      .update(complianceDocuments)
      .set({ verified: false, verifiedBy: null, verifiedAt: null })
      .where(
        master
          ? eq(complianceDocuments.id, id)
          : and(
              eq(complianceDocuments.id, id),
              eq(complianceDocuments.facilityId, facilityUser!.facilityId)
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
