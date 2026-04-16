import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { applicants } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { and, desc, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import type { ApplicantStatus } from '@/types'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = new Set<string>(['new', 'reviewing', 'contacting', 'hired', 'rejected'])

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const franchise = await getUserFranchise(user.id)
    if (!franchise) return Response.json({ error: 'No franchise' }, { status: 400 })

    const statusParam = req.nextUrl.searchParams.get('status') ?? 'all'

    const where =
      statusParam !== 'all' && VALID_STATUSES.has(statusParam)
        ? and(
            eq(applicants.franchiseId, franchise.franchiseId),
            eq(applicants.active, true),
            eq(applicants.status, statusParam as ApplicantStatus),
          )
        : and(eq(applicants.franchiseId, franchise.franchiseId), eq(applicants.active, true))

    const rows = await db
      .select()
      .from(applicants)
      .where(where)
      .orderBy(desc(applicants.appliedDate))

    return Response.json({ data: { applicants: rows } })
  } catch (err) {
    console.error('GET /api/applicants', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
