import { db } from '@/db'
import { facilities, services } from '@/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { requirePortalAuth } from '@/lib/portal-auth'
import {
  buildCategoryPriority,
  sortCategoryGroups,
  sortServicesWithinCategory,
} from '@/lib/service-sort'
import { RequestClient } from './request-client'

export const dynamic = 'force-dynamic'

export default async function RequestServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ facilityCode: string }>
  searchParams: Promise<{ residentId?: string }>
}) {
  const { facilityCode } = await params
  const { residentId: searchResidentId } = await searchParams
  const decoded = decodeURIComponent(facilityCode)
  const { residentsAtFacility } = await requirePortalAuth(decoded)
  const selected =
    residentsAtFacility.find((r) => r.residentId === searchResidentId) ?? residentsAtFacility[0]

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, selected.facilityId),
    columns: { id: true, serviceCategoryOrder: true },
  })

  const allServices = await db
    .select({
      id: services.id,
      name: services.name,
      description: services.description,
      priceCents: services.priceCents,
      durationMinutes: services.durationMinutes,
      category: services.category,
      pricingType: services.pricingType,
      addonAmountCents: services.addonAmountCents,
      pricingTiers: services.pricingTiers,
      pricingOptions: services.pricingOptions,
    })
    .from(services)
    .where(and(eq(services.facilityId, selected.facilityId), eq(services.active, true)))
    .orderBy(asc(services.name))

  const grouped = new Map<string, typeof allServices>()
  for (const s of allServices) {
    if (s.pricingType === 'addon') continue
    const cat = s.category ?? 'Other'
    const arr = grouped.get(cat) ?? []
    arr.push(s)
    grouped.set(cat, arr)
  }
  const priority = buildCategoryPriority(facility?.serviceCategoryOrder ?? null)
  const groups = sortCategoryGroups(
    Array.from(grouped.entries()).map(([cat, items]) => [cat, sortServicesWithinCategory(items)] as [string, typeof allServices]),
    priority,
  )

  return (
    <div className="page-enter flex flex-col gap-4">
      <header>
        <h1 className="text-2xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
          Request a service
        </h1>
        <p className="text-sm text-stone-500 mt-1">For {selected.residentName} — we&apos;ll confirm by email or phone.</p>
      </header>

      <RequestClient
        facilityCode={decoded}
        residentId={selected.residentId}
        groups={groups.map(([cat, items]) => ({
          category: cat,
          services: items.map((s) => ({
            id: s.id,
            name: s.name,
            priceCents: s.priceCents,
            pricingType: s.pricingType,
            addonAmountCents: s.addonAmountCents,
            pricingTiers: s.pricingTiers,
            pricingOptions: s.pricingOptions,
          })),
        }))}
      />
    </div>
  )
}
