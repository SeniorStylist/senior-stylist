// P61 — "what the server sees".
//
// F240 went missing from the owner's facility switcher twice, and both rounds
// were diagnosed by reading code, because nothing in the app could answer the
// only question that mattered: what does the SERVER think this session is?
// This route answers it, and takes an optional facility-code / stylist-code
// lookup that says, in words, why a given record is or isn't visible.
//
// Master-gated. Returns no secrets — it reports whether the owner env var is
// configured and whether the signed-in email matches it, never the value.

import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, facilityUsers, franchises, stylists, stylistFacilityAssignments } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { getUserFacility, isMasterEmail } from '@/lib/get-facility-id'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isMasterEmail(user.email)) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const cookieStore = await cookies()
    const selectedFacilityId = cookieStore.get('selected_facility_id')?.value ?? null
    const debugRaw = cookieStore.get('__debug_role')?.value ?? null
    let debugCookie: unknown = null
    if (debugRaw) {
      try {
        debugCookie = JSON.parse(debugRaw)
      } catch {
        debugCookie = { malformed: true }
      }
    }

    const fu = await getUserFacility(user.id).catch(() => null)

    const membershipRows = await db.query.facilityUsers.findMany({
      where: eq(facilityUsers.userId, user.id),
      with: { facility: { columns: { id: true, name: true, facilityCode: true, active: true, isDemo: true } } },
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    })

    const countRows = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM facilities WHERE active = true AND is_demo = false
    `)
    const activeFacilityCount = Number(
      (countRows as unknown as Array<{ n: number | string }>)[0]?.n ?? 0,
    )

    // The filter that caused the original bug. It should now report
    // applies:false for the owner — if it ever says true again, this is the line
    // that explains a short switcher.
    const hasSuperAdminRole = membershipRows.some((r) => r.role === 'super_admin')
    let franchiseFilter: { applies: boolean; note: string; franchiseName?: string } = {
      applies: false,
      note: 'No super_admin membership row — the franchise filter is not involved.',
    }
    if (hasSuperAdminRole) {
      const franchise = await db.query.franchises.findFirst({
        where: eq(franchises.ownerUserId, user.id),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
        columns: { id: true, name: true },
      })
      franchiseFilter = {
        applies: false,
        franchiseName: franchise?.name,
        note: franchise
          ? `You hold a super_admin row and own the franchise "${franchise.name}". Since P61 the owner is exempt, so your switcher is NOT narrowed to it.`
          : 'You hold a super_admin row but own no franchise, so nothing is filtered.',
      }
    }

    // ---- optional lookups -------------------------------------------------
    const facilityQuery = request.nextUrl.searchParams.get('facility')?.trim()
    const stylistQuery = request.nextUrl.searchParams.get('stylist')?.trim()

    let facilityLookup: unknown = null
    if (facilityQuery) {
      const row = await db.query.facilities.findFirst({
        where: sql`upper(${facilities.facilityCode}) = upper(${facilityQuery}) OR ${facilities.name} ILIKE ${'%' + facilityQuery + '%'}`,
        columns: { id: true, name: true, facilityCode: true, active: true, isDemo: true },
      })
      facilityLookup = row
        ? {
            found: true,
            ...row,
            inYourSwitcher: row.active && !row.isDemo,
            why: !row.active
              ? 'DEACTIVATED — the switcher lists active facilities only.'
              : row.isDemo
                ? 'This is a DEMO facility; the switcher excludes demo facilities (you can still be scoped to it while impersonating).'
                : 'Active and real — it should be in your switcher.',
          }
        : { found: false, why: `No facility matches "${facilityQuery}" by code or name.` }
    }

    let stylistLookup: unknown = null
    if (stylistQuery) {
      const row = await db.query.stylists.findFirst({
        where: sql`upper(${stylists.stylistCode}) = upper(${stylistQuery}) OR ${stylists.name} ILIKE ${'%' + stylistQuery + '%'}`,
        columns: { id: true, name: true, stylistCode: true, active: true, isDemo: true, facilityId: true },
      })
      if (!row) {
        stylistLookup = { found: false, why: `No stylist matches "${stylistQuery}" by code or name.` }
      } else {
        const assignments = await db
          .select({
            facilityId: stylistFacilityAssignments.facilityId,
            active: stylistFacilityAssignments.active,
            name: facilities.name,
            facilityCode: facilities.facilityCode,
          })
          .from(stylistFacilityAssignments)
          .innerJoin(facilities, eq(facilities.id, stylistFacilityAssignments.facilityId))
          .where(eq(stylistFacilityAssignments.stylistId, row.id))

        const home = row.facilityId
          ? await db.query.facilities.findFirst({
              where: eq(facilities.id, row.facilityId),
              columns: { id: true, name: true, facilityCode: true, active: true },
            })
          : null
        const activeAssignments = assignments.filter((a) => a.active)

        // Every roster in the app reads home-row OR active-assignment, so this
        // is the whole visibility rule in one place.
        const visible = (!!home && home.active) || activeAssignments.length > 0
        stylistLookup = {
          found: true,
          id: row.id,
          name: row.name,
          stylistCode: row.stylistCode,
          active: row.active,
          isDemo: row.isDemo,
          homeFacility: home,
          assignments,
          visibleOnRosters: visible && row.active,
          why: !row.active
            ? 'Deactivated — hidden everywhere.'
            : visible
              ? `Visible at: ${[home?.active ? `${home.name} (home)` : null, ...activeAssignments.map((a) => a.name)].filter(Boolean).join(', ')}`
              : 'ORPHANED — no home facility and no active assignment, so no roster can show them. Fix it on Master Admin → Facilities → "belongs to no facility".',
        }
      }
    }

    return Response.json({
      data: {
        email: user.email ?? null,
        ownerEnvVarConfigured: !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL,
        recognisedAsOwner: isMasterEmail(user.email),
        selectedFacilityId,
        debugCookie,
        resolvedFacility: fu
          ? { facilityId: fu.facilityId, role: fu.role, rawRole: fu.rawRole }
          : null,
        memberships: membershipRows.map((r) => ({
          facilityId: r.facilityId,
          role: r.role,
          name: r.facility?.name ?? null,
          facilityCode: r.facility?.facilityCode ?? null,
          active: r.facility?.active ?? null,
          isDemo: r.facility?.isDemo ?? null,
        })),
        activeFacilityCount,
        expectedSwitcherCount: isMasterEmail(user.email) ? activeFacilityCount : membershipRows.length,
        franchiseFilter,
        facilityLookup,
        stylistLookup,
      },
    })
  } catch (err) {
    console.error('GET /api/debug/whoami error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
