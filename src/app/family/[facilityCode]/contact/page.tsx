import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { requirePortalAuth } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

export default async function ContactPage({
  params,
}: {
  params: Promise<{ facilityCode: string }>
}) {
  const { facilityCode } = await params
  const decoded = decodeURIComponent(facilityCode)
  const { residentsAtFacility } = await requirePortalAuth(decoded)
  const first = residentsAtFacility[0]

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, first.facilityId),
    columns: { id: true, name: true, address: true, phone: true, contactEmail: true },
  })

  return (
    <div className="page-enter flex flex-col gap-4">
      <header>
        <h1 className="text-2xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
          Contact
        </h1>
        <p className="text-sm text-stone-500 mt-1">Get in touch with us or your facility.</p>
      </header>

      <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
        <h2 className="text-sm font-semibold text-stone-900 mb-2">Senior Stylist</h2>
        <p className="text-sm text-stone-600">2833 Smith Ave Ste 152</p>
        <p className="text-sm text-stone-600">Baltimore, MD 21209</p>
        <div className="mt-3 flex flex-col gap-1.5">
          <a href="tel:443-450-3344" className="text-sm font-semibold text-[#8B2E4A] hover:underline">
            443-450-3344
          </a>
          <a href="mailto:hello@seniorstylist.com" className="text-sm font-semibold text-[#8B2E4A] hover:underline">
            hello@seniorstylist.com
          </a>
          <a href="mailto:pmt@seniorstylist.com" className="text-sm text-stone-500 hover:underline">
            pmt@seniorstylist.com (billing)
          </a>
        </div>
      </section>

      {facility && (
        <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
          <h2 className="text-sm font-semibold text-stone-900 mb-2">{facility.name}</h2>
          {facility.address && <p className="text-sm text-stone-600">{facility.address}</p>}
          <div className="mt-3 flex flex-col gap-1.5">
            {facility.phone && (
              <a href={`tel:${facility.phone}`} className="text-sm font-semibold text-[#8B2E4A] hover:underline">
                {facility.phone}
              </a>
            )}
            {facility.contactEmail && (
              <a href={`mailto:${facility.contactEmail}`} className="text-sm font-semibold text-[#8B2E4A] hover:underline">
                {facility.contactEmail}
              </a>
            )}
            {!facility.phone && !facility.contactEmail && (
              <p className="text-sm text-stone-400">Contact info not on file. Please call Senior Stylist.</p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
