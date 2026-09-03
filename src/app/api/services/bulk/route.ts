import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { services, facilities } from '@/db/schema'
import { getUserFacility, canEditServices } from '@/lib/get-facility-id'
import { resolveFacilityWrite } from '@/lib/facility-access'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const bulkSchema = z.object({
  facilityId: z.string().uuid().optional(), // P57 — explicit target (wizard)
  rows: z.array(
    z.object({
      name: z.string().min(1),
      priceCents: z.number().transform(Math.round).pipe(z.number().min(0)),
      durationMinutes: z.number().transform(Math.round).pipe(z.number().min(1)).default(30),
      color: z.string().optional(),
      pricingType: z.enum(['fixed', 'addon', 'tiered', 'multi_option']).optional().default('fixed'),
      addonAmountCents: z.number().transform(Math.round).nullable().optional(),
      pricingTiers: z.array(z.object({
        minQty: z.number().transform(Math.round),
        maxQty: z.number().transform(Math.round),
        unitPriceCents: z.number().transform(Math.round),
      })).nullable().optional(),
      pricingOptions: z.array(z.object({
        name: z.string(),
        priceCents: z.number().transform(Math.round),
      })).nullable().optional(),
      category: z.string().nullable().optional(),
    })
  ).min(1).max(500),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = bulkSchema.safeParse(body)
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      return Response.json({ error: `Invalid service data — ${msg}` }, { status: 422 })
    }

    // P57 — an explicit target facility (the New-Facility wizard's Services
    // step; the master has no cookie-scoped facility row). Otherwise the
    // caller's selected facility as before.
    let facilityId: string
    if (parsed.data.facilityId) {
      const access = await resolveFacilityWrite(user, parsed.data.facilityId, { requireManageTier: true })
      if (!access.ok) return Response.json({ error: access.error }, { status: access.status })
      facilityId = access.facilityId
    } else {
      const facilityUser = await getUserFacility(user.id)
      if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
      if (!canEditServices(facilityUser)) return Response.json({ error: 'Forbidden' }, { status: 403 }) // P51 lockdown
      facilityId = facilityUser.facilityId
    }

    const values = parsed.data.rows.map((r) => {
      // Normalize a row whose declared type is missing its required data (an
      // add-on with no amount, or a tiered / multi-option row the import UI
      // couldn't supply structured pricing for) down to a plain fixed-price
      // service. The single-create endpoint hard-rejects these via .refine();
      // bulk import instead normalizes so one bad row never fails a 100-row sheet
      // and no inconsistent record (e.g. tiered with null tiers) is ever inserted.
      let pricingType = r.pricingType
      if (pricingType === 'addon' && !r.addonAmountCents) pricingType = 'fixed'
      if (pricingType === 'tiered' && (!r.pricingTiers || r.pricingTiers.length === 0)) pricingType = 'fixed'
      if (pricingType === 'multi_option' && (!r.pricingOptions || r.pricingOptions.length === 0)) pricingType = 'fixed'
      return {
        facilityId,
        name: r.name.trim(),
        priceCents: pricingType === 'addon' ? 0 : r.priceCents,
        durationMinutes: r.durationMinutes,
        color: r.color || null,
        pricingType,
        addonAmountCents: pricingType === 'addon' ? r.addonAmountCents ?? null : null,
        pricingTiers: pricingType === 'tiered' ? r.pricingTiers ?? null : null,
        pricingOptions: pricingType === 'multi_option' ? r.pricingOptions ?? null : null,
        category: r.category ?? null,
      }
    })

    const inserted = await db
      .insert(services)
      .values(values)
      .onConflictDoNothing()
      .returning()

    try {
      const importOrder: string[] = []
      const seen = new Set<string>()
      for (const r of parsed.data.rows) {
        const c = r.category?.trim()
        if (!c || c === 'Other' || seen.has(c)) continue
        seen.add(c)
        importOrder.push(c)
      }
      if (importOrder.length > 0) {
        const facility = await db.query.facilities.findFirst({
          where: eq(facilities.id, facilityId),
          columns: { serviceCategoryOrder: true },
        })
        const existing = facility?.serviceCategoryOrder ?? []
        const existingSet = new Set(existing)
        const merged = [...existing, ...importOrder.filter((c) => !existingSet.has(c))]
        await db
          .update(facilities)
          .set({ serviceCategoryOrder: merged })
          .where(eq(facilities.id, facilityId))
      }
    } catch (orderErr) {
      console.error('POST /api/services/bulk category-order update failed:', orderErr)
    }

    return Response.json({
      data: {
        created: inserted.length,
        skipped: values.length - inserted.length,
      },
    }, { status: 201 })
  } catch (err) {
    console.error('POST /api/services/bulk error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
