import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { NextRequest } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const schema = z.object({
  revShareType: z.enum(['we_deduct', 'facility_deducts']),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ facilityId: string }> }
) {
  const { facilityId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  if (!isMaster) {
    const fu = await getUserFacility(user.id)
    if (!fu || fu.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (fu.facilityId !== facilityId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid input' }, { status: 400 })
  }

  try {
    await db
      .update(facilities)
      .set({ qbRevShareType: parsed.data.revShareType })
      .where(eq(facilities.id, facilityId))

    return Response.json({ data: { revShareType: parsed.data.revShareType } })
  } catch (err) {
    console.error('[facilities/rev-share] DB error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
