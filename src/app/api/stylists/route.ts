import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylists } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const createSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
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

    const data = await db.query.stylists.findMany({
      where: and(eq(stylists.facilityId, facilityId), eq(stylists.active, true)),
      orderBy: (t, { asc }) => [asc(t.name)],
    })

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/stylists error:', err)
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

    const { name, color } = parsed.data

    const [created] = await db
      .insert(stylists)
      .values({ facilityId, name, ...(color ? { color } : {}) })
      .returning()

    return Response.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/stylists error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
