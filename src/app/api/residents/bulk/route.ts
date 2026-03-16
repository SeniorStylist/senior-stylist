import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { residents } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const bulkSchema = z.object({
  rows: z.array(
    z.object({
      name: z.string().min(1),
      roomNumber: z.string().optional(),
    })
  ).min(1).max(500),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const body = await request.json()
    const parsed = bulkSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    // Insert all rows, skip any that conflict on (name, facilityId)
    const values = parsed.data.rows.map((r) => ({
      facilityId,
      name: r.name.trim(),
      roomNumber: r.roomNumber?.trim() || null,
    }))

    const inserted = await db
      .insert(residents)
      .values(values)
      .onConflictDoNothing()
      .returning()

    return Response.json({
      data: {
        created: inserted.length,
        skipped: values.length - inserted.length,
      },
    }, { status: 201 })
  } catch (err) {
    console.error('POST /api/residents/bulk error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
