import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { feedbackSubmissions, profiles } from '@/db/schema'
import { ensureFeedbackSchema } from '@/lib/feedback-ddl'
import { sendEmail, buildFeedbackReplyEmailHtml } from '@/lib/email'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

// P37 — a PATCH can update status, send a reply, or both (≥1 required).
const patchSchema = z
  .object({
    status: z.enum(['new', 'reviewed', 'resolved']).optional(),
    reply: z.string().min(1).max(2000).optional(),
  })
  .refine((d) => d.status !== undefined || d.reply !== undefined, {
    message: 'Provide status or reply',
  })

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 422 })
    const { status, reply } = parsed.data

    const [updated] = await db
      .update(feedbackSubmissions)
      .set({
        ...(status ? { status } : {}),
        ...(reply
          ? { reply, repliedAt: new Date(), repliedBy: user.id, replyReadAt: null }
          : {}),
      })
      .where(eq(feedbackSubmissions.id, id))
      .returning({
        id: feedbackSubmissions.id,
        status: feedbackSubmissions.status,
        reply: feedbackSubmissions.reply,
        repliedAt: feedbackSubmissions.repliedAt,
        userId: feedbackSubmissions.userId,
        facilityId: feedbackSubmissions.facilityId,
        message: feedbackSubmissions.message,
      })
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 })

    // Notify the submitter — in-app bell + push (fire-and-forget), plus an email
    // copy so the reply reaches them even if they haven't opened the app.
    if (reply && updated.userId) {
      const submitterId = updated.userId
      import('@/lib/notify')
        .then(({ notifyUser }) =>
          notifyUser(submitterId, {
            type: 'feedback_reply',
            title: 'Reply to your feedback',
            body: `${reply.slice(0, 120)}${reply.length > 120 ? '…' : ''}`,
            url: '/my-feedback',
            facilityId: updated.facilityId ?? null,
          }),
        )
        .catch(() => {})
      db.query.profiles
        .findFirst({ where: eq(profiles.id, submitterId), columns: { email: true, fullName: true } })
        .then((p) => {
          if (!p?.email) return
          return sendEmail({
            to: p.email,
            subject: 'Senior Stylist replied to your feedback',
            html: buildFeedbackReplyEmailHtml({
              originalMessage: updated.message,
              reply,
              recipientName: p.fullName ?? null,
            }),
          })
        })
        .catch(() => {})
    }

    return Response.json({
      data: { id: updated.id, status: updated.status, reply: updated.reply, repliedAt: updated.repliedAt },
    })
  } catch (err) {
    console.error('PATCH /api/feedback/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
