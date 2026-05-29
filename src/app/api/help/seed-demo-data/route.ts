import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { seedFacilityDemoData } from '@/lib/help/demo-seeder'

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

  try {
    const ids = await seedFacilityDemoData(facilityUser.facilityId)
    return Response.json({ data: ids })
  } catch (err) {
    console.error('[seed-demo-data]', err)
    return Response.json({ error: 'Failed to seed demo data' }, { status: 500 })
  }
}
