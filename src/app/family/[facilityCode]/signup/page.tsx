import { db } from '@/db'
import { facilities } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { SignupClient } from './signup-client'
import { getPortalT } from '@/lib/portal-i18n-server'

export const dynamic = 'force-dynamic'

export default async function SignupPage({
  params,
}: {
  params: Promise<{ facilityCode: string }>
}) {
  const { facilityCode } = await params
  const decoded = decodeURIComponent(facilityCode)

  const facility = await db.query.facilities.findFirst({
    where: and(eq(facilities.facilityCode, decoded), eq(facilities.active, true)),
    columns: { id: true, name: true, facilityCode: true, portalSelfSignupEnabled: true },
  })

  if (!facility) notFound()
  const { lang, t } = await getPortalT()
  if (!facility.portalSelfSignupEnabled) {
    return (
      <div className="page-enter flex flex-col gap-4 mt-6">
        <header>
          <h1 className="text-2xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
            {t('login.title')}
          </h1>
        </header>
        <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-6 text-center text-stone-600 text-sm">
          {t('signup.disabled')}
        </div>
      </div>
    )
  }

  return (
    <div className="page-enter flex flex-col gap-4 mt-6">
      <header>
        <h1 className="text-2xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
          {t('signup.title')}
        </h1>
        <p className="text-sm text-stone-500 mt-1">{t('signup.subtitle', { facility: facility.name })}</p>
      </header>
      <SignupClient facilityCode={decoded} facilityName={facility.name} lang={lang} />
    </div>
  )
}
