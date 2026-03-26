import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { accessRequests } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and, desc } from 'drizzle-orm'
import { z } from 'zod'

const createSchema = z.object({
  facilityId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().optional(),
  userId: z.string().uuid().optional(),
  role: z.enum(['stylist', 'admin', 'viewer']).optional(),
})

// POST — public, no auth required
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { facilityId, email, fullName, userId, role } = parsed.data
    const normalizedEmail = email.toLowerCase().trim()

    // Idempotent: check for existing pending request
    const existing = await db.query.accessRequests.findFirst({
      where: (t) => and(
        eq(t.facilityId, facilityId),
        eq(t.email, normalizedEmail),
        eq(t.status, 'pending')
      ),
    })

    if (existing) {
      return Response.json({ data: { id: existing.id, alreadyExists: true } })
    }

    const [created] = await db
      .insert(accessRequests)
      .values({
        facilityId,
        email: normalizedEmail,
        fullName: fullName ?? null,
        userId: userId ?? null,
        role: role ?? 'stylist',
        status: 'pending',
      })
      .returning()

    return Response.json({ data: { id: created.id } }, { status: 201 })
  } catch (err) {
    console.error('POST /api/access-requests error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET — admin only
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const requests = await db.query.accessRequests.findMany({
      where: (t) => and(
        eq(t.facilityId, facilityUser.facilityId),
        eq(t.status, 'pending')
      ),
      orderBy: (t) => [desc(t.createdAt)],
    })

    return Response.json({ data: requests })
  } catch (err) {
    console.error('GET /api/access-requests error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
