import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylists } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { resolveAvailableStylists, pickStylistWithLeastLoad } from '@/lib/portal-assignment'
import { inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const { searchParams } = new URL(request.url)
    const facilityId = searchParams.get('facilityId')
    const startTimeStr = searchParams.get('startTime')
    const endTimeStr = searchParams.get('endTime')

    if (!facilityId || !startTimeStr || !endTimeStr) {
      return Response.json(
        { error: 'facilityId, startTime, and endTime are required' },
        { status: 422 },
      )
    }

    if (facilityId !== facilityUser.facilityId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const startTime = new Date(startTimeStr)
    const endTime = new Date(endTimeStr)
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      return Response.json({ error: 'Invalid date' }, { status: 422 })
    }
    if (endTime <= startTime) {
      return Response.json({ error: 'endTime must be after startTime' }, { status: 422 })
    }

    const candidates = await resolveAvailableStylists({ facilityId, startTime, endTime })
    if (candidates.length === 0) {
      return Response.json({ data: { available: [], picked: null } })
    }

    const picked = await pickStylistWithLeastLoad(candidates, { facilityId, date: startTime })

    const colorRows = await db
      .select({ id: stylists.id, color: stylists.color })
      .from(stylists)
      .where(
        inArray(
          stylists.id,
          candidates.map((c) => c.id),
        ),
      )
    const colorById = new Map(colorRows.map((r) => [r.id, r.color]))

    const available = candidates.map((c) => ({
      id: c.id,
      name: c.name,
      color: colorById.get(c.id) ?? '#8B2E4A',
    }))
    const pickedWithColor = picked
      ? { id: picked.id, name: picked.name, color: colorById.get(picked.id) ?? '#8B2E4A' }
      : null

    return Response.json({ data: { available, picked: pickedWithColor } })
  } catch (err) {
    console.error('GET /api/stylists/available error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
