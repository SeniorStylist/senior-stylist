import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, facilityUsers } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const createSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().optional(),
  timezone: z.string().optional(),
})

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const userFacilities = await db.query.facilityUsers.findMany({
      where: eq(facilityUsers.userId, user.id),
      with: { facility: true },
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    })

    const data = userFacilities.map((fu) => ({
      ...fu.facility,
      role: fu.role,
    }))

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/facilities error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { name, address, phone, timezone } = parsed.data

    const [facility] = await db
      .insert(facilities)
      .values({
        name,
        address: address ?? null,
        phone: phone ?? null,
        timezone: timezone ?? 'America/New_York',
      })
      .returning()

    // Add creator as admin
    await db.insert(facilityUsers).values({
      userId: user.id,
      facilityId: facility.id,
      role: 'admin',
    })

    return Response.json({ data: facility }, { status: 201 })
  } catch (err) {
    console.error('POST /api/facilities error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
