import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylists, franchiseFacilities } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { sanitizeStylist, sanitizeStylists } from '@/lib/sanitize'
import { eq, and, or, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { generateStylistCode } from '@/lib/stylist-code'

const createSchema = z.object({
  name: z.string().min(1).max(200),
  color: z.string().max(20).optional(),
  commissionPercent: z.number().int().min(0).max(100).optional(),
  stylistCode: z.string().regex(/^ST\d{3,}$/).optional(),
  facilityId: z.string().uuid().nullable().optional(),
  franchiseId: z.string().uuid().nullable().optional(),
})

function isMasterAdmin(email: string | null | undefined) {
  const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  return !!su && email === su
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const master = isMasterAdmin(user.email)
    const scope = (request.nextUrl.searchParams.get('scope') ?? 'facility') as
      | 'facility'
      | 'franchise'
      | 'all'
    const franchiseIdParam = request.nextUrl.searchParams.get('franchiseId') ?? undefined

    const facilityUser = master ? null : await getUserFacility(user.id)
    if (!master && !facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const isAdmin = master || facilityUser?.role === 'admin'
    const facilityId = facilityUser?.facilityId

    let whereClause
    if (master) {
      if (franchiseIdParam) {
        whereClause = and(eq(stylists.franchiseId, franchiseIdParam), eq(stylists.active, true))
      } else {
        whereClause = eq(stylists.active, true)
      }
    } else if (scope === 'facility') {
      whereClause = and(eq(stylists.facilityId, facilityId!), eq(stylists.active, true))
    } else if (scope === 'franchise') {
      const franchise = await getUserFranchise(user.id)
      if (!franchise) return Response.json({ data: [] })
      whereClause = and(
        eq(stylists.franchiseId, franchise.franchiseId),
        isNull(stylists.facilityId),
        eq(stylists.active, true),
      )
    } else {
      // scope === 'all' → this facility + franchise-pool stylists belonging to the franchise
      const franchise = await getUserFranchise(user.id)
      if (franchise) {
        whereClause = and(
          or(
            eq(stylists.facilityId, facilityId!),
            and(eq(stylists.franchiseId, franchise.franchiseId), isNull(stylists.facilityId)),
          ),
          eq(stylists.active, true),
        )
      } else {
        whereClause = and(eq(stylists.facilityId, facilityId!), eq(stylists.active, true))
      }
    }

    const rows = await db.query.stylists.findMany({
      where: whereClause,
      orderBy: (t, { asc }) => [asc(t.name)],
    })

    const sanitized = sanitizeStylists(rows)
    const data = isAdmin
      ? sanitized
      : sanitized.map((s) => {
          const { commissionPercent: _c, ...rest } = s
          return rest as typeof s
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

    const master = isMasterAdmin(user.email)
    const facilityUser = master ? null : await getUserFacility(user.id)
    if (!master && !facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!master && facilityUser!.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const franchise = await getUserFranchise(user.id)

    // Resolve franchiseId: master admin body → caller's franchise → null
    let franchiseId: string | null = null
    if (master && parsed.data.franchiseId !== undefined) {
      franchiseId = parsed.data.franchiseId
    } else if (franchise) {
      franchiseId = franchise.franchiseId
    }

    // Resolve facilityId
    let facilityId: string | null
    if (parsed.data.facilityId !== undefined) {
      facilityId = parsed.data.facilityId
      // If the caller explicitly sets a facility, it must be one they own
      if (facilityId && !master) {
        const allowedFacilities = franchise?.facilityIds ?? [facilityUser!.facilityId]
        if (!allowedFacilities.includes(facilityId)) {
          return Response.json({ error: 'Facility not in your scope' }, { status: 403 })
        }
      }
    } else {
      facilityId = master ? null : facilityUser!.facilityId
    }

    // If facilityId is set and we don't have a franchiseId, derive from facility
    if (facilityId && !franchiseId) {
      const ff = await db.query.franchiseFacilities.findFirst({
        where: eq(franchiseFacilities.facilityId, facilityId),
      })
      if (ff) franchiseId = ff.franchiseId
    }

    const created = await db.transaction(async (tx) => {
      let stylistCode = parsed.data.stylistCode
      if (stylistCode) {
        // Uniqueness check inside tx
        const clash = await tx
          .select({ id: stylists.id })
          .from(stylists)
          .where(eq(stylists.stylistCode, stylistCode))
          .limit(1)
        if (clash.length) {
          throw new ConflictError('stylist_code already in use')
        }
      } else {
        stylistCode = await generateStylistCode(tx)
      }

      const [row] = await tx
        .insert(stylists)
        .values({
          name: parsed.data.name,
          stylistCode,
          facilityId,
          franchiseId,
          ...(parsed.data.color ? { color: parsed.data.color } : {}),
          ...(parsed.data.commissionPercent != null
            ? { commissionPercent: parsed.data.commissionPercent }
            : {}),
        })
        .returning()
      return row
    })

    return Response.json({ data: sanitizeStylist(created) }, { status: 201 })
  } catch (err) {
    if (err instanceof ConflictError) {
      return Response.json({ error: err.message }, { status: 409 })
    }
    // postgres unique_violation
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === '23505'
    ) {
      return Response.json({ error: 'stylist_code already in use' }, { status: 409 })
    }
    console.error('POST /api/stylists error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

class ConflictError extends Error {}
