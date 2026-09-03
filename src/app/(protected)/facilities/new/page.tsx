// P57 — /facilities/new: the ONE facility-creation flow (replaces the
// master-admin inline form, Settings → Advanced's form, and /onboarding).
// The role decides which steps render; everything the client needs (code
// directory, stylist directory, franchises) loads here in ONE Promise.all.

import { redirect } from 'next/navigation'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { facilities, facilityUsers, franchiseFacilities, franchises, stylists } from '@/db/schema'
import { getAuthUser } from '@/lib/supabase/server'
import { getUserFacility, getUserFranchise, isManageTier } from '@/lib/get-facility-id'
import { nextFacilityCode } from '@/lib/facility-code'
import { paymentsBlocked, paymentsLiveEnabled, platformPublishableKey, platformStripeKey } from '@/lib/payments/stripe-client'
import { NewFacilityWizard } from '@/components/facilities/new-facility-wizard/new-facility-wizard'
import type { WizardCaps } from '@/components/facilities/new-facility-wizard/wizard-types'

function sanitizeReturnTo(raw: string | undefined, fallback: string): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback
  return raw.length > 300 ? fallback : raw
}

function paymentsStatus(): WizardCaps['paymentsStatus'] {
  const secret = platformStripeKey()
  if (!secret || !platformPublishableKey()) return 'not_configured'
  if (paymentsBlocked()) return 'blocked'
  return secret.startsWith('sk_live_') && paymentsLiveEnabled() ? 'live' : 'test'
}

export default async function NewFacilityPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const isMaster = !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  const fu = await getUserFacility(user.id)

  // Who may create: master, admin-tier members (facility admin / franchise
  // admin), bookkeepers, and a signed-in user with NO membership at all
  // (the old /onboarding first-run case).
  let membershipCount = 0
  if (!fu && !isMaster) {
    const rows = await db.select({ n: sql<number>`count(*)` }).from(facilityUsers).where(eq(facilityUsers.userId, user.id))
    membershipCount = Number(rows[0]?.n ?? 0)
    if (membershipCount > 0) redirect('/dashboard')
  }
  const rawRole: WizardCaps['rawRole'] = isMaster
    ? 'master'
    : fu?.role === 'bookkeeper'
      ? 'bookkeeper'
      : fu?.rawRole === 'super_admin'
        ? 'super_admin'
        : 'admin'
  if (!isMaster && fu && fu.role !== 'admin' && fu.role !== 'bookkeeper') redirect('/dashboard')

  const manage = isMaster || (fu ? isManageTier(fu, isMaster) : false)
  const canEditCode = isMaster || rawRole === 'bookkeeper'
  const { returnTo: rawReturn } = await searchParams
  const returnTo = sanitizeReturnTo(rawReturn, isMaster ? '/master-admin' : '/dashboard')

  const [codeRows, stylistRows, franchiseRows, franchiseLinks, userFranchise] = await Promise.all([
    canEditCode
      ? db
          .select({ id: facilities.id, name: facilities.name, facilityCode: facilities.facilityCode, active: facilities.active })
          .from(facilities)
          .where(eq(facilities.isDemo, false))
          .orderBy(asc(facilities.name))
      : Promise.resolve([] as { id: string; name: string; facilityCode: string | null; active: boolean }[]),
    manage
      ? db
          .select({ id: stylists.id, name: stylists.name, stylistCode: stylists.stylistCode, color: stylists.color, homeFacilityId: stylists.facilityId, franchiseId: stylists.franchiseId })
          .from(stylists)
          .where(and(eq(stylists.active, true), eq(stylists.status, 'active'), eq(stylists.isDemo, false)))
          .orderBy(asc(stylists.name))
      : Promise.resolve([] as { id: string; name: string; stylistCode: string; color: string; homeFacilityId: string | null; franchiseId: string | null }[]),
    isMaster ? db.select({ id: franchises.id, name: franchises.name }).from(franchises).orderBy(asc(franchises.name)) : Promise.resolve([] as { id: string; name: string }[]),
    isMaster ? db.select({ franchiseId: franchiseFacilities.franchiseId, facilityId: franchiseFacilities.facilityId }).from(franchiseFacilities) : Promise.resolve([] as { franchiseId: string; facilityId: string }[]),
    rawRole === 'super_admin' ? getUserFranchise(user.id) : Promise.resolve(null),
  ])

  // Franchise admins staff from their own pool only.
  const stylistDirectory = stylistRows
    .filter((s) => {
      if (rawRole !== 'super_admin') return true
      if (!userFranchise) return false
      return s.franchiseId === userFranchise.franchiseId || (!!s.homeFacilityId && userFranchise.facilityIds.includes(s.homeFacilityId))
    })
    .map(({ franchiseId: _f, ...s }) => s)

  const caps: WizardCaps = {
    isMaster,
    rawRole,
    canEditCode,
    canManageStylists: manage,
    canImportServices: manage,
    canSetRevShare: isMaster,
    canLinkFranchise: isMaster,
    canSetAutopay: rawRole !== 'bookkeeper',
    suggestedCode: canEditCode ? nextFacilityCode(codeRows.map((r) => r.facilityCode).filter((c): c is string => !!c)) : '',
    codeDirectory: codeRows.filter((r) => !!r.facilityCode).map((r) => ({ code: r.facilityCode as string, name: r.name, active: r.active })),
    nameDirectory: codeRows.map((r) => ({ id: r.id, name: r.name, facilityCode: r.facilityCode, active: r.active })),
    stylistDirectory,
    franchises: franchiseRows.map((f) => ({ id: f.id, name: f.name, facilityIds: franchiseLinks.filter((l) => l.franchiseId === f.id).map((l) => l.facilityId) })),
    paymentsStatus: paymentsStatus(),
    returnTo,
  }

  return <NewFacilityWizard caps={caps} />
}
