import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { services, facilities } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const tier = z.object({
  minQty: z.number().transform(Math.round),
  maxQty: z.number().transform(Math.round),
  unitPriceCents: z.number().transform(Math.round),
})
const option = z.object({ name: z.string(), priceCents: z.number().transform(Math.round) })

// Per-unit services arrive already converted to a single-tier tiered shape from
// the client, so the stored pricing types are just the canonical four.
const pricing = {
  pricingType: z.enum(['fixed', 'addon', 'tiered', 'multi_option']).default('fixed'),
  addonAmountCents: z.number().transform(Math.round).nullable().optional(),
  pricingTiers: z.array(tier).nullable().optional(),
  pricingOptions: z.array(option).nullable().optional(),
}

const createRow = z.object({
  name: z.string().min(1).max(200),
  priceCents: z.number().transform(Math.round),
  durationMinutes: z.number().transform(Math.round).default(30),
  color: z.string().max(20).optional(),
  category: z.string().max(200).nullable().optional(),
  ...pricing,
})
const updateRow = z.object({
  id: z.string().uuid(),
  priceCents: z.number().transform(Math.round),
  durationMinutes: z.number().transform(Math.round).optional(),
  ...pricing,
})
const bodySchema = z.object({
  facilityId: z.string().uuid(),
  create: z.array(createRow).max(500).default([]),
  update: z.array(updateRow).max(500).default([]),
})

// Coerce a pricing shape whose declared type is missing its required data down to
// a plain fixed price — mirrors the bulk-import normalization so no inconsistent
// record (e.g. tiered with null tiers) is ever stored.
function normalizePricing(r: {
  priceCents: number
  pricingType: 'fixed' | 'addon' | 'tiered' | 'multi_option'
  addonAmountCents?: number | null
  pricingTiers?: Array<{ minQty: number; maxQty: number; unitPriceCents: number }> | null
  pricingOptions?: Array<{ name: string; priceCents: number }> | null
}) {
  let pricingType = r.pricingType
  if (pricingType === 'addon' && !r.addonAmountCents) pricingType = 'fixed'
  if (pricingType === 'tiered' && (!r.pricingTiers || r.pricingTiers.length === 0)) pricingType = 'fixed'
  if (pricingType === 'multi_option' && (!r.pricingOptions || r.pricingOptions.length === 0)) pricingType = 'fixed'
  return {
    priceCents: pricingType === 'addon' ? 0 : r.priceCents,
    pricingType,
    addonAmountCents: pricingType === 'addon' ? r.addonAmountCents ?? null : null,
    pricingTiers: pricingType === 'tiered' ? r.pricingTiers ?? null : null,
    pricingOptions: pricingType === 'multi_option' ? r.pricingOptions ?? null : null,
  }
}

// Master-admin only: apply a scanned price sheet to one facility — create the new
// services and overwrite changed prices/types. Never deletes; services not on the
// sheet are left untouched.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.email !== process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    return Response.json({ error: `Invalid request — ${msg}` }, { status: 422 })
  }
  const { facilityId, create, update } = parsed.data

  try {
    const facility = await db.query.facilities.findFirst({
      where: and(eq(facilities.id, facilityId), eq(facilities.active, true), eq(facilities.isDemo, false)),
      columns: { id: true },
    })
    if (!facility) return Response.json({ error: 'Facility not found' }, { status: 404 })

    // IDOR guard: only update services that actually belong to this facility.
    const updateIds = update.map((u) => u.id)
    const owned = updateIds.length
      ? new Set(
          (
            await db.query.services.findMany({
              where: and(eq(services.facilityId, facilityId), inArray(services.id, updateIds)),
              columns: { id: true },
            })
          ).map((s) => s.id)
        )
      : new Set<string>()

    let created = 0
    let updated = 0

    await db.transaction(async (tx) => {
      if (create.length > 0) {
        const values = create.map((r) => ({
          facilityId,
          name: r.name.trim(),
          durationMinutes: r.durationMinutes,
          color: r.color || null,
          category: r.category ?? null,
          ...normalizePricing(r),
        }))
        const inserted = await tx.insert(services).values(values).returning({ id: services.id })
        created = inserted.length
      }

      for (const u of update) {
        if (!owned.has(u.id)) continue
        await tx
          .update(services)
          .set({
            ...normalizePricing(u),
            ...(u.durationMinutes != null ? { durationMinutes: u.durationMinutes } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(services.id, u.id), eq(services.facilityId, facilityId)))
        updated++
      }
    })

    return Response.json({ data: { created, updated } })
  } catch (err) {
    console.error('[price-sheet-apply] error:', err)
    return Response.json({ error: 'Failed to apply price sheet' }, { status: 500 })
  }
}
