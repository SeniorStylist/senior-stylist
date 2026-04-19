import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { services, facilities } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const bulkSchema = z.object({
  rows: z.array(
    z.object({
      name: z.string().min(1),
      priceCents: z.number().int().min(0),
      durationMinutes: z.number().int().min(1).default(30),
      color: z.string().optional(),
      pricingType: z.enum(['fixed', 'addon', 'tiered', 'multi_option']).optional().default('fixed'),
      addonAmountCents: z.number().int().nullable().optional(),
      pricingTiers: z.array(z.object({
        minQty: z.number().int(),
        maxQty: z.number().int(),
        unitPriceCents: z.number().int(),
      })).nullable().optional(),
      pricingOptions: z.array(z.object({
        name: z.string(),
        priceCents: z.number().int(),
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

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const body = await request.json()
    const parsed = bulkSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const values = parsed.data.rows.map((r) => ({
      facilityId,
      name: r.name.trim(),
      priceCents: r.pricingType === 'addon' ? 0 : r.priceCents,
      durationMinutes: r.durationMinutes,
      color: r.color || null,
      pricingType: r.pricingType,
      addonAmountCents: r.addonAmountCents ?? null,
      pricingTiers: r.pricingTiers ?? null,
      pricingOptions: r.pricingOptions ?? null,
      category: r.category ?? null,
    }))

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
