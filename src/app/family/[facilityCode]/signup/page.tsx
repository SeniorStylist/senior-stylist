import { db } from '@/db'
import { activeFacilityByCodeWhere } from '@/lib/facility-code'
import { notFound } from 'next/navigation'
import { SignupClient } from './signup-client'
import { getPortalT } from '@/lib/portal-i18n-server'
import { platformPublishableKey, platformStripeKey, paymentsBlocked } from '@/lib/payments/stripe-client'

export const dynamic = 'force-dynamic'

export default async function SignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ facilityCode: string }>
  searchParams: Promise<{ preview?: string }>
}) {
  const { facilityCode } = await params
  const { preview } = await searchParams
  const decoded = decodeURIComponent(facilityCode)

  const facility = await db.query.facilities.findFirst({
    where: activeFacilityByCodeWhere(decoded), // P53 — case-insensitive + demo-excluded
    columns: { id: true, name: true, facilityCode: true, portalSelfSignupEnabled: true },
  })

  if (!facility) notFound()
  const { lang, t } = await getPortalT()

  // P53 — DRY-RUN MODE (the Debug tab's "Family Sign-Up Wizard (dry run)"):
  // the master runs the FULL wizard — matching, confirm card, submission,
  // real-looking confirmation screen — but the POST's preview branch writes
  // NOTHING (no resident, no POA account, no claim, no emails/bells).
  // The email comes from the authenticated Supabase session server-side —
  // never client-supplied; a non-master's ?preview=1 is silently ignored.
  // The legacy flag-off master preview unifies into the same mode.
  let isMaster = false
  try {
    const { getAuthUser } = await import('@/lib/supabase/server')
    const user = await getAuthUser()
    isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user?.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  } catch {
    isMaster = false
  }
  const previewMode = isMaster && (preview === '1' || !facility.portalSelfSignupEnabled)

  if (!facility.portalSelfSignupEnabled && !previewMode) {
    return (
      <div className="page-enter flex flex-col gap-4 mt-6">
        <header>
          <h1 className="text-2xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
            {t('login.title')}
          </h1>
        </header>
        <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-6 text-center text-stone-600 text-base">
          {t('signup.disabledFacility', { facility: facility.name })}
        </div>
      </div>
    )
  }

  return (
    <div className="page-enter flex flex-col gap-4 mt-6">
      {/* P54 — owner-locked branding: a persistent facility banner across every
          wizard step (this lives in the RSC above the client, so it never
          changes as the family moves through the questions). The marketing
          subtitle is GONE — the page reads: facility → Create Account → wizard. */}
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8B2E4A]">
          {t('signup.facilityEyebrow')}
        </p>
        <p className="text-3xl text-stone-900 leading-tight mt-0.5" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
          {facility.name}
        </p>
        <h1 className="text-lg font-semibold text-stone-600 mt-1.5">
          {t('signup.title')}
        </h1>
      </header>
      {/* P55 (Lisa) — the facility name is the headline; the preview notice
          sits BELOW it, never above. */}
      {previewMode && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          {t('signup.preview.banner')}
        </div>
      )}
      <SignupClient
        facilityCode={facility.facilityCode ?? decoded}
        facilityName={facility.name}
        lang={lang}
        previewMode={previewMode}
        // P57 — BOTH platform keys. Gating on the publishable key alone showed
        // families a card step that could never mint a setup intent (no secret
        // key server-side). Keep identical to the paymentsEnabled expression in
        // /api/portal/signup — that route re-derives the same decision.
        paymentsEnabled={
          !!platformPublishableKey() && !!platformStripeKey() && !paymentsBlocked()
        }
      />
    </div>
  )
}
