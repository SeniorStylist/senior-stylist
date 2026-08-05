// P36 — family-editable care preferences (style notes, allergies, preferred
// stylist, visit rhythm, reminder opt-ins). Portal-session gated with the same
// cross-resident guard as the contact/tip routes. GET returns the current
// preferences + the facility stylist roster for the preferred-stylist select.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { residents, residentPreferences, stylists, stylistFacilityAssignments } from '@/db/schema'
import { and, eq, inArray, or } from 'drizzle-orm'
import { getPortalSession } from '@/lib/portal-auth'
import { ensureResidentPrefsSchema } from '@/lib/resident-prefs-ddl'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  styleNotes: z.string().max(2000).nullable().optional(),
  allergyNotes: z.string().max(1000).nullable().optional(),
  preferredStylistId: z.string().uuid().nullable().optional(),
  visitFrequency: z.enum(['weekly', 'biweekly', 'monthly']).nullable().optional(),
  emailReminders: z.boolean().optional(),
  smsReminders: z.boolean().optional(),
})

async function facilityRoster(facilityId: string) {
  const assigned = await db
    .select({ stylistId: stylistFacilityAssignments.stylistId })
    .from(stylistFacilityAssignments)
    .where(and(eq(stylistFacilityAssignments.facilityId, facilityId), eq(stylistFacilityAssignments.active, true)))
  const ids = assigned.map((a) => a.stylistId)
  return db
    .select({ id: stylists.id, name: stylists.name })
    .from(stylists)
    .where(
      and(
        eq(stylists.active, true),
        eq(stylists.isDemo, false),
        ids.length > 0 ? or(eq(stylists.facilityId, facilityId), inArray(stylists.id, ids)) : eq(stylists.facilityId, facilityId),
      ),
    )
    .orderBy(stylists.name)
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ residentId: string }> },
) {
  try {
    const { residentId } = await params
    const session = await getPortalSession()
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!session.residents.some((r) => r.residentId === residentId)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    await ensureResidentPrefsSchema()

    const resident = await db.query.residents.findFirst({
      where: eq(residents.id, residentId),
      columns: { facilityId: true },
    })
    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    const [prefs, roster] = [
      await db.query.residentPreferences.findFirst({
        where: eq(residentPreferences.residentId, residentId),
      }),
      await facilityRoster(resident.facilityId),
    ]

    return Response.json({
      data: {
        preferences: prefs
          ? {
              styleNotes: prefs.styleNotes,
              allergyNotes: prefs.allergyNotes,
              preferredStylistId: prefs.preferredStylistId,
              visitFrequency: prefs.visitFrequency,
              emailReminders: prefs.emailReminders,
              smsReminders: prefs.smsReminders,
            }
          : null,
        stylists: roster,
      },
    })
  } catch (err) {
    console.error('GET /api/portal/residents/[id]/preferences error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ residentId: string }> },
) {
  try {
    const { residentId } = await params
    const session = await getPortalSession()
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!session.residents.some((r) => r.residentId === residentId)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const rl = await checkRateLimit('portalProfileUpdate', session.portalAccountId)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })
    const p = parsed.data

    const resident = await db.query.residents.findFirst({
      where: eq(residents.id, residentId),
      columns: { facilityId: true },
    })
    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    // Preferred stylist must actually work at this facility (home OR active
    // assignment — the canonical roster rule).
    if (p.preferredStylistId) {
      const roster = await facilityRoster(resident.facilityId)
      if (!roster.some((s) => s.id === p.preferredStylistId)) {
        return Response.json({ error: 'That stylist does not work at this facility.' }, { status: 422 })
      }
    }

    await ensureResidentPrefsSchema()
    const trim = (v: string | null | undefined) => {
      if (v == null) return null
      const t = v.trim()
      return t.length ? t : null
    }
    // P50-C7 — PARTIAL merge: only fields present in the body are written. The
    // welcome flow and request page send { visitFrequency } alone; a full-reset
    // upsert here would silently wipe style/allergy notes saved on the profile
    // page. The profile page keeps sending the full object — unaffected.
    const set: Partial<typeof residentPreferences.$inferInsert> = { updatedAt: new Date() }
    if (p.styleNotes !== undefined) set.styleNotes = trim(p.styleNotes)
    if (p.allergyNotes !== undefined) set.allergyNotes = trim(p.allergyNotes)
    if (p.preferredStylistId !== undefined) set.preferredStylistId = p.preferredStylistId
    if (p.visitFrequency !== undefined) set.visitFrequency = p.visitFrequency
    if (p.emailReminders !== undefined) set.emailReminders = p.emailReminders
    if (p.smsReminders !== undefined) set.smsReminders = p.smsReminders
    await db
      .insert(residentPreferences)
      .values({
        residentId,
        styleNotes: set.styleNotes ?? null,
        allergyNotes: set.allergyNotes ?? null,
        preferredStylistId: set.preferredStylistId ?? null,
        visitFrequency: set.visitFrequency ?? null,
        emailReminders: set.emailReminders ?? true,
        smsReminders: set.smsReminders ?? true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({ target: residentPreferences.residentId, set })

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/portal/residents/[id]/preferences error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
