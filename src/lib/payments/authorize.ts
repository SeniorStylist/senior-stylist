// Dual authorization for resident card-management routes: either the family-portal
// POA whose session includes the resident, OR a billing-capable staff user
// (admin/super_admin own-facility, bookkeeper cross-facility, master any).
// Used by the setup-intent + methods routes. The stylist in-app *collect* route
// (P3) has its own broader auth and does not use this.

import { db } from '@/db'
import { residents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { getPortalSession } from '@/lib/portal-auth'

export interface PaymentActor {
  residentId: string
  facilityId: string
  residentName: string
  poaEmail: string | null
  stripeCustomerId: string | null
  via: 'admin' | 'portal'
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
    if (!fu || !canAccessBilling(fu.role)) return { ok: false, status: 403, error: 'Forbidden' }
    if (fu.role !== 'bookkeeper' && fu.facilityId !== resident.facilityId) {
      return { ok: false, status: 403, error: 'Forbidden' }
    }
  }
  return { ok: true, actor: { ...base, via: 'admin', actorId: user.id, rateKey: `u:${user.id}` } }
}
