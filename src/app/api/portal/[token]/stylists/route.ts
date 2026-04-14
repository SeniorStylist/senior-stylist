import { db } from '@/db'
import { residents, stylists } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
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

    const data = await db.query.stylists.findMany({
      where: and(eq(stylists.facilityId, resident.facilityId), eq(stylists.active, true)),
      columns: { id: true, name: true, color: true, active: true, facilityId: true },
      orderBy: (t, { asc }) => [asc(t.name)],
    })

    return Response.json({ data: JSON.parse(JSON.stringify(data)) })
  } catch (err) {
    console.error('GET /api/portal/[token]/stylists error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
