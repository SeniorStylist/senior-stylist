import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { seedFacilityDemoData } from '@/lib/help/demo-seeder'
import { db } from '@/db'
import { profiles } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await checkRateLimit('helpSeed', user.id)
  if (!rl.ok) return rateLimitResponse(rl.retryAfter)

  let facilityUser: Awaited<ReturnType<typeof getUserFacility>>
  try {
    facilityUser = await getUserFacility(user.id)
  } catch {
    return Response.json({ error: 'No facility found' }, { status: 404 })
  }

  if (!facilityUser) return Response.json({ error: 'No facility found' }, { status: 404 })

  try {
    // If the viewer is a stylist, the demo booking is assigned to them so it
    // appears in their self-filtered daily log / dashboard.
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { stylistId: true },
    })
    const ids = await seedFacilityDemoData(facilityUser.facilityId, profile?.stylistId ?? null)
    return Response.json({ data: ids })
  } catch (err) {
    console.error('[seed-demo-data]', err)
    return Response.json({ error: 'Failed to seed demo data' }, { status: 500 })
  }
}
