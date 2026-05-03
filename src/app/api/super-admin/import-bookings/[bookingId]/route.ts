import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'

export const dynamic = 'force-dynamic'

async function getSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) return null
  return user
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const { bookingId } = await params

    const booking = await db.query.bookings.findFirst({
      where: and(eq(bookings.id, bookingId), eq(bookings.active, true)),
      columns: { id: true },
    })
    if (!booking) {
      return Response.json({ error: 'Booking not found or already removed' }, { status: 404 })
    }

    await db
      .update(bookings)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(bookings.id, bookingId))

    revalidateTag('bookings', {})
    revalidateTag('billing', {})

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('[import-bookings DELETE] error:', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
