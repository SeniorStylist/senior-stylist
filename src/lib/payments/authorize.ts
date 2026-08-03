// Dual authorization for resident card-management routes: either the family-portal
// POA whose session includes the resident, OR a billing-capable staff user
// (admin/super_admin own-facility, bookkeeper cross-facility, master any).
// Used by the setup-intent + methods routes. The stylist in-app *collect* route
// (P3) has its own broader auth and does not use this.
//
// P50 — third path: via:'stylist'. A stylist may VAULT a card handed over at
// the chair for any resident at a facility where they work (home OR active
// assignment — P33/F228 predicate). Facility scope suffices; no booking
// required (the exact moment is "family hands the card over before any
// booking exists"), and vaulting charges nothing. Consuming routes decide
// what a stylist actor may do: setup-intent + methods GET/POST yes; methods
// PATCH (make-default drives autopay) / DELETE and the autopay routes 403.

import { db } from '@/db'
import { residents, stylists, stylistFacilityAssignments } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { getPortalSession } from '@/lib/portal-auth'
import { getEffectiveStylistId } from '@/lib/effective-stylist'

export interface PaymentActor {
  residentId: string
  facilityId: string
  residentName: string
  poaEmail: string | null
  stripeCustomerId: string | null
  via: 'admin' | 'portal' | 'stylist'
  actorId: string
  rateKey: string
}

export async function authorizeResidentPayment(
  residentId: string,
): Promise<{ ok: true; actor: PaymentActor } | { ok: false; status: number; error: string }> {
  const resident = await db.query.residents.findFirst({
    where: eq(residents.id, residentId),
    columns: { id: true, name: true, facilityId: true, poaEmail: true, stripeCustomerId: true, active: true },
  })
  if (!resident || !resident.active) return { ok: false, status: 404, error: 'Not found' }

  const base = {
    residentId: resident.id,
    facilityId: resident.facilityId,
    residentName: resident.name,
    poaEmail: resident.poaEmail,
    stripeCustomerId: resident.stripeCustomerId,
  }

  // Portal POA path
  const ps = await getPortalSession()
  if (ps && ps.residents.some((r) => r.residentId === residentId)) {
    return { ok: true, actor: { ...base, via: 'portal', actorId: ps.portalAccountId, rateKey: `p:${ps.portalAccountId}` } }
  }

  // Staff path
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' }

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!isMaster) {
    const fu = await getUserFacility(user.id)
    if (!fu) return { ok: false, status: 403, error: 'Forbidden' }

    // P50 — stylist path (chair handover). Identity ALWAYS via
    // getEffectiveStylistId (P30 rule); resident must be at a facility where
    // the stylist works (home OR active assignment).
    if (fu.role === 'stylist') {
      const stylistId = await getEffectiveStylistId(user.id)
      if (!stylistId) {
        return {
          ok: false,
          status: 403,
          error: "Your account isn't linked to a stylist profile yet — ask your admin to link you in Settings → Team.",
        }
      }
      const home = await db.query.stylists.findFirst({
        where: eq(stylists.id, stylistId),
        columns: { facilityId: true },
      })
      const worksHere =
        home?.facilityId === resident.facilityId ||
        !!(await db.query.stylistFacilityAssignments.findFirst({
          where: and(
            eq(stylistFacilityAssignments.stylistId, stylistId),
            eq(stylistFacilityAssignments.facilityId, resident.facilityId),
            eq(stylistFacilityAssignments.active, true),
          ),
          columns: { id: true },
        }))
      if (!worksHere) return { ok: false, status: 403, error: 'Forbidden' }
      return { ok: true, actor: { ...base, via: 'stylist', actorId: user.id, rateKey: `u:${user.id}` } }
    }

    if (!canAccessBilling(fu.role)) return { ok: false, status: 403, error: 'Forbidden' }
    if (fu.role !== 'bookkeeper' && fu.facilityId !== resident.facilityId) {
      return { ok: false, status: 403, error: 'Forbidden' }
    }
  }
  return { ok: true, actor: { ...base, via: 'admin', actorId: user.id, rateKey: `u:${user.id}` } }
}
