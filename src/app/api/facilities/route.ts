import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, facilityUsers, franchiseFacilities, profiles } from '@/db/schema'
import { and, eq, sql, asc } from 'drizzle-orm'
import { isTutorialRequest } from '@/lib/help/tutorial-request'
import { FACILITY_CODE_RE, generateFacilityCode } from '@/lib/facility-code'
import { getUserFranchise } from '@/lib/get-facility-id'
import { sanitizeFacility } from '@/lib/sanitize'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'

// P60 — the New-Facility wizard's create contract. Everything a launch-ready
// facility needs can land in ONE create: basics, hours, billing type, the
// autopay rule, rev-share (master only). Fields a caller isn't allowed to set
// are silently dropped (house pattern), never 403'd.
const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().max(500).optional(),
  phone: z.string().max(50).optional(),
  contactEmail: z.string().trim().toLowerCase().email().max(320).optional(),
  timezone: z.string().max(100).optional(),
  // F-code — honored ONLY for the master admin + bookkeepers (ignored for
  // everyone else); omitted → generated (F-next) for every non-demo create.
  facilityCode: z.string().trim().toUpperCase().regex(FACILITY_CODE_RE).optional(),
  workingHours: z
    .object({
      days: z.array(z.string().max(3)).max(7),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
    })
    .optional(),
  paymentType: z.enum(['facility', 'ip', 'rfms', 'hybrid']).optional(),
  revSharePercentage: z.number().int().min(0).max(100).nullable().optional(), // master only
  qbRevShareType: z.enum(['we_deduct', 'they_pay']).optional(), // master only
  autopayMode: z.enum(['manual', 'on_completion']).optional(),
  autopaySweepCadence: z.enum(['off', 'nightly', 'biweekly', 'monthly']).optional(),
  // master/bookkeeper: create even though a DEACTIVATED facility has this name
  allowInactiveNameMatch: z.boolean().optional(),
})

class CreateConflict extends Error {
  constructor(public payload: Record<string, unknown>) {
    super('conflict')
  }
}

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

    const { name, address, phone, contactEmail, timezone, workingHours, paymentType } = parsed.data

    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const isMaster = !!superAdminEmail && user.email === superAdminEmail

    // Authorization: facility creation is for genuine onboarding (the user has no
    // facility yet), an existing admin adding another facility, the master admin,
    // a bookkeeper (round 6 — they onboard new facilities from log sheets; see
    // below: they do NOT get a membership row), or tutorial mode. Other non-admin
    // members (stylist / facility_staff / viewer) must NOT be able to spin up new
    // facilities and self-admin.
    let isBookkeeper = false
    let isFranchiseAdmin = false
    if (!isDemo && !isMaster) {
      const memberships = await db.query.facilityUsers.findMany({
        where: (t, { eq }) => eq(t.userId, user.id),
        columns: { role: true },
      })
      const hasAdminRole = memberships.some((m) => m.role === 'admin' || m.role === 'super_admin')
      isBookkeeper = !hasAdminRole && memberships.some((m) => m.role === 'bookkeeper')
      isFranchiseAdmin = memberships.some((m) => m.role === 'super_admin')
      if (memberships.length > 0 && !hasAdminRole && !isBookkeeper) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
    // P60 — a franchise admin's new facility is auto-linked to their franchise;
    // without it they'd lose franchise scope the moment they switched into it.
    const franchise = isFranchiseAdmin ? await getUserFranchise(user.id) : null

    const canSetCode = (isMaster || isBookkeeper) && !isDemo
    const canSetRevShare = isMaster && !isDemo
    const canSetAutopay = !isBookkeeper && !isDemo

    const result = await db.transaction(async (tx) => {
      // Duplicate name (case-insensitive) among non-demo facilities. Active →
      // hard 409 with the conflicting row so the UI can offer "Open it";
      // deactivated → 409 unless a master/bookkeeper explicitly overrides
      // (the UI offers "reactivate instead" first).
      if (!isDemo) {
        const existing = await tx.query.facilities.findFirst({
          where: (t, { and, eq }) => and(sql`lower(${t.name}) = lower(${name})`, eq(t.isDemo, false)),
          columns: { id: true, name: true, facilityCode: true, active: true },
        })
        if (existing) {
          const override = parsed.data.allowInactiveNameMatch === true && (isMaster || isBookkeeper)
          if (existing.active || !override) {
            throw new CreateConflict({
              error: existing.active
                ? `${existing.name} already exists${existing.facilityCode ? ` (${existing.facilityCode})` : ''}`
                : `A deactivated facility named ${existing.name} already exists`,
              conflict: {
                id: existing.id,
                name: existing.name,
                facilityCode: existing.facilityCode,
                active: existing.active,
              },
            })
          }
        }
      }

      // F-code: explicit (master/bookkeeper) is clash-checked against ACTIVE
      // facilities; otherwise EVERY non-demo create gets the next free code so
      // the family sign-up poster works immediately (a facility without a
      // code has no poster and no Signage template — silently).
      let facilityCode: string | null = null
      let codeWasGenerated = false
      if (!isDemo) {
        const wanted = canSetCode ? parsed.data.facilityCode ?? null : null
        if (wanted) {
          const clash = await tx.query.facilities.findFirst({
            where: (t, { and, eq }) => and(sql`upper(${t.facilityCode}) = ${wanted}`, eq(t.active, true)),
            columns: { id: true, name: true },
          })
          if (clash) {
            throw new CreateConflict({
              error: `Code ${wanted} is already used by ${clash.name}`,
              suggestedCode: await generateFacilityCode(tx),
            })
          }
          facilityCode = wanted
        } else {
          facilityCode = await generateFacilityCode(tx)
          codeWasGenerated = true
        }
      }

      const [facility] = await tx
        .insert(facilities)
        .values({
          name,
          address: address ?? null,
          phone: phone ?? null,
          contactEmail: contactEmail ?? null,
          timezone: timezone ?? 'America/New_York',
          ...(workingHours ? { workingHours } : {}),
          ...(paymentType ? { paymentType } : {}),
          ...(canSetRevShare && parsed.data.revSharePercentage !== undefined
            ? { revSharePercentage: parsed.data.revSharePercentage }
            : {}),
          ...(canSetRevShare && parsed.data.qbRevShareType ? { qbRevShareType: parsed.data.qbRevShareType } : {}),
          ...(canSetAutopay && parsed.data.autopayMode ? { autopayMode: parsed.data.autopayMode } : {}),
          ...(canSetAutopay && parsed.data.autopaySweepCadence
            ? { autopaySweepCadence: parsed.data.autopaySweepCadence }
            : {}),
          portalSelfSignupEnabled: true, // P52 — signup on by default; explicit while prod's column default is still false (0035 pending)
          ...(facilityCode ? { facilityCode } : {}),
          isDemo,
        })
        .returning()

      // Bookkeepers keep their single anchor facility_users row — their access to
      // the new facility flows through the role-based cross-facility branches
      // (layout switcher, facilities/select, rosters, ocr import). Inserting an
      // admin membership here would silently escalate them. The master DOES get
      // a row (owner decision, P60) — his switcher + scoping also work without
      // one via the synthetic master access in getUserFacility.
      if (!isBookkeeper) {
        await tx
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
            set: { email: user.email ?? null, updatedAt: new Date() },
          })

        await tx.insert(facilityUsers).values({
          userId: user.id,
          facilityId: facility.id,
          role: isFranchiseAdmin ? 'super_admin' : 'admin',
        })
      }

      if (franchise) {
        await tx
          .insert(franchiseFacilities)
          .values({ franchiseId: franchise.franchiseId, facilityId: facility.id })
          .onConflictDoNothing()
      }

      return { facility, codeWasGenerated }
    })

    revalidateTag('facilities', { expire: 0 })

    return Response.json(
      { data: { ...sanitizeFacility(result.facility), codeWasGenerated: result.codeWasGenerated } },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof CreateConflict) {
      return Response.json(err.payload, { status: 409 })
    }
    // Partial unique index (drizzle/0047) backstop for a concurrent code race
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === '23505') {
      return Response.json({ error: 'That facility code was just taken — try again' }, { status: 409 })
    }
    console.error('POST /api/facilities error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
