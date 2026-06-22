import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { services } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'

// Master-admin only: list a facility's existing (real, active) services so the
// bulk price-sheet tool can fuzzy-match scanned rows and compute price/type diffs.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.email !== process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = z.string().uuid().safeParse(request.nextUrl.searchParams.get('facilityId'))
  if (!parsed.success) return Response.json({ error: 'Valid facilityId required' }, { status: 400 })

  try {
    const rows = await db.query.services.findMany({
      where: and(
        eq(services.facilityId, parsed.data),
        eq(services.active, true),
        eq(services.isDemo, false) // is_demo filter — Phase 13
      ),
      columns: {
        id: true,
        name: true,
        priceCents: true,
        durationMinutes: true,
        pricingType: true,
        addonAmountCents: true,
        pricingTiers: true,
        pricingOptions: true,
      },
    })
    return Response.json({ data: rows })
  } catch (err) {
    console.error('[facility-services] error:', err)
    return Response.json({ error: 'Failed to load services' }, { status: 500 })
  }
}
