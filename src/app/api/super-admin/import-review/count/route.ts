import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings } from '@/db/schema'
import { count, eq, and } from 'drizzle-orm'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const r = await db
      .select({ c: count() })
      .from(bookings)
      .where(and(eq(bookings.needsReview, true), eq(bookings.active, true)))
    return Response.json({ data: { count: r[0]?.c ?? 0 } })
  } catch {
    return Response.json({ data: { count: 0 } })
  }
}
