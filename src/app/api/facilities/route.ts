import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, facilityUsers, profiles } from '@/db/schema'
import { and, eq, sql, asc } from 'drizzle-orm'
import { isTutorialRequest } from '@/lib/help/tutorial-request'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'

const createSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  phone: z.string().max(50).optional(),
  timezone: z.string().max(100).optional(),
})

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isSuperAdmin = !!(
      process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    )

    if (isSuperAdmin) {
      const allFacilities = await db.query.facilities.findMany({
        where: and(eq(facilities.active, true), eq(facilities.isDemo, false)),
        orderBy: [asc(facilities.name)],
      })
      return Response.json({ data: allFacilities.map((f) => ({ ...f, role: 'admin' })) })
    }

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

    const isDemo = isTutorialRequest(request)

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { name, address, phone, timezone } = parsed.data

    // Authorization: facility creation is for genuine onboarding (the user has no
    // facility yet), an existing admin adding another facility, the master admin, or
    // tutorial mode. A non-admin member of an existing facility (stylist / bookkeeper /
    // facility_staff / viewer) must NOT be able to spin up new facilities and self-admin.
    if (!isDemo) {
      const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
      const isMaster = !!superAdminEmail && user.email === superAdminEmail
      if (!isMaster) {
        const memberships = await db.query.facilityUsers.findMany({
          where: (t, { eq }) => eq(t.userId, user.id),
          columns: { role: true },
        })
        const hasAdminRole = memberships.some((m) => m.role === 'admin' || m.role === 'super_admin')
        if (memberships.length > 0 && !hasAdminRole) {
          return Response.json({ error: 'Forbidden' }, { status: 403 })
        }
      }
    }

    // Check for duplicate name (case-insensitive) among active non-demo facilities only
    if (!isDemo) {
      const existing = await db.query.facilities.findFirst({
        where: (t, { and, eq }) => and(
          sql`lower(${t.name}) = lower(${name})`,
          eq(t.active, true),
          eq(t.isDemo, false),
        ),
      })
      if (existing) {
        return Response.json({ error: 'A facility with this name already exists' }, { status: 409 })
      }
    }

    const [facility] = await db
      .insert(facilities)
      .values({
        name,
        address: address ?? null,
        phone: phone ?? null,
        timezone: timezone ?? 'America/New_York',
        isDemo,
      })
      .returning()

    // Ensure profile exists before inserting facilityUsers (FK: facility_users → profiles)
    await db
      .insert(profiles)
      .values({
        id: user.id,
        email: user.email ?? null,
        fullName: user.user_metadata?.full_name ?? null,
        avatarUrl: user.user_metadata?.avatar_url ?? null,
        role: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: profiles.id,
        set: {
          email: user.email ?? null,
          updatedAt: new Date(),
        },
      })

    // Add creator as admin
    await db.insert(facilityUsers).values({
      userId: user.id,
      facilityId: facility.id,
      role: 'admin',
    })

    revalidateTag('facilities', {})

    return Response.json({ data: facility }, { status: 201 })
  } catch (err) {
    console.error('POST /api/facilities error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
