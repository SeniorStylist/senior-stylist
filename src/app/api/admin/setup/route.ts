import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, facilityUsers, services, residents, stylists, profiles } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { generateStylistCode } from '@/lib/stylist-code'

export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user already has a facility — treat any error as "no existing facility"
    let existing = null
    try {
      existing = await db.query.facilityUsers.findFirst({
        where: eq(facilityUsers.userId, user.id),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[setup] facilityUsers check failed (treating as no facility):', message)
    }

    if (existing) {
      return Response.json({
        data: {
          facilityId: existing.facilityId,
          message: 'Already set up',
        },
      })
    }

    // Upsert profile first (required before inserting facilityUsers)
    await db
      .insert(profiles)
      .values({
        id: user.id,
        email: user.email ?? null,
        fullName: user.user_metadata?.full_name ?? null,
        avatarUrl: user.user_metadata?.avatar_url ?? null,
        role: 'admin',
      })
      .onConflictDoUpdate({
        target: profiles.id,
        set: {
          email: user.email ?? null,
          fullName: user.user_metadata?.full_name ?? null,
          avatarUrl: user.user_metadata?.avatar_url ?? null,
          updatedAt: new Date(),
        },
      })

    const [facility] = await db
      .insert(facilities)
      .values({
        name: 'Sunrise Senior Living',
        timezone: 'America/New_York',
      })
      .returning()

    await db.insert(facilityUsers).values({
      userId: user.id,
      facilityId: facility.id,
      role: 'admin',
    })

    await db.insert(services).values([
      {
        facilityId: facility.id,
        name: 'Haircut',
        priceCents: 3500,
        durationMinutes: 30,
        color: '#0D7377',
      },
      {
        facilityId: facility.id,
        name: 'Shampoo & Set',
        priceCents: 4500,
        durationMinutes: 45,
        color: '#7C3AED',
      },
      {
        facilityId: facility.id,
        name: 'Color Touch-up',
        priceCents: 6500,
        durationMinutes: 60,
        color: '#DC2626',
      },
      {
        facilityId: facility.id,
        name: 'Permanent Wave',
        priceCents: 8500,
        durationMinutes: 90,
        color: '#D97706',
      },
      {
        facilityId: facility.id,
        name: 'Conditioning Treatment',
        priceCents: 2500,
        durationMinutes: 30,
        color: '#059669',
      },
    ]).onConflictDoNothing()

    await db.insert(residents).values([
      { facilityId: facility.id, name: 'Mary Collins', roomNumber: '12' },
      { facilityId: facility.id, name: 'Robert Hill', roomNumber: '7' },
      { facilityId: facility.id, name: 'Evelyn Diaz', roomNumber: '24' },
      { facilityId: facility.id, name: 'Dorothy Pierce', roomNumber: '31' },
      { facilityId: facility.id, name: 'Harold Bennett', roomNumber: '9' },
    ]).onConflictDoNothing()

    await db.transaction(async (tx) => {
      const stylistCode = await generateStylistCode(tx)
      await tx.insert(stylists).values({
        facilityId: facility.id,
        stylistCode,
        name: 'Maria Garcia',
        color: '#0D7377',
      }).onConflictDoNothing()
    })

    return Response.json({
      data: {
        facilityId: facility.id,
        message: 'Setup complete! Facility, residents, services, and stylist created.',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[setup] Setup failed:', message)
    if (stack) console.error('[setup] Stack:', stack)
    return Response.json(
      { error: 'Setup failed', details: message },
      { status: 500 }
    )
  }
}
