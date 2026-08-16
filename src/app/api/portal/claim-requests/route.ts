import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { portalClaimRequests, residents } from '@/db/schema'
import { and, eq, inArray, desc } from 'drizzle-orm'
import { ensurePortalClaimsSchema } from '@/lib/portal-claims-ddl'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    await ensurePortalClaimsSchema()
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

    // P54 — the default review queue is BOTH needs-attention states: legacy
    // pending_review claims AND auto_created ones (uniform account model —
    // resident already live, admin decides keep-or-merge).
    const statuses = status === 'pending_review' ? ['pending_review', 'auto_created'] : [status]
    const where = facilityId
      ? and(eq(portalClaimRequests.facilityId, facilityId), inArray(portalClaimRequests.status, statuses))
      : inArray(portalClaimRequests.status, statuses)

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
        // P50 — what the applicant said about the resident
        residentName: true,
        roomNumber: true,
        relationship: true,
        residentId: true,
        matchType: true,
        matchConfidence: true,
        familyConfirmed: true, // P52 — the family tapped "Yes" on the match card
        mergeSuggestionResidentId: true, // P54 — near-miss for one-tap merge
        status: true,
        reviewedAt: true,
        notes: true,
        createdAt: true,
      },
    })

    // Enrich with resident name for display (linked resident + P54 merge suggestion)
    const residentIds = [
      ...rows.map((r) => r.residentId),
      ...rows.map((r) => r.mergeSuggestionResidentId),
    ].filter((id): id is string => id !== null)
    const residentMap = new Map<string, { name: string; roomNumber: string | null }>()
    if (residentIds.length > 0) {
      const residentRows = await db.query.residents.findMany({
        where: inArray(residents.id, residentIds),
        columns: { id: true, name: true, roomNumber: true },
      })
      for (const r of residentRows) residentMap.set(r.id, r)
    }

    // NOTE: `residentName` (matched-resident, existing consumer contract) vs
    // P50 `claimedResidentName`/`claimedRoom` (what the applicant typed).
    const data = rows.map((r) => ({
      ...r,
      claimedResidentName: r.residentName ?? null,
      claimedRoom: r.roomNumber ?? null,
      residentName: r.residentId ? (residentMap.get(r.residentId)?.name ?? null) : null,
      residentRoom: r.residentId ? (residentMap.get(r.residentId)?.roomNumber ?? null) : null,
      mergeSuggestionName: r.mergeSuggestionResidentId
        ? (residentMap.get(r.mergeSuggestionResidentId)?.name ?? null)
        : null,
      mergeSuggestionRoom: r.mergeSuggestionResidentId
        ? (residentMap.get(r.mergeSuggestionResidentId)?.roomNumber ?? null)
        : null,
    }))

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/portal/claim-requests error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
