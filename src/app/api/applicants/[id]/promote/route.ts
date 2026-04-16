import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { applicants, stylists } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { generateStylistCode } from '@/lib/stylist-code'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const franchise = await getUserFranchise(user.id)
    if (!franchise) return Response.json({ error: 'No franchise' }, { status: 400 })

    const { id } = await params

    const applicant = await db.query.applicants.findFirst({
      where: and(
        eq(applicants.id, id),
        eq(applicants.franchiseId, franchise.franchiseId),
        eq(applicants.active, true),
      ),
    })
    if (!applicant) return Response.json({ error: 'Applicant not found' }, { status: 404 })

    const stylist = await db.transaction(async (tx) => {
      const code = await generateStylistCode(tx)

      const [newStylist] = await tx
        .insert(stylists)
        .values({
          stylistCode: code,
          franchiseId: applicant.franchiseId,
          name: applicant.name,
          email: applicant.email,
          phones: applicant.phone
            ? [{ label: 'mobile', number: applicant.phone }]
            : [],
          status: 'active',
          commissionPercent: 0,
          color: '#8B2E4A',
          active: true,
          specialties: [],
        })
        .returning()

      await tx
        .update(applicants)
        .set({ status: 'hired', active: false, updatedAt: new Date() })
        .where(eq(applicants.id, id))

      return newStylist
    })

    return Response.json({ data: { stylistId: stylist.id } })
  } catch (err) {
    console.error('POST /api/applicants/[id]/promote', err)
    return Response.json({ error: 'Promote failed' }, { status: 500 })
  }
}
