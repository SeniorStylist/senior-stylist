import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { facilities, franchises, franchiseFacilities, facilityUsers } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { seedFacilityDemoData } from '@/lib/help/demo-seeder'

export const dynamic = 'force-dynamic'

const FRANCHISE_NAME = 'Demo Franchise'
const DEMO_FACILITIES = [
  { code: 'FDEMO1', name: 'Symphony Manor (Demo)', outstandingCents: 42000 },
  { code: 'FDEMO2', name: 'Sunrise of Bethesda (Demo)', outstandingCents: 18500 },
]

const schema = z.object({ teardown: z.boolean().optional() })

// Master-only: one-click self-contained DEMO franchise so the /franchise dashboard
// can be previewed. Creates 2 is_demo facilities, seeds them, groups them in a demo
// franchise, makes the master super_admin, and sets the debug cookie to franchise
// admin on the first. All idempotent. teardown:true removes it.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.email !== process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    // Resolve the two demo facilities (find-by-code, scoped to is_demo).
    const findFac = (code: string) =>
      db.query.facilities.findFirst({ where: and(eq(facilities.facilityCode, code), eq(facilities.isDemo, true)), columns: { id: true } })

    if (parsed.data.teardown) {
      const found = (await Promise.all(DEMO_FACILITIES.map((d) => findFac(d.code)))).filter(Boolean) as { id: string }[]
      const ids = found.map((f) => f.id)
      // Delete the demo franchise (cascades franchise_facilities).
      await db.delete(franchises).where(eq(franchises.name, FRANCHISE_NAME))
      if (ids.length) {
        await db.delete(facilityUsers).where(and(inArray(facilityUsers.facilityId, ids), eq(facilityUsers.userId, user.id)))
        await db.update(facilities).set({ active: false, updatedAt: new Date() }).where(inArray(facilities.id, ids))
      }
      return Response.json({ data: { ok: true } })
    }

    // ── Setup ────────────────────────────────────────────────────────────────
    const facilityIds: string[] = []
    for (const d of DEMO_FACILITIES) {
      let fac = await findFac(d.code)
      if (!fac) {
        const [created] = await db
          .insert(facilities)
          .values({
            name: d.name,
            facilityCode: d.code,
            timezone: 'America/New_York',
            isDemo: true,
            active: true,
            qbOutstandingBalanceCents: d.outstandingCents,
          })
          .returning({ id: facilities.id })
        fac = created
      } else {
        // Re-activate + refresh the sample outstanding on re-run.
        await db.update(facilities).set({ active: true, qbOutstandingBalanceCents: d.outstandingCents, updatedAt: new Date() }).where(eq(facilities.id, fac.id))
      }
      facilityIds.push(fac.id)
      await seedFacilityDemoData(fac.id)
    }

    // Find-or-create the demo franchise (owner = master).
    let franchise = await db.query.franchises.findFirst({ where: eq(franchises.name, FRANCHISE_NAME), columns: { id: true } })
    if (!franchise) {
      const [created] = await db.insert(franchises).values({ name: FRANCHISE_NAME, ownerUserId: user.id }).returning({ id: franchises.id })
      franchise = created
    }

    // Link facilities + make the master super_admin on each (mirrors the franchises route).
    for (const fid of facilityIds) {
      await db.insert(franchiseFacilities).values({ franchiseId: franchise.id, facilityId: fid }).onConflictDoNothing()
      await db
        .insert(facilityUsers)
        .values({ userId: user.id, facilityId: fid, role: 'super_admin' })
        .onConflictDoUpdate({ target: [facilityUsers.userId, facilityUsers.facilityId], set: { role: 'super_admin' } })
    }

    // Drop into the franchise admin view on the first demo facility.
    const cookieStore = await cookies()
    cookieStore.set(
      '__debug_role',
      JSON.stringify({ role: 'super_admin', facilityId: facilityIds[0], facilityName: DEMO_FACILITIES[0].name }),
      { httpOnly: false, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 8 },
    )

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/debug/setup-demo-franchise error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
