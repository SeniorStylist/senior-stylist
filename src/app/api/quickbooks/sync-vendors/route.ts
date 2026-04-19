import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, stylists, stylistFacilityAssignments } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { qbGet, qbPost } from '@/lib/quickbooks'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface QBVendor {
  Id: string
  SyncToken: string
  DisplayName: string
  Active?: boolean
}

export interface SyncVendorsResult {
  created: number
  updated: number
  skipped: number
  errors: Array<{ stylistId: string; stylistName: string; message: string }>
}

export async function syncVendorsForFacility(
  facilityId: string,
  filterStylistIds?: string[],
): Promise<SyncVendorsResult> {
  const result: SyncVendorsResult = { created: 0, updated: 0, skipped: 0, errors: [] }

  const rows = await db
    .select({
      id: stylists.id,
      name: stylists.name,
      email: stylists.email,
      qbVendorId: stylists.qbVendorId,
    })
    .from(stylists)
    .innerJoin(
      stylistFacilityAssignments,
      eq(stylistFacilityAssignments.stylistId, stylists.id),
    )
    .where(
      and(
        eq(stylistFacilityAssignments.facilityId, facilityId),
        eq(stylistFacilityAssignments.active, true),
        eq(stylists.active, true),
      ),
    )

  const scoped = filterStylistIds
    ? rows.filter((r) => filterStylistIds.includes(r.id))
    : rows

  for (const s of scoped) {
    try {
      if (!s.qbVendorId) {
        const payload: Record<string, unknown> = {
          DisplayName: s.name,
          PrintOnCheckName: s.name,
          Active: true,
        }
        if (s.email) payload.PrimaryEmailAddr = { Address: s.email }
        const res = await qbPost<{ Vendor: QBVendor }>(facilityId, '/vendor', payload)
        await db
          .update(stylists)
          .set({ qbVendorId: res.Vendor.Id, updatedAt: new Date() })
          .where(eq(stylists.id, s.id))
        result.created += 1
      } else {
        const existing = await qbGet<{ Vendor: QBVendor }>(
          facilityId,
          `/vendor/${s.qbVendorId}`,
        )
        if (existing.Vendor.DisplayName !== s.name) {
          await qbPost<{ Vendor: QBVendor }>(facilityId, '/vendor', {
            Id: s.qbVendorId,
            SyncToken: existing.Vendor.SyncToken,
            sparse: true,
            DisplayName: s.name,
            PrintOnCheckName: s.name,
          })
          result.updated += 1
        } else {
          result.skipped += 1
        }
      }
    } catch (err) {
      result.errors.push({
        stylistId: s.id,
        stylistName: s.name,
        message: (err as Error).message?.slice(0, 200) ?? 'Unknown error',
      })
    }
  }

  return result
}

export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await checkRateLimit('quickbooksSync', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityUser.facilityId),
      columns: { qbAccessToken: true, qbRealmId: true },
    })
    if (!facility?.qbAccessToken || !facility?.qbRealmId) {
      return Response.json({ error: 'QuickBooks not connected' }, { status: 412 })
    }

    const result = await syncVendorsForFacility(facilityUser.facilityId)
    return Response.json({ data: result })
  } catch (err) {
    console.error('QuickBooks sync-vendors error:', err)
    return Response.json(
      { error: (err as Error).message ?? 'Internal server error' },
      { status: 500 },
    )
  }
}
