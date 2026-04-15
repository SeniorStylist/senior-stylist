import { db } from '@/db'
import { residents, stylists, stylistFacilityAssignments } from '@/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const resident = await db.query.residents.findFirst({
      where: eq(residents.portalToken, token),
      columns: { id: true, facilityId: true },
    })

    if (!resident) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const assigned = await db
      .select({ id: stylistFacilityAssignments.stylistId })
      .from(stylistFacilityAssignments)
      .where(
        and(
          eq(stylistFacilityAssignments.facilityId, resident.facilityId),
          eq(stylistFacilityAssignments.active, true),
        ),
      )
    const assignedIds = assigned.map((r) => r.id)
    if (assignedIds.length === 0) {
      return Response.json({ data: [] })
    }

    const data = await db.query.stylists.findMany({
      where: and(
        inArray(stylists.id, assignedIds),
        eq(stylists.active, true),
        eq(stylists.status, 'active'),
      ),
      columns: { id: true, name: true, color: true, active: true, facilityId: true },
      orderBy: (t, { asc }) => [asc(t.name)],
    })

    return Response.json({ data: JSON.parse(JSON.stringify(data)) })
  } catch (err) {
    console.error('GET /api/portal/[token]/stylists error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
