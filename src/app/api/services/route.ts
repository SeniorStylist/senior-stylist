import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { services } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const pricingTierSchema = z.object({
  minQty: z.number().int().min(1),
  maxQty: z.number().int().min(1),
  unitPriceCents: z.number().int().min(0),
})

const pricingOptionSchema = z.object({
  name: z.string().min(1),
  priceCents: z.number().int().min(0),
})

const createSchema = z.object({
  name: z.string().min(1),
  priceCents: z.number().int().min(0),
  durationMinutes: z.number().int().positive(),
  description: z.string().optional(),
  color: z.string().optional(),
  pricingType: z.enum(['fixed', 'addon', 'tiered', 'multi_option']).default('fixed'),
  addonAmountCents: z.number().int().min(0).nullable().optional(),
  pricingTiers: z.array(pricingTierSchema).nullable().optional(),
  pricingOptions: z.array(pricingOptionSchema).nullable().optional(),
}).refine((data) => {
  if (data.pricingType === 'addon' && !data.addonAmountCents) return false
  if (data.pricingType === 'tiered' && (!data.pricingTiers || data.pricingTiers.length === 0)) return false
  if (data.pricingType === 'multi_option' && (!data.pricingOptions || data.pricingOptions.length === 0)) return false
  return true
}, { message: 'Missing pricing data for selected pricing type' })

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const data = await db.query.services.findMany({
      where: and(eq(services.facilityId, facilityId), eq(services.active, true)),
      orderBy: (t, { asc }) => [asc(t.name)],
    })

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/services error:', err)
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

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const {
      name, priceCents, durationMinutes, description, color,
      pricingType, addonAmountCents, pricingTiers, pricingOptions,
    } = parsed.data

    const [created] = await db
      .insert(services)
      .values({
        facilityId,
        name,
        priceCents,
        durationMinutes,
        description: description ?? null,
        color: color ?? null,
        pricingType,
        addonAmountCents: addonAmountCents ?? null,
        pricingTiers: pricingTiers ?? null,
        pricingOptions: pricingOptions ?? null,
      })
      .returning()

    return Response.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/services error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
