import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = 'Senior Stylist <noreply@seniorstylist.com>'

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}) {
  if (!process.env.RESEND_API_KEY) return
  try {
    const result = await resend.emails.send({ from: FROM, to, subject, html })
    console.log('[sendEmail] sent:', { to, messageId: result.data?.id })
  } catch (err) {
    console.error('[sendEmail] failed:', { to, error: err })
  }
}
