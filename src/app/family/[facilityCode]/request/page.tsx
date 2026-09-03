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
import { getPortalT } from '@/lib/portal-i18n-server'
import { getFacilityWorkingDows } from '@/lib/facility-working-days'

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
  const { lang, t } = await getPortalT()
  const selected =
    residentsAtFacility.find((r) => r.residentId === searchResidentId) ?? residentsAtFacility[0]

  const [facility, allServices, workingDows] = await Promise.all([
    db.query.facilities.findFirst({
      where: eq(facilities.id, selected.facilityId),
      columns: { id: true, serviceCategoryOrder: true },
    }),
    // P57 — source is selected, NOT filtered in SQL, so the fallback below can
    // be decided in one query (max:1 pool: never pay for a second round-trip
    // just to count rows). `source` stays server-side — the client payload at
    // the bottom of this file is still {id, name} only.
    db
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
        source: services.source,
      })
      .from(services)
      .where(
        and(
          eq(services.facilityId, selected.facilityId),
          eq(services.active, true),
          eq(services.isDemo, false), // is_demo filter — Phase 13
        ),
      )
      .orderBy(asc(services.name)),
    // P55 — days a real stylist works here (empty = no restriction)
    getFacilityWorkingDows(selected.facilityId),
  ])

  // Add-ons are never requestable on their own — they ride a real service.
  const bookable = allServices.filter((s) => s.pricingType !== 'addon')
  const priceList = bookable.filter((s) => s.source === 'price_list')
  // P57 — price_list is the preferred catalog, but since P51 a facility
  // admin's own service creations land as 'ocr_import'. A facility whose whole
  // catalog was built that way showed families an EMPTY picker with no way to
  // request anything, so fall back to every active service rather than
  // dead-end them. Preferred set wins whenever it has anything in it.
  const requestable = priceList.length > 0 ? priceList : bookable

  const grouped = new Map<string, typeof allServices>()
  for (const s of requestable) {
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
          {t('request.title')}
        </h1>
        <p className="text-sm text-stone-500 mt-1">{t('request.subtitle', { name: selected.residentName })}</p>
      </header>

      <RequestClient
        facilityCode={decoded}
        lang={lang}
        residentId={selected.residentId}
        residentName={selected.residentName}
        // P54 — owner decision: NO prices on the family request page. The
        // payload is name-only (pricingType stays server-side for the addon
        // filter above; never send pricing fields to this client).
        groups={groups.map(([cat, items]) => ({
          category: cat,
          services: items.map((s) => ({ id: s.id, name: s.name })),
        }))}
        workingDows={workingDows}
      />
    </div>
  )
}
