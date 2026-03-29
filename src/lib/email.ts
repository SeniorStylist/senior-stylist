import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = 'Senior Stylist <onboarding@resend.dev>'

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
    await resend.emails.send({ from: FROM, to, subject, html })
  } catch (err) {
    console.error('[sendEmail] failed:', err)
  }
}
