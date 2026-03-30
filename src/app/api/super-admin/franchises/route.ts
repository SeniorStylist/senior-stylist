import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { franchises, franchiseFacilities, facilityUsers, profiles } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'

async function getSuperAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) return null
  return user
}

export async function GET() {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const data = await db.query.franchises.findMany({
      with: {
        owner: { columns: { email: true, fullName: true } },
        franchiseFacilities: {
          with: { facility: { columns: { id: true, name: true } } },
        },
      },
      orderBy: (t, { asc }) => [asc(t.name)],
    })

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/super-admin/franchises error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const createSchema = z.object({
  name: z.string().min(1),
  ownerEmail: z.string().email(),
  facilityIds: z.array(z.string().uuid()).min(1),
})

export async function POST(request: Request) {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { name, ownerEmail, facilityIds } = parsed.data

    // Look up owner profile by email
    const ownerProfile = await db.query.profiles.findFirst({
      where: eq(profiles.email, ownerEmail),
    })
    if (!ownerProfile) {
      return Response.json({ error: 'No user found with that email' }, { status: 404 })
    }

    await db.transaction(async (tx) => {
      // Create franchise
      const [franchise] = await tx
        .insert(franchises)
        .values({ name, ownerUserId: ownerProfile.id })
        .returning()

      // Create franchise_facilities rows
      await tx.insert(franchiseFacilities).values(
        facilityIds.map((fid) => ({ franchiseId: franchise.id, facilityId: fid }))
      )

      // Upsert facilityUsers rows for owner with role 'super_admin'
      for (const facilityId of facilityIds) {
        await tx
          .insert(facilityUsers)
          .values({ userId: ownerProfile.id, facilityId, role: 'super_admin' })
          .onConflictDoUpdate({
            target: [facilityUsers.userId, facilityUsers.facilityId],
            set: { role: 'super_admin' },
          })
      }
    })

    // Return updated franchise list
    const data = await db.query.franchises.findMany({
      with: {
        owner: { columns: { email: true, fullName: true } },
        franchiseFacilities: {
          with: { facility: { columns: { id: true, name: true } } },
        },
      },
      orderBy: (t, { asc }) => [asc(t.name)],
    })

    return Response.json({ data }, { status: 201 })
  } catch (err) {
    console.error('POST /api/super-admin/franchises error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
