import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, importBatches } from '@/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
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
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const { batchId } = await params

    const batch = await db.query.importBatches.findFirst({
      where: and(eq(importBatches.id, batchId), isNull(importBatches.deletedAt)),
      columns: { id: true },
    })
    if (!batch) {
      return Response.json({ error: 'Batch not found or already rolled back' }, { status: 404 })
    }

    let bookingsDeactivated = 0
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(bookings)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(bookings.importBatchId, batchId), eq(bookings.active, true)))
        .returning({ id: bookings.id })
      bookingsDeactivated = updated.length

      await tx
        .update(importBatches)
        .set({ deletedAt: sql`now()` })
        .where(eq(importBatches.id, batchId))
    })

    revalidateTag('bookings', {})
    revalidateTag('billing', {})

    return Response.json({ data: { ok: true, bookingsDeactivated } })
  } catch (err) {
    console.error('[import-batches DELETE] error:', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
