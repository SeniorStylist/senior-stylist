// Count of unread ('new') feedback submissions — drives the master admin
// sidebar badge and the master-admin toolbar pill. Master admin only.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { feedbackSubmissions } from '@/db/schema'
import { ensureFeedbackSchema } from '@/lib/feedback-ddl'
import { eq, count } from 'drizzle-orm'

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!superAdminEmail || user.email !== superAdminEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    await ensureFeedbackSchema()

    const [row] = await db
      .select({ n: count() })
      .from(feedbackSubmissions)
      .where(eq(feedbackSubmissions.status, 'new'))

    return Response.json({ data: { count: row?.n ?? 0 } })
  } catch (err) {
    console.error('GET /api/feedback/count error:', err)
    return Response.json({ data: { count: 0 } })
  }
}
