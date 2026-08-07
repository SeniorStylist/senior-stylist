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
  // F-code — honored ONLY for the master admin (ignored for everyone else);
  // lets "F240 - Arden Courts Fair Oaks" be created in one step.
  facilityCode: z.string().trim().toUpperCase().regex(/^F\d{2,5}$/).optional(),
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
      const i = parsed.error.issues[0]
      return Response.json({ error: `Invalid data — ${i?.message ?? 'check your input'}` }, { status: 422 })
    }

    const { name, address, phone, timezone } = parsed.data

    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const isMaster = !!superAdminEmail && user.email === superAdminEmail

    // Authorization: facility creation is for genuine onboarding (the user has no
    // facility yet), an existing admin adding another facility, the master admin,
    // a bookkeeper (round 6 — they onboard new facilities from log sheets; see
    // below: they do NOT get a membership row), or tutorial mode. Other non-admin
    // members (stylist / facility_staff / viewer) must NOT be able to spin up new
    // facilities and self-admin.
    let isBookkeeper = false
    if (!isDemo && !isMaster) {
      const memberships = await db.query.facilityUsers.findMany({
        where: (t, { eq }) => eq(t.userId, user.id),
        columns: { role: true },
      })
      const hasAdminRole = memberships.some((m) => m.role === 'admin' || m.role === 'super_admin')
      isBookkeeper = !hasAdminRole && memberships.some((m) => m.role === 'bookkeeper')
      if (memberships.length > 0 && !hasAdminRole && !isBookkeeper) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Check for duplicate name (case-insensitive) among non-demo facilities
    if (!isDemo) {
      const existing = await db.query.facilities.findFirst({
        where: (t, { and, eq }) => and(
          sql`lower(${t.name}) = lower(${name})`,
          eq(t.isDemo, false),
        ),
        columns: { id: true, active: true },
      })
      if (existing) {
        const msg = existing.active
          ? 'A facility with this name already exists'
          : 'A deactivated facility with this name already exists — contact support to reactivate it or use a slightly different name'
        return Response.json({ error: msg }, { status: 409 })
      }
    }

    // F-code: master + bookkeeper (ignored for other callers); reject a code
    // already held by an active facility (no DB unique constraint on facility_code).
    const facilityCode = (isMaster || isBookkeeper) && !isDemo ? parsed.data.facilityCode ?? null : null
    if (facilityCode) {
      const codeClash = await db.query.facilities.findFirst({
        where: (t, { and, eq }) => and(
          sql`upper(${t.facilityCode}) = ${facilityCode}`,
          eq(t.active, true),
        ),
        columns: { id: true, name: true },
      })
      if (codeClash) {
        return Response.json(
          { error: `Code ${facilityCode} is already used by ${codeClash.name}` },
          { status: 409 },
        )
      }
    }

    const [facility] = await db
      .insert(facilities)
      .values({
        name,
        address: address ?? null,
        phone: phone ?? null,
        timezone: timezone ?? 'America/New_York',
        ...(facilityCode ? { facilityCode } : {}),
        isDemo,
      })
      .returning()

    // Bookkeepers keep their single anchor facility_users row — their access to
    // the new facility flows through the role-based cross-facility branches
    // (layout switcher, facilities/select, rosters, ocr import). Inserting an
    // admin membership here would silently escalate them.
    if (!isBookkeeper) {
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
    }

    revalidateTag('facilities', {})

    return Response.json({ data: facility }, { status: 201 })
  } catch (err) {
    console.error('POST /api/facilities error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
