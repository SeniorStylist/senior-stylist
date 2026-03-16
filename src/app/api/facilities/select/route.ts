import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilityUsers } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const schema = z.object({
  facilityId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    // Verify the user actually belongs to this facility
    const fu = await db.query.facilityUsers.findFirst({
      where: and(
        eq(facilityUsers.userId, user.id),
        eq(facilityUsers.facilityId, parsed.data.facilityId)
      ),
    })
    if (!fu) return Response.json({ error: 'Access denied' }, { status: 403 })

    const cookieStore = await cookies()
    cookieStore.set('selected_facility_id', parsed.data.facilityId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year
    })

    return Response.json({ ok: true })
  } catch (err) {
    console.error('POST /api/facilities/select error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
