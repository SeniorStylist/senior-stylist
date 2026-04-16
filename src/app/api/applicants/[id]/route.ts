import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { applicants } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  status: z.enum(['new', 'reviewing', 'contacting', 'hired', 'rejected']).optional(),
  notes: z.string().max(2000).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
})

async function getApplicantInScope(id: string, franchiseId: string) {
  return db.query.applicants.findFirst({
    where: and(
      eq(applicants.id, id),
      eq(applicants.franchiseId, franchiseId),
      eq(applicants.active, true),
    ),
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const existing = await getApplicantInScope(id, franchise.franchiseId)
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 })

    const [updated] = await db
      .update(applicants)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(applicants.id, id))
      .returning()

    return Response.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/applicants/[id]', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const existing = await getApplicantInScope(id, franchise.franchiseId)
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    await db
      .update(applicants)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(applicants.id, id))

    return Response.json({ data: { deleted: true } })
  } catch (err) {
    console.error('DELETE /api/applicants/[id]', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
