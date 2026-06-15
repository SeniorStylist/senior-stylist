import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { portalClaimRequests, residents } from '@/db/schema'
import { and, eq, inArray, desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster = user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser && !isMaster) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (facilityUser && facilityUser.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(request.url)
    const status = url.searchParams.get('status') ?? 'pending_review'
    const facilityId = isMaster
      ? (url.searchParams.get('facilityId') ?? null)
      : facilityUser!.facilityId

    const where = facilityId
      ? and(eq(portalClaimRequests.facilityId, facilityId), eq(portalClaimRequests.status, status))
      : eq(portalClaimRequests.status, status)

    const rows = await db.query.portalClaimRequests.findMany({
      where,
      orderBy: [desc(portalClaimRequests.createdAt)],
      columns: {
        id: true,
        facilityId: true,
        facilityCode: true,
        email: true,
        fullName: true,
        phone: true,
        dateOfBirth: true,
        residentId: true,
        matchType: true,
        matchConfidence: true,
        status: true,
        reviewedAt: true,
        notes: true,
        createdAt: true,
      },
    })

    // Enrich with resident name for display
    const residentIds = rows.map((r) => r.residentId).filter((id): id is string => id !== null)
    const residentMap = new Map<string, { name: string; roomNumber: string | null }>()
    if (residentIds.length > 0) {
      const residentRows = await db.query.residents.findMany({
        where: inArray(residents.id, residentIds),
        columns: { id: true, name: true, roomNumber: true },
      })
      for (const r of residentRows) residentMap.set(r.id, r)
    }

    const data = rows.map((r) => ({
      ...r,
      residentName: r.residentId ? (residentMap.get(r.residentId)?.name ?? null) : null,
      residentRoom: r.residentId ? (residentMap.get(r.residentId)?.roomNumber ?? null) : null,
    }))

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/portal/claim-requests error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
