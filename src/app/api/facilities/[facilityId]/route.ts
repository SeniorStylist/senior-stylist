// P57 — launch settings for an EXPLICIT facility (the New-Facility wizard's
// Launch step). PUT /api/facility is cookie-scoped + bare `role !== 'admin'`,
// which 400s/403s the master mid-wizard; this resolves the caller's right to
// the named facility via resolveFacilityWrite instead.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { revalidateTag } from 'next/cache'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { resolveFacilityWrite } from '@/lib/facility-access'
import { sanitizeFacility } from '@/lib/sanitize'

const patchSchema = z
  .object({
    paymentType: z.enum(['facility', 'ip', 'rfms', 'hybrid']).optional(),
    revSharePercentage: z.number().int().min(0).max(100).nullable().optional(), // master only
    qbRevShareType: z.enum(['we_deduct', 'they_pay']).optional(), // master only
    autopayMode: z.enum(['manual', 'on_completion']).optional(),
    autopaySweepCadence: z.enum(['off', 'nightly', 'biweekly', 'monthly']).optional(),
    contactEmail: z.string().trim().toLowerCase().email().max(320).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ facilityId: string }> }) {
  try {
    const { facilityId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const access = await resolveFacilityWrite(user, facilityId)
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status })
    // Bookkeepers manage stylists/services, not the facility's billing rule
    // (Settings → Billing is admin-gated; don't widen P51 by accident).
    if (access.fu?.role === 'bookkeeper' && !access.isMaster) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 422 })
    }
    const d = parsed.data

    const set: Partial<typeof facilities.$inferInsert> = { updatedAt: new Date() }
    if (d.paymentType !== undefined) set.paymentType = d.paymentType
    if (d.autopayMode !== undefined) set.autopayMode = d.autopayMode
    if (d.autopaySweepCadence !== undefined) set.autopaySweepCadence = d.autopaySweepCadence
    if (d.contactEmail !== undefined) set.contactEmail = d.contactEmail
    // Rev-share is the owner's money rule — master only, silently dropped otherwise.
    if (access.isMaster) {
      if (d.revSharePercentage !== undefined) set.revSharePercentage = d.revSharePercentage
      if (d.qbRevShareType !== undefined) set.qbRevShareType = d.qbRevShareType
    }

    const [row] = await db.update(facilities).set(set).where(eq(facilities.id, facilityId)).returning()
    if (!row) return Response.json({ error: 'Facility not found' }, { status: 404 })

    revalidateTag('facilities', {})
    return Response.json({ data: sanitizeFacility(row) })
  } catch (err) {
    console.error('PATCH /api/facilities/[facilityId] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
