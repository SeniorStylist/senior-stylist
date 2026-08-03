// P50-C7 — one-time first-login setup flow for QR-onboarded families:
// save a card → autopay opt-in → visit rhythm, every step skippable.
// Reached from the magic-link verify page when onboarded_at IS NULL;
// finishing or skipping stamps it via POST /api/portal/onboarding-complete.

import { requirePortalAuth } from '@/lib/portal-auth'
import { getPortalT } from '@/lib/portal-i18n-server'
import { platformPublishableKey, platformStripeKey } from '@/lib/payments/stripe-client'
import { WelcomeClient } from './welcome-client'

export const dynamic = 'force-dynamic'

export default async function WelcomePage({
  params,
}: {
  params: Promise<{ facilityCode: string }>
}) {
  const { facilityCode } = await params
  const decoded = decodeURIComponent(facilityCode)
  const { residentsAtFacility } = await requirePortalAuth(decoded)
  const { lang } = await getPortalT()

  const resident = residentsAtFacility[0]
  const stripeConfigured = !!platformStripeKey() && !!platformPublishableKey()

  return (
    <WelcomeClient
      facilityCode={decoded}
      lang={lang}
      residentId={resident.residentId}
      residentName={resident.residentName}
      stripeConfigured={stripeConfigured}
    />
  )
}
