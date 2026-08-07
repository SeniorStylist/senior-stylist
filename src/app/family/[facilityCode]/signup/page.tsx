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
  let masterPreview = false
  if (!facility.portalSelfSignupEnabled) {
    // P51 — master-only PREVIEW of the wizard when self-signup is off (the
    // Debug tab's "Family Sign-Up Wizard (preview)" row). The email comes from
    // the authenticated Supabase session server-side — nothing client-supplied.
    // POST /api/portal/signup keeps its own 403 when the flag is off, so
    // submissions stay disabled either way.
    try {
      const { getAuthUser } = await import('@/lib/supabase/server')
      const user = await getAuthUser()
      masterPreview =
        !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
        user?.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    } catch {
      masterPreview = false
    }
    if (!masterPreview) {
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
  }

  return (
    <div className="page-enter flex flex-col gap-4 mt-6">
      {masterPreview && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          ⚠ Preview mode — self-signup is OFF for this facility. Families can&apos;t see this page,
          and submissions are disabled.
        </div>
      )}
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
