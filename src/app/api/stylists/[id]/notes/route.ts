import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylists, stylistNotes, profiles } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { eq, and, desc } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const bodySchema = z.object({
  body: z.string().min(1).max(5000),
})

function isMasterAdmin(email: string | null | undefined) {
  const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  return !!su && email === su
}

async function getAdminAndStylist(stylistId: string, userId: string, master: boolean) {
  const facilityUser = master ? null : await getUserFacility(userId)
  if (!master && !facilityUser) return null
  if (!master && facilityUser!.role !== 'admin') return null

  const franchise = master ? null : await getUserFranchise(userId)
  const allowedFacilityIds =
    franchise?.facilityIds ?? (facilityUser ? [facilityUser.facilityId] : [])

  const stylist = await db.query.stylists.findFirst({ where: eq(stylists.id, stylistId) })
  if (!stylist) return null

  if (!master) {
    const owned =
      (stylist.facilityId && allowedFacilityIds.includes(stylist.facilityId)) ||
      (franchise && stylist.franchiseId === franchise.franchiseId)
    if (!owned) return null
  }

  return { stylist }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const master = isMasterAdmin(user.email)
    const result = await getAdminAndStylist(id, user.id, master)
    if (!result) return Response.json({ error: 'Not found' }, { status: 404 })

    const rows = await db
      .select({
        id: stylistNotes.id,
        stylistId: stylistNotes.stylistId,
        authorUserId: stylistNotes.authorUserId,
        body: stylistNotes.body,
        createdAt: stylistNotes.createdAt,
        updatedAt: stylistNotes.updatedAt,
        authorEmail: profiles.email,
      })
      .from(stylistNotes)
      .innerJoin(profiles, eq(profiles.id, stylistNotes.authorUserId))
      .where(eq(stylistNotes.stylistId, id))
      .orderBy(desc(stylistNotes.createdAt))

    return Response.json({ data: { notes: rows } })
  } catch (err) {
    console.error('GET /api/stylists/[id]/notes error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const master = isMasterAdmin(user.email)
    const facilityUser = master ? null : await getUserFacility(user.id)
    if (!master && !facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!master && facilityUser!.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await getAdminAndStylist(id, user.id, master)
    if (!result) return Response.json({ error: 'Not found' }, { status: 404 })

    const reqBody = await request.json()
    const parsed = bodySchema.safeParse(reqBody)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const [note] = await db
      .insert(stylistNotes)
      .values({
        stylistId: id,
        authorUserId: user.id,
        body: parsed.data.body,
      })
      .returning()

    return Response.json({
      data: {
        note: {
          ...note,
          authorEmail: user.email,
        },
      },
    })
  } catch (err) {
    console.error('POST /api/stylists/[id]/notes error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
