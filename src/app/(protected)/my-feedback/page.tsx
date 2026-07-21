// P37 — "My Feedback": a user's own submissions + replies from the team.
// Reply notifications (bell/push/email) deep-link here. Viewing the page marks
// unread replies read (one UPDATE, best-effort).

import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { feedbackSubmissions } from '@/db/schema'
import { ensureFeedbackSchema } from '@/lib/feedback-ddl'
import { and, desc, eq, isNull, isNotNull, sql } from 'drizzle-orm'
import { MyFeedbackClient } from './my-feedback-client'

export default async function MyFeedbackPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  let rows: {
    id: string
    category: string
    message: string
    status: string
    reply: string | null
    repliedAt: Date | null
    replyReadAt: Date | null
    createdAt: Date
  }[] = []
  try {
    await ensureFeedbackSchema()
    rows = await db.query.feedbackSubmissions.findMany({
      where: eq(feedbackSubmissions.userId, user.id),
      orderBy: [desc(feedbackSubmissions.createdAt)],
      limit: 30,
      columns: {
        id: true,
        category: true,
        message: true,
        status: true,
        reply: true,
        repliedAt: true,
        replyReadAt: true,
        createdAt: true,
      },
    })

    // Mark unread replies as read — the page render IS the read receipt.
    if (rows.some((r) => r.reply && !r.replyReadAt)) {
      await db
        .update(feedbackSubmissions)
        .set({ replyReadAt: sql`now()` })
        .where(
          and(
            eq(feedbackSubmissions.userId, user.id),
            isNotNull(feedbackSubmissions.reply),
            isNull(feedbackSubmissions.replyReadAt),
          ),
        )
    }
  } catch (err) {
    console.error('[my-feedback] load failed:', err)
  }

  return (
    <MyFeedbackClient
      items={rows.map((r) => ({
        id: r.id,
        category: r.category,
        message: r.message,
        status: r.status,
        reply: r.reply,
        repliedAt: r.repliedAt?.toISOString() ?? null,
        unread: !!r.reply && !r.replyReadAt,
        createdAt: r.createdAt.toISOString(),
      }))}
    />
  )
}
