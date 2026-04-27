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
    await resend.emails.send({ from: FROM, to, subject, html })
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

function fmtCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const EMAIL_FOOTER = `<div style="padding:16px 32px 28px;border-top:1px solid #F5F5F4;margin-top:8px;">
      <p style="margin:0;font-size:12px;color:#A8A29E;">Questions? <a href="mailto:pmt@seniorstylist.com" style="color:#8B2E4A;text-decoration:none;">pmt@seniorstylist.com</a> · 443-450-3344</p>
    </div>`

export function buildFacilityStatementHtml(params: {
  facilityName: string
  facilityCode: string | null
  address: string | null
  outstandingCents: number
  paymentType: string
  revShareType: string | null
  invoices: Array<{
    residentId: string | null
    invoiceNum: string
    invoiceDate: string
    amountCents: number
    openBalanceCents: number
    status: string
  }>
  residents: Array<{
    id: string
    name: string
    roomNumber: string | null
    qbOutstandingBalanceCents: number | null
  }>
  payments: Array<{
    paymentDate: string
    checkNum: string | null
    amountCents: number
    memo: string | null
    invoiceRef: string | null
  }>
}): string {
  const { facilityName, facilityCode, address, outstandingCents, invoices, residents, payments, revShareType } = params

  const totalBilled = invoices.reduce((s, i) => s + (i.amountCents ?? 0), 0)
  const totalReceived = payments.reduce((s, p) => s + (p.amountCents ?? 0), 0)

  const codeSpan = facilityCode
    ? `<span style="display:inline-block;margin-left:8px;background:rgba(255,255,255,0.15);color:#F5E6EA;font-size:11px;font-family:monospace;padding:2px 6px;border-radius:4px;">${facilityCode}</span>`
    : ''
  const addressLine = address
    ? `<p style="margin:6px 0 0;color:#F5E6EA;font-size:12px;">${address}</p>`
    : ''

  const outstandingStyle = outstandingCents > 0 ? 'background:#FFFBEB;' : 'background:#F5F5F4;'
  const outstandingValueStyle = outstandingCents > 0 ? 'color:#B45309;' : 'color:#1C1917;'

  const revShareNote = revShareType === 'facility_deducts'
    ? '<p style="margin:16px 0 0;font-size:12px;color:#78716C;">Facility deducts revenue share before payment.</p>'
    : '<p style="margin:16px 0 0;font-size:12px;color:#78716C;">Senior Stylist deducts revenue share.</p>'

  const residentRows = residents
    .filter((r) => {
      const mine = invoices.filter((i) => i.residentId === r.id)
      return mine.length > 0 || (r.qbOutstandingBalanceCents ?? 0) > 0
    })
    .map((r) => {
      const mine = invoices.filter((i) => i.residentId === r.id)
      const billed = mine.reduce((s, i) => s + (i.amountCents ?? 0), 0)
      const outstanding = r.qbOutstandingBalanceCents ?? 0
      const outStyle = outstanding > 0 ? 'color:#B45309;font-weight:700;' : 'color:#57534E;'
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:13px;">${r.name}</td>
        <td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;">${r.roomNumber ?? '—'}</td>
        <td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:13px;text-align:right;">${fmtCents(billed)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #F5F5F4;font-size:13px;text-align:right;${outStyle}">${fmtCents(outstanding)}</td>
      </tr>`
    })
    .join('')

  const paymentRows = payments
    .slice(0, 15)
    .map(
      (p) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:13px;">${fmtDate(p.paymentDate)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;">${p.checkNum ?? '—'}</td>
        <td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:13px;font-weight:600;text-align:right;">${fmtCents(p.amountCents)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:12px;max-width:160px;overflow:hidden;">${p.memo ?? p.invoiceRef ?? '—'}</td>
      </tr>`
    )
    .join('')

  const residentsSection = residentRows
    ? `<div style="margin-top:24px;">
        <h2 style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1C1917;text-transform:uppercase;letter-spacing:0.05em;">Resident Summary</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="border-bottom:2px solid #E7E5E4;">
            <th style="padding:6px 0;text-align:left;font-size:11px;font-weight:600;color:#78716C;text-transform:uppercase;letter-spacing:0.06em;">Resident</th>
            <th style="padding:6px 0;text-align:left;font-size:11px;font-weight:600;color:#78716C;text-transform:uppercase;letter-spacing:0.06em;">Room</th>
            <th style="padding:6px 0;text-align:right;font-size:11px;font-weight:600;color:#78716C;text-transform:uppercase;letter-spacing:0.06em;">Billed</th>
            <th style="padding:6px 0;text-align:right;font-size:11px;font-weight:600;color:#78716C;text-transform:uppercase;letter-spacing:0.06em;">Outstanding</th>
          </tr>
          ${residentRows}
        </table>
      </div>`
    : ''

  const paymentsSection = paymentRows
    ? `<div style="margin-top:24px;">
        <h2 style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1C1917;text-transform:uppercase;letter-spacing:0.05em;">Recent Payments</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="border-bottom:2px solid #E7E5E4;">
            <th style="padding:6px 0;text-align:left;font-size:11px;font-weight:600;color:#78716C;text-transform:uppercase;letter-spacing:0.06em;">Date</th>
            <th style="padding:6px 0;text-align:left;font-size:11px;font-weight:600;color:#78716C;text-transform:uppercase;letter-spacing:0.06em;">Check #</th>
            <th style="padding:6px 0;text-align:right;font-size:11px;font-weight:600;color:#78716C;text-transform:uppercase;letter-spacing:0.06em;">Amount</th>
            <th style="padding:6px 0;text-align:left;font-size:11px;font-weight:600;color:#78716C;text-transform:uppercase;letter-spacing:0.06em;">Memo</th>
          </tr>
          ${paymentRows}
        </table>
      </div>`
    : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#8B2E4A;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">Statement of Account${codeSpan}</h1>
      <p style="margin:6px 0 0;color:#F5E6EA;font-size:14px;font-weight:600;">${facilityName}</p>
      ${addressLine}
    </div>
    <div style="padding:24px 32px 0;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:33%;padding:12px;background:#F5F5F4;border-radius:8px;text-align:center;vertical-align:top;">
            <div style="color:#78716C;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Total Billed</div>
            <div style="color:#1C1917;font-size:18px;font-weight:700;margin-top:4px;">${fmtCents(totalBilled)}</div>
          </td>
          <td style="width:8px;"></td>
          <td style="width:33%;padding:12px;background:#F5F5F4;border-radius:8px;text-align:center;vertical-align:top;">
            <div style="color:#78716C;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Total Received</div>
            <div style="color:#1C1917;font-size:18px;font-weight:700;margin-top:4px;">${fmtCents(totalReceived)}</div>
          </td>
          <td style="width:8px;"></td>
          <td style="width:33%;padding:12px;${outstandingStyle}border-radius:8px;text-align:center;vertical-align:top;">
            <div style="color:#78716C;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Outstanding</div>
            <div style="${outstandingValueStyle}font-size:18px;font-weight:700;margin-top:4px;">${fmtCents(outstandingCents)}</div>
          </td>
        </tr>
      </table>
      ${revShareNote}
      ${residentsSection}
      ${paymentsSection}
    </div>
    ${EMAIL_FOOTER}
  </div>
</body>
</html>`.trim()
}

export function buildResidentStatementHtml(params: {
  residentName: string
  roomNumber: string | null
  facilityName: string
  outstandingCents: number
  invoices: Array<{
    invoiceNum: string
    invoiceDate: string
    amountCents: number
    openBalanceCents: number
    status: string
  }>
  poaName?: string | null
}): string {
  const { residentName, roomNumber, facilityName, outstandingCents, invoices, poaName } = params

  const greeting = poaName ? `Dear ${poaName},` : 'Dear Resident Family,'
  const outstandingCallout = outstandingCents > 0
    ? `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;padding:16px 20px;margin-bottom:20px;">
        <p style="margin:0;font-size:13px;color:#78716C;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Outstanding Balance</p>
        <p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#B45309;">${fmtCents(outstandingCents)}</p>
      </div>`
    : `<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:16px 20px;margin-bottom:20px;">
        <p style="margin:0;font-size:13px;color:#15803D;font-weight:600;">Account is current — no outstanding balance.</p>
      </div>`

  const invoiceRows = invoices
    .slice(0, 20)
    .map((i) => {
      const statusStyle = i.status === 'paid'
        ? 'color:#15803D;font-weight:600;'
        : i.openBalanceCents > 0
        ? 'color:#B45309;font-weight:600;'
        : 'color:#78716C;'
      const statusLabel = i.status === 'paid' ? 'Paid' : i.status === 'credit' ? 'Credit' : i.status === 'partial' ? 'Partial' : 'Open'
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:13px;">${fmtDate(i.invoiceDate)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;">${i.invoiceNum}</td>
        <td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:13px;text-align:right;">${fmtCents(i.amountCents)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #F5F5F4;text-align:right;font-size:13px;${statusStyle}">${statusLabel}</td>
      </tr>`
    })
    .join('')

  const invoicesSection = invoiceRows
    ? `<div style="margin-top:8px;">
        <h2 style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1C1917;text-transform:uppercase;letter-spacing:0.05em;">Invoice History</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="border-bottom:2px solid #E7E5E4;">
            <th style="padding:6px 0;text-align:left;font-size:11px;font-weight:600;color:#78716C;text-transform:uppercase;letter-spacing:0.06em;">Date</th>
            <th style="padding:6px 0;text-align:left;font-size:11px;font-weight:600;color:#78716C;text-transform:uppercase;letter-spacing:0.06em;">Invoice #</th>
            <th style="padding:6px 0;text-align:right;font-size:11px;font-weight:600;color:#78716C;text-transform:uppercase;letter-spacing:0.06em;">Amount</th>
            <th style="padding:6px 0;text-align:right;font-size:11px;font-weight:600;color:#78716C;text-transform:uppercase;letter-spacing:0.06em;">Status</th>
          </tr>
          ${invoiceRows}
        </table>
      </div>`
    : '<p style="font-size:13px;color:#A8A29E;">No invoices on record.</p>'

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#8B2E4A;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">Billing Reminder</h1>
      <p style="margin:6px 0 0;color:#F5E6EA;font-size:13px;">${facilityName}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 20px;color:#1C1917;font-size:14px;line-height:1.6;">${greeting}</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tr><td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:40%;">Resident</td><td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;font-weight:600;">${residentName}</td></tr>
        ${roomNumber ? `<tr><td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Room</td><td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${roomNumber}</td></tr>` : ''}
      </table>
      ${outstandingCallout}
      ${invoicesSection}
    </div>
    ${EMAIL_FOOTER}
  </div>
</body>
</html>`.trim()
}

export function buildPortalMagicLinkEmailHtml(params: {
  residentNames: string[]
  facilityName: string
  link: string
  expiresInHours: number
}): string {
  const { residentNames, facilityName, link, expiresInHours } = params
  const namesLine = residentNames.length > 0 ? residentNames.join(' & ') : 'your loved one'
  const multiple = residentNames.length > 1
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#8B2E4A;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">Your Family Portal</h1>
      <p style="margin:6px 0 0;color:#F5E6EA;font-size:13px;">${facilityName}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 18px;color:#1C1917;font-size:15px;line-height:1.6;">
        Sign in to view appointments, request services, and manage billing for <strong>${namesLine}</strong>${multiple ? '' : ''}.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${link}" style="display:inline-block;background:#8B2E4A;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:14px;font-weight:600;">Open Family Portal</a>
      </p>
      <p style="margin:0 0 12px;color:#57534E;font-size:13px;line-height:1.5;">
        This link expires in ${expiresInHours} hours. If you didn't request access, you can safely ignore this email.
      </p>
      <p style="margin:0;color:#A8A29E;font-size:12px;word-break:break-all;">
        Or paste this link into your browser: <span style="color:#8B2E4A;">${link}</span>
      </p>
    </div>
    ${EMAIL_FOOTER}
  </div>
</body>
</html>`.trim()
}

export function buildPortalRequestEmailHtml(params: {
  residentName: string
  facilityName: string
  serviceNames: string[]
  preferredDateFrom: string | null
  preferredDateTo: string | null
  notes: string | null
  adminUrl: string
}): string {
  const { residentName, facilityName, serviceNames, preferredDateFrom, preferredDateTo, notes, adminUrl } = params
  const servicesLine = serviceNames.length ? serviceNames.join(', ') : '—'
  const dateLine =
    preferredDateFrom && preferredDateTo
      ? preferredDateFrom === preferredDateTo
        ? fmtDate(preferredDateFrom)
        : `${fmtDate(preferredDateFrom)} – ${fmtDate(preferredDateTo)}`
      : preferredDateFrom
        ? fmtDate(preferredDateFrom)
        : 'Anytime'
  const notesRow = notes
    ? `<tr><td style="padding:10px 0;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;vertical-align:top;">Notes</td><td style="padding:10px 0;color:#1C1917;font-size:14px;white-space:pre-wrap;">${notes.replace(/</g, '&lt;')}</td></tr>`
    : ''
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#8B2E4A;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">New Service Request</h1>
      <p style="margin:6px 0 0;color:#F5E6EA;font-size:13px;">${facilityName}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 18px;color:#1C1917;font-size:15px;line-height:1.5;">
        A family member has requested service for <strong>${residentName}</strong>. Confirm a date/stylist on the dashboard.
      </p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:38%;">Resident</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;font-weight:600;">${residentName}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Services</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${servicesLine}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Preferred</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${dateLine}</td></tr>
        ${notesRow}
        <tr><td style="padding:10px 0;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Status</td><td style="padding:10px 0;color:#B45309;font-size:14px;font-weight:700;">Pending</td></tr>
      </table>
      <p style="margin:20px 0 0;">
        <a href="${adminUrl}" style="display:inline-block;background:#8B2E4A;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;">Review on Dashboard</a>
      </p>
    </div>
    ${EMAIL_FOOTER}
  </div>
</body>
</html>`.trim()
}

function formatDateRange(startDate: string, endDate: string): string {
  if (startDate === endDate) return startDate
  return `${startDate} – ${endDate}`
}

export function buildCoverageRequestEmailHtml(params: {
  stylistName: string
  startDate: string
  endDate: string
  reason: string | null
  facilityName: string
  dashboardUrl: string
}): string {
  const { stylistName, startDate, endDate, reason, facilityName, dashboardUrl } = params
  const rangeLabel = formatDateRange(startDate, endDate)
  const reasonRow = reason
    ? `<tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Reason</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${reason}</td></tr>`
    : ''
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#8B2E4A;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">Coverage Requested</h1>
      <p style="margin:6px 0 0;color:#F5E6EA;font-size:13px;">${facilityName}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 18px;color:#1C1917;font-size:15px;line-height:1.5;">
        <strong>${stylistName}</strong> has requested time off and needs coverage for <strong>${rangeLabel}</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:38%;">Stylist</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;font-weight:600;">${stylistName}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Dates</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${rangeLabel}</td></tr>
        ${reasonRow}
        <tr><td style="padding:10px 0;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Status</td><td style="padding:10px 0;color:#B45309;font-size:14px;font-weight:700;">Open</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:13px;color:#57534E;line-height:1.5;">Review the dashboard coverage queue and assign a substitute to confirm.</p>
      <p style="margin:16px 0 0;">
        <a href="${dashboardUrl}" style="display:inline-block;background:#8B2E4A;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;">Open Coverage Queue</a>
      </p>
    </div>
  </div>
</body>
</html>`.trim()
}

export function buildPayrollNotificationHtml(params: {
  stylistName: string
  facilityName: string
  periodStart: string
  periodEnd: string
  grossRevenueCents: number
  commissionRate: number
  commissionAmountCents: number
  deductions: Array<{ name: string; amountCents: number }>
  netPayCents: number
}): string {
  const { stylistName, facilityName, periodStart, periodEnd, grossRevenueCents, commissionRate, commissionAmountCents, deductions, netPayCents } = params
  const deductionRows = deductions
    .map((d) => `<tr><td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;">${d.name}</td><td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#57534E;font-size:13px;text-align:right;">-${fmtCents(d.amountCents)}</td></tr>`)
    .join('')
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#8B2E4A;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">Your Pay Is Ready</h1>
      <p style="margin:6px 0 0;color:#F5E6EA;font-size:13px;">${facilityName}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 20px;color:#1C1917;font-size:14px;line-height:1.6;">Hi ${stylistName}, your payroll has been marked paid for the period <strong>${periodStart} – ${periodEnd}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:60%;">Gross Revenue</td><td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:13px;text-align:right;">${fmtCents(grossRevenueCents)}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Commission (${commissionRate}%)</td><td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#57534E;font-size:13px;text-align:right;">-${fmtCents(commissionAmountCents)}</td></tr>
        ${deductionRows}
        <tr><td style="padding:12px 0 8px;color:#1C1917;font-size:14px;font-weight:700;">Net Pay</td><td style="padding:12px 0 8px;color:#8B2E4A;font-size:16px;font-weight:700;text-align:right;">${fmtCents(netPayCents)}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:13px;color:#57534E;line-height:1.5;">Questions? Contact your facility admin.</p>
    </div>
    ${EMAIL_FOOTER}
  </div>
</body>
</html>`.trim()
}

export function buildCoverageFilledEmailHtml(params: {
  stylistName: string
  substituteName: string
  startDate: string
  endDate: string
  facilityName: string
}): string {
  const { stylistName, substituteName, startDate, endDate, facilityName } = params
  const rangeLabel = formatDateRange(startDate, endDate)
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#8B2E4A;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">Coverage Confirmed</h1>
      <p style="margin:6px 0 0;color:#F5E6EA;font-size:13px;">${facilityName}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 18px;color:#1C1917;font-size:15px;line-height:1.5;">
        Hi ${stylistName}, your time-off request for <strong>${rangeLabel}</strong> has been covered.
      </p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:38%;">Dates</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;font-weight:600;">${rangeLabel}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Substitute</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${substituteName}</td></tr>
        <tr><td style="padding:10px 0;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Status</td><td style="padding:10px 0;color:#047857;font-size:14px;font-weight:700;">Filled</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:13px;color:#57534E;line-height:1.5;">Enjoy your day off — we'll see you when you're back.</p>
    </div>
  </div>
</body>
</html>`.trim()
}
