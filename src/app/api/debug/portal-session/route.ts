import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { facilities, portalAccounts, portalAccountResidents, residents } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { seedFacilityDemoData } from '@/lib/help/demo-seeder'
import { createPortalSession, setPortalSessionCookie } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

const DEMO_POA_EMAIL = 'demo-poa@example.com'

const schema = z.object({ facilityId: z.string().uuid() })

// Master-admin-only: log the master into the family portal as a FAKE POA (Mrs.
// Margaret Smith's demo account) with demo billing/appointments — no magic link.
// Sets the independent __portal_session cookie; the master's Supabase session is
// untouched. Demo records are is_demo=true (hidden from real facility views).
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.email !== process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'facilityId required' }, { status: 422 })
    const { facilityId } = parsed.data

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { id: true, facilityCode: true },
    })
    if (!facility?.facilityCode) return Response.json({ error: 'Facility has no code' }, { status: 400 })

    // Seed the demo POA + residents + demo invoice/payment/appointment (idempotent).
    await seedFacilityDemoData(facilityId)

    // Find/create the demo portal account.
    let account = await db.query.portalAccounts.findFirst({
      where: eq(portalAccounts.email, DEMO_POA_EMAIL),
      columns: { id: true },
    })
    if (!account) {
      const [created] = await db.insert(portalAccounts).values({ email: DEMO_POA_EMAIL }).returning({ id: portalAccounts.id })
      account = created
    }

    // Link the demo resident(s) at this facility to the account (idempotent).
    const demoResidents = await db.query.residents.findMany({
      where: and(eq(residents.facilityId, facilityId), eq(residents.poaEmail, DEMO_POA_EMAIL), eq(residents.active, true)),
      columns: { id: true },
    })
    for (const r of demoResidents) {
      await db
        .insert(portalAccountResidents)
        .values({ portalAccountId: account.id, residentId: r.id, facilityId })
        .onConflictDoNothing()
    }

    // Start a portal session + set the cookie.
    const token = await createPortalSession(account.id)
    await setPortalSessionCookie(token)

    return Response.json({ data: { facilityCode: facility.facilityCode } })
  } catch (err) {
    console.error('POST /api/debug/portal-session error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
