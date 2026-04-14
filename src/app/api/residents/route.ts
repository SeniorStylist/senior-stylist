import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { residents } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

const createSchema = z.object({
  name: z.string().min(1).max(200),
  roomNumber: z.string().max(50).optional(),
  phone: z.string().max(50).optional(),
})

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const data = await db.query.residents.findMany({
      where: and(eq(residents.facilityId, facilityId), eq(residents.active, true)),
      orderBy: (t, { asc }) => [asc(t.name)],
    })

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/residents error:', err)
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

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { name, roomNumber, phone } = parsed.data
    const portalToken = crypto.randomBytes(8).toString('hex')

    const [created] = await db
      .insert(residents)
      .values({ facilityId, name, roomNumber: roomNumber ?? null, phone: phone ?? null, portalToken })
      .returning()

    return Response.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/residents error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
