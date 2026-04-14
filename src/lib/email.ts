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

export function buildBookingConfirmationEmailHtml(params: {
  residentName: string
  serviceName: string
  stylistName: string
  dateStr: string
  timeStr: string
  priceStr: string
  facilityName: string
  portalUrl: string
  bookedBy: 'staff' | 'portal'
}): string {
  const { residentName, serviceName, stylistName, dateStr, timeStr, priceStr, facilityName, portalUrl, bookedBy } = params
  const bookedByNote = bookedBy === 'staff' ? 'Booked by salon staff.' : 'Booked via the resident portal.'
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#8B2E4A;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">Appointment Confirmed</h1>
      <p style="margin:6px 0 0;color:#E0F2F1;font-size:13px;">${facilityName}</p>
    </div>
    <div style="padding:28px 32px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:38%;">Resident</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;font-weight:600;">${residentName}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Service</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${serviceName}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Stylist</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${stylistName}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Date</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${dateStr}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Time</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${timeStr}</td></tr>
        <tr><td style="padding:10px 0;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Price</td><td style="padding:10px 0;color:#8B2E4A;font-size:14px;font-weight:700;">${priceStr}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#A8A29E;">${bookedByNote}</p>
      <p style="margin:16px 0 0;">
        <a href="${portalUrl}" style="display:inline-block;background:#8B2E4A;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;">View in Portal</a>
      </p>
    </div>
  </div>
</body>
</html>`.trim()
}

export function buildComplianceAlertEmailHtml(params: {
  stylistName: string
  documentTypeLabel: string
  daysRemaining: number
  expiresAt: string
  facilityName: string
  stylistUrl: string
}): string {
  const { stylistName, documentTypeLabel, daysRemaining, expiresAt, facilityName, stylistUrl } = params
  const urgency = daysRemaining <= 30 ? 'Action needed soon' : 'Upcoming expiration'
  const urgencyColor = daysRemaining <= 30 ? '#B91C1C' : '#B45309'
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#8B2E4A;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">Compliance Alert</h1>
      <p style="margin:6px 0 0;color:#F5E6EA;font-size:13px;">${facilityName}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 6px;color:${urgencyColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">${urgency}</p>
      <p style="margin:0 0 18px;color:#1C1917;font-size:15px;line-height:1.5;">
        <strong>${stylistName}</strong>'s ${documentTypeLabel} expires in <strong>${daysRemaining} day${daysRemaining === 1 ? '' : 's'}</strong> (${expiresAt}).
      </p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:38%;">Stylist</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;font-weight:600;">${stylistName}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Document</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${documentTypeLabel}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Expires</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${expiresAt}</td></tr>
        <tr><td style="padding:10px 0;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Days Left</td><td style="padding:10px 0;color:${urgencyColor};font-size:14px;font-weight:700;">${daysRemaining}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:13px;color:#57534E;line-height:1.5;">Ask the stylist to upload a renewed document, or verify the updated expiration in their profile.</p>
      <p style="margin:16px 0 0;">
        <a href="${stylistUrl}" style="display:inline-block;background:#8B2E4A;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;">Open Stylist Profile</a>
      </p>
    </div>
  </div>
</body>
</html>`.trim()
}
