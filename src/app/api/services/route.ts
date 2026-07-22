import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { services } from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { isTutorialRequest, isTutorialModeActive } from '@/lib/help/tutorial-request'

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
  // P41 — master admin only: target ANY active facility. IGNORED otherwise.
  facilityId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  priceCents: z.number().int().min(0).max(10_000_000),
  durationMinutes: z.number().int().positive().max(1440),
  description: z.string().max(2000).optional(),
  color: z.string().max(20).optional(),
  pricingType: z.enum(['fixed', 'addon', 'tiered', 'multi_option']).default('fixed'),
  addonAmountCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  pricingTiers: z.array(pricingTierSchema).max(20).nullable().optional(),
  pricingOptions: z.array(pricingOptionSchema).max(20).nullable().optional(),
}).refine((data) => {
  if (data.pricingType === 'addon' && !data.addonAmountCents) return false
  if (data.pricingType === 'tiered' && (!data.pricingTiers || data.pricingTiers.length === 0)) return false
  if (data.pricingType === 'multi_option' && (!data.pricingOptions || data.pricingOptions.length === 0)) return false
  return true
}, { message: 'Missing pricing data for selected pricing type' })

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    // Visibility: by default only the real price-list catalog (source='price_list').
    // Ad-hoc bookkeeper-created services (source='ocr_import') are hidden from families,
    // staff and scheduling — they surface only where ?includeAdhoc=1 is passed (the
    // /services "show bookkeeper-added" admin toggle).
    const includeAdhoc = request.nextUrl.searchParams.get('includeAdhoc') === '1'

    // is_demo filter — Phase 13. Demo-only during a scripted tour; real-only otherwise.
    const tut = await isTutorialModeActive()
    const data = await db.query.services.findMany({
      where: and(
        eq(services.facilityId, facilityId),
        eq(services.active, true),
        eq(services.isDemo, tut),
        includeAdhoc ? undefined : eq(services.source, 'price_list'),
      ),
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

    // P41 — master admin creates services at ANY active facility via body
    // facilityId; other callers' facility is authoritative (field IGNORED).
    // Master ≈ admin: real price_list services, never ad-hoc.
    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const facilityUser = isMaster ? null : await getUserFacility(user.id)
    if (!isMaster && !facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    // Bookkeepers AND stylists (P37) may create services too, but ONLY as ad-hoc
    // logging services (source='ocr_import', plain fixed pricing) — the same trusted
    // first-class create the OCR importer already does. Stylists need it for walk-ins
    // with services missing from the catalog ("S/B Dry $45") and the daily-log edit
    // form's "➕ New service". Admin/facility_staff create real catalog (price_list)
    // services with full pricing options.
    const isAdhocRole = !isMaster && (facilityUser!.role === 'bookkeeper' || facilityUser!.role === 'stylist')
    if (
      facilityUser &&
      !isAdminOrAbove(facilityUser.role) &&
      !isFacilityStaff(facilityUser.role) &&
      !isAdhocRole
    ) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      const i = parsed.error.issues[0]
      return Response.json({ error: `Invalid data — ${i?.message ?? 'check your input'}` }, { status: 422 })
    }

    let facilityId: string
    if (isMaster) {
      const targetId = parsed.data.facilityId
      if (!targetId) return Response.json({ error: 'facilityId is required for master admin' }, { status: 422 })
      const { facilities } = await import('@/db/schema')
      const target = await db.query.facilities.findFirst({
        where: and(eq(facilities.id, targetId), eq(facilities.active, true)),
        columns: { id: true },
      })
      if (!target) return Response.json({ error: 'Facility not found' }, { status: 404 })
      facilityId = target.id
    } else {
      facilityId = facilityUser!.facilityId
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
        // ad-hoc (bookkeeper/stylist) services are always plain fixed-price logging entries
        priceCents,
        durationMinutes,
        description: isAdhocRole ? null : description ?? null,
        color: isAdhocRole ? null : color ?? null,
        pricingType: isAdhocRole ? 'fixed' : pricingType,
        addonAmountCents: isAdhocRole ? null : addonAmountCents ?? null,
        pricingTiers: isAdhocRole ? null : pricingTiers ?? null,
        pricingOptions: isAdhocRole ? null : pricingOptions ?? null,
        source: isAdhocRole ? 'ocr_import' : 'price_list',
        isDemo: isTutorialRequest(request), // Phase 13 — tutorial-created service
      })
      .returning()

    return Response.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/services error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
