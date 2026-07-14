import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { seedFacilityDemoData } from '@/lib/help/demo-seeder'
import { getEffectiveStylistId } from '@/lib/effective-stylist'

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
    // appears in their self-filtered daily log / dashboard. Effective identity
    // (not raw profiles.stylistId) so master-impersonated tours match the
    // log/dashboard scope filters.
    const viewerStylistId = await getEffectiveStylistId(user.id)
    const ids = await seedFacilityDemoData(facilityUser.facilityId, viewerStylistId)
    return Response.json({ data: ids })
  } catch (err) {
    console.error('[seed-demo-data]', err)
    return Response.json({ error: 'Failed to seed demo data' }, { status: 500 })
  }
}
