import { Resend } from 'resend'

// Lazy init — the Resend constructor THROWS when the key is missing, which
// would crash any route importing this module in keyless environments.
let _resend: Resend | null = null
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

const FROM = 'Senior Stylist <noreply@seniorstylist.com>'

const LOGO_URL = 'https://portal.seniorstylist.com/seniorstylistlogo-white.png'

/**
 * Shared premium email header — a single burgundy band with the white logo
 * centered on top (matches the app sidebar), then eyebrow / title / subtitle.
 * No white band — the whole masthead is burgundy. All params escaped here.
 */
function emailHeader(params: {
  title: string
  subtitle?: string | null
  eyebrow?: string | null
  detail?: string | null
  codeChip?: string | null
}): string {
  const { title, subtitle, eyebrow, detail, codeChip } = params
  const chip = codeChip
    ? `&nbsp;&nbsp;<span style="display:inline-block;vertical-align:2px;background:rgba(255,255,255,0.16);color:#F2DEE5;font-size:11px;font-weight:600;font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:0.05em;padding:3px 9px;border-radius:99px;">${escHtml(codeChip)}</span>`
    : ''
  return `<div style="background:#8B2E4A;background:linear-gradient(155deg,#8B2E4A 0%,#7A2840 52%,#6A2237 100%);padding:34px 32px 26px;text-align:center;">
      <img src="${LOGO_URL}" alt="Senior Stylist" width="160" style="width:160px;max-width:62%;height:auto;border:0;display:inline-block;margin-bottom:${eyebrow || title ? '18px' : '0'};" />
      ${eyebrow ? `<p style="margin:0 0 8px;color:rgba(255,255,255,0.72);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.18em;">${escHtml(eyebrow)}</p>` : ''}
      <h1 style="margin:0;color:#fff;font-size:21px;font-weight:700;letter-spacing:-0.01em;line-height:1.3;">${escHtml(title)}${chip}</h1>
      ${subtitle ? `<p style="margin:7px 0 0;color:#F2DEE5;font-size:14px;font-weight:500;">${escHtml(subtitle)}</p>` : ''}
      ${detail ? `<p style="margin:4px 0 0;color:rgba(255,255,255,0.66);font-size:12.5px;">${escHtml(detail)}</p>` : ''}
    </div>`
}

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}): Promise<boolean> {
  const resend = getResend()
  if (!resend) {
    console.warn('[sendEmail] RESEND_API_KEY not set — skipping send to', to)
    return false
  }
  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html })
    if (error) {
      console.error('[sendEmail] Resend rejected:', { to, error })
      return false
    }
    return true
  } catch (err) {
    console.error('[sendEmail] failed:', { to, error: err })
    return false
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
    ${emailHeader({ title: 'Appointment Confirmed', subtitle: facilityName })}
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
    ${EMAIL_FOOTER}
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
    ${emailHeader({ title: 'Compliance Alert', subtitle: facilityName })}
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
    ${EMAIL_FOOTER}
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
    ${emailHeader({ eyebrow: 'Statement of Account', title: facilityName, codeChip: facilityCode, detail: address })}
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
    ${emailHeader({ title: 'Billing Reminder', subtitle: facilityName })}
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

// Payments (COF) — failover pay-link email. Sent when an automatic card/account
// collection couldn't be completed (declined card / empty account) or when an
// admin manually requests payment. The button opens a magic-link to the portal.
export function buildPaymentRequestEmailHtml(params: {
  residentName: string
  facilityName: string
  outstandingCents: number
  payUrl: string
  poaName?: string | null
  reason?: string | null
}): string {
  const { residentName, facilityName, outstandingCents, payUrl, poaName, reason } = params
  const greeting = poaName ? `Dear ${escHtml(poaName)},` : 'Dear Resident Family,'
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    ${emailHeader({ eyebrow: 'Payment Request', title: facilityName })}
    <div style="padding:28px 32px;">
      <p style="margin:0 0 16px;color:#1C1917;font-size:14px;line-height:1.6;">${greeting}</p>
      <p style="margin:0 0 20px;color:#1C1917;font-size:14px;line-height:1.6;">
        We were unable to complete payment for <strong>${escHtml(residentName)}</strong>'s recent salon services${reason ? ` (${escHtml(reason)})` : ''}.
        The current balance is shown below — you can pay securely online in a few taps.
      </p>
      <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;padding:16px 20px;margin-bottom:22px;">
        <p style="margin:0;font-size:13px;color:#78716C;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Amount Due</p>
        <p style="margin:4px 0 0;font-size:26px;font-weight:700;color:#B45309;">${fmtCents(outstandingCents)}</p>
      </div>
      <div style="text-align:center;margin:8px 0 18px;">
        <a href="${payUrl}" style="display:inline-block;background:#8B2E4A;color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:12px;">Pay now</a>
      </div>
      <p style="margin:0;color:#A8A29E;font-size:12px;line-height:1.6;text-align:center;">
        This secure link signs you in to your family account. You can also reply to this email or call the facility to arrange payment.
      </p>
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
    ${emailHeader({ title: 'Your Family Portal', subtitle: facilityName })}
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
    ${emailHeader({ title: 'New Service Request', subtitle: facilityName })}
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
    ${emailHeader({ title: 'Coverage Requested', subtitle: facilityName })}
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
    ${EMAIL_FOOTER}
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
    ${emailHeader({ title: 'Your Pay Is Ready', subtitle: facilityName })}
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
    ${emailHeader({ title: 'Coverage Confirmed', subtitle: facilityName })}
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
    ${EMAIL_FOOTER}
  </div>
</body>
</html>`.trim()
}

// 13F: time-off approval decision (approved → substitute search begins; denied → reason shown)
export function buildCoverageDecisionEmailHtml(params: {
  stylistName: string
  approved: boolean
  startDate: string
  endDate: string
  facilityName: string
  deniedReason?: string | null
}): string {
  const { stylistName, approved, startDate, endDate, facilityName, deniedReason } = params
  const rangeLabel = formatDateRange(startDate, endDate)
  const body = approved
    ? `Hi ${escHtml(stylistName)}, your time-off request for <strong>${rangeLabel}</strong> has been <strong style="color:#047857;">approved</strong>. We're finding coverage for your appointments — you'll get another email once a substitute is confirmed.`
    : `Hi ${escHtml(stylistName)}, unfortunately your time-off request for <strong>${rangeLabel}</strong> was <strong style="color:#B91C1C;">not approved</strong>.${deniedReason ? ` Reason: <em>${escHtml(deniedReason)}</em>.` : ''} Please talk to your facility admin if you have questions.`
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    ${emailHeader({ title: approved ? 'Time Off Approved' : 'Time Off Request Denied', subtitle: facilityName })}
    <div style="padding:28px 32px;">
      <p style="margin:0;color:#1C1917;font-size:15px;line-height:1.6;">${body}</p>
    </div>
    ${EMAIL_FOOTER}
  </div>
</body>
</html>`.trim()
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface DailyLogEmailRow {
  time: string
  residentName: string
  roomNumber: string | null
  serviceLabel: string
  priceCents: number
  tipCents: number | null
  status: string
  paymentStatus: string | null
  notes: string | null
}

export function buildFeedbackEmailHtml(params: {
  category: string
  message: string
  senderName: string
  senderRole: string | null
  facilityName: string | null
  pagePath: string | null
  device?: string | null
}): string {
  const { category, message, senderName, senderRole, facilityName, pagePath, device } = params
  const categoryLabel: Record<string, string> = {
    bug: '🐞 Bug report',
    idea: '💡 Idea',
    praise: '❤️ Something they liked',
    other: '💬 General feedback',
  }
  const label = categoryLabel[category] ?? categoryLabel.other
  const metaRow = (k: string, v: string) =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:32%;">${k}</td><td style="padding:8px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${escHtml(v)}</td></tr>`
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    ${emailHeader({ eyebrow: 'User Feedback', title: label.replace(/^[^ ]+ /, ''), subtitle: facilityName })}
    <div style="padding:28px 32px;">
      <div style="background:#F9EFF2;border-radius:12px;padding:16px 20px;margin-bottom:20px;">
        <p style="margin:0;font-size:14px;color:#1C1917;line-height:1.6;white-space:pre-wrap;">${escHtml(message)}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        ${metaRow('From', senderName)}
        ${senderRole ? metaRow('Role', senderRole) : ''}
        ${pagePath ? metaRow('Page', pagePath) : ''}
        ${device ? metaRow('Device', device) : ''}
        ${metaRow('Type', label)}
      </table>
      <p style="margin:20px 0 0;">
        <a href="https://portal.seniorstylist.com/master-admin/feedback" style="display:inline-block;background:#8B2E4A;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;">Review All Feedback</a>
      </p>
    </div>
    ${EMAIL_FOOTER}
  </div>
</body>
</html>`.trim()
}

export function buildDailyLogEmailHtml(params: {
  facilityName: string
  facilityCode: string | null
  dateLabel: string
  sentByName: string
  message: string | null
  groups: Array<{ stylistName: string; rows: DailyLogEmailRow[] }>
}): string {
  const { facilityName, facilityCode, dateLabel, sentByName, message, groups } = params

  const allRows = groups.flatMap((g) => g.rows)
  const totalCount = allRows.length
  // price_cents only — never add tip_cents
  const totalCents = allRows.reduce((s, r) => s + r.priceCents, 0)
  const tipsCents = allRows.reduce((s, r) => s + (r.tipCents ?? 0), 0)

  const statusBadge = (status: string): string => {
    if (status === 'completed')
      return '<span style="display:inline-block;background:#F0FDFA;color:#0F766E;font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;">Completed</span>'
    if (status === 'scheduled')
      return '<span style="display:inline-block;background:#EFF6FF;color:#1D4ED8;font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;">Scheduled</span>'
    if (status === 'no_show')
      return '<span style="display:inline-block;background:#FFFBEB;color:#B45309;font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;">No-show</span>'
    return `<span style="display:inline-block;background:#F5F5F4;color:#78716C;font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;">${escHtml(status)}</span>`
  }

  const paymentLabel = (s: string | null): string => {
    if (s === 'paid') return '<span style="color:#15803D;font-weight:600;">Paid</span>'
    if (s === 'unpaid') return '<span style="color:#B45309;font-weight:600;">Invoice</span>'
    if (s === 'waived') return '<span style="color:#78716C;">Waived</span>'
    return '<span style="color:#A8A29E;">—</span>'
  }

  const groupSections = groups
    .map((g) => {
      const rows = g.rows
        .map((r) => {
          const room = r.roomNumber ? ` · Rm ${escHtml(r.roomNumber)}` : ''
          const notesLine = r.notes?.trim()
            ? `<div style="margin-top:3px;font-size:12px;color:#78716C;font-style:italic;">${escHtml(r.notes.trim())}</div>`
            : ''
          const tipLine = r.tipCents && r.tipCents > 0
            ? `<div style="font-size:11px;color:#78716C;margin-top:2px;">+ ${fmtCents(r.tipCents)} tip</div>`
            : ''
          return `<tr>
            <td style="padding:10px 0;border-bottom:1px solid #F5F5F4;vertical-align:top;width:64px;color:#78716C;font-size:12px;white-space:nowrap;">${escHtml(r.time)}</td>
            <td style="padding:10px 8px;border-bottom:1px solid #F5F5F4;vertical-align:top;">
              <div style="color:#1C1917;font-size:14px;font-weight:600;">${escHtml(r.residentName)}<span style="color:#A8A29E;font-weight:400;font-size:12px;">${room}</span></div>
              <div style="margin-top:2px;color:#57534E;font-size:13px;">${escHtml(r.serviceLabel)}</div>
              ${notesLine}
            </td>
            <td style="padding:10px 0;border-bottom:1px solid #F5F5F4;vertical-align:top;text-align:right;white-space:nowrap;">
              <div style="color:#1C1917;font-size:14px;font-weight:700;">${fmtCents(r.priceCents)}</div>
              ${tipLine}
              <div style="margin-top:4px;">${statusBadge(r.status)}</div>
              <div style="margin-top:3px;font-size:11px;">${paymentLabel(r.paymentStatus)}</div>
            </td>
          </tr>`
        })
        .join('')
      const stylistHeader = groups.length > 1
        ? `<h2 style="margin:24px 0 4px;font-size:13px;font-weight:700;color:#8B2E4A;text-transform:uppercase;letter-spacing:0.06em;">${escHtml(g.stylistName)}</h2>`
        : ''
      return `${stylistHeader}<table style="width:100%;border-collapse:collapse;">${rows}</table>`
    })
    .join('')

  const messageBlock = message?.trim()
    ? `<div style="background:#F9EFF2;border-radius:12px;padding:14px 18px;margin-bottom:20px;">
        <p style="margin:0;font-size:13px;color:#1C1917;line-height:1.5;white-space:pre-wrap;">${escHtml(message.trim())}</p>
      </div>`
    : ''

  const emptyState = totalCount === 0
    ? '<p style="margin:8px 0 0;font-size:14px;color:#A8A29E;text-align:center;padding:24px 0;">No appointments recorded for this day.</p>'
    : ''

  const tipsTile = tipsCents > 0
    ? `<td style="width:8px;"></td>
       <td style="width:33%;padding:12px;background:#F5F5F4;border-radius:8px;text-align:center;vertical-align:top;">
         <div style="color:#78716C;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Tips</div>
         <div style="color:#1C1917;font-size:18px;font-weight:700;margin-top:4px;">${fmtCents(tipsCents)}</div>
       </td>`
    : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    ${emailHeader({ eyebrow: 'Daily Service Log', title: facilityName, codeChip: facilityCode, subtitle: dateLabel })}
    <div style="padding:24px 32px 8px;">
      ${messageBlock}
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
        <tr>
          <td style="width:33%;padding:12px;background:#F5F5F4;border-radius:8px;text-align:center;vertical-align:top;">
            <div style="color:#78716C;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Appointments</div>
            <div style="color:#1C1917;font-size:18px;font-weight:700;margin-top:4px;">${totalCount}</div>
          </td>
          <td style="width:8px;"></td>
          <td style="width:33%;padding:12px;background:#F5F5F4;border-radius:8px;text-align:center;vertical-align:top;">
            <div style="color:#78716C;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Total</div>
            <div style="color:#8B2E4A;font-size:18px;font-weight:700;margin-top:4px;">${fmtCents(totalCents)}</div>
          </td>
          ${tipsTile}
        </tr>
      </table>
      ${groupSections}
      ${emptyState}
      <p style="margin:22px 0 16px;font-size:12px;color:#A8A29E;text-align:center;">Sent by ${escHtml(sentByName)} via Senior Stylist</p>
    </div>
    ${EMAIL_FOOTER}
  </div>
</body>
</html>`.trim()
}

export function buildBookingReceiptHtml(params: {
  facilityName: string
  facilityAddress?: string | null
  facilityPhone?: string | null
  residentName: string
  serviceName: string
  stylistName: string
  serviceDate: string
  priceCents: number
  tipCents: number | null
  paymentType?: string | null
}): string {
  const {
    facilityName,
    facilityAddress,
    facilityPhone,
    residentName,
    serviceName,
    stylistName,
    serviceDate,
    priceCents,
    tipCents,
    paymentType,
  } = params
  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`
  const tip = tipCents != null && tipCents > 0 ? tipCents : null
  const total = priceCents + (tip ?? 0)
  const paymentLabel = paymentType ? paymentType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    ${emailHeader({ title: 'Receipt', subtitle: facilityName })}
    <div style="padding:28px 32px;">
      <p style="margin:0 0 20px;color:#1C1917;font-size:15px;">Thank you for your visit, ${residentName}!</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:38%;">Service</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${serviceName}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Stylist</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${stylistName}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Date</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${serviceDate}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <tr><td style="padding:6px 0;color:#78716C;font-size:13px;">Service</td><td style="padding:6px 0;text-align:right;color:#1C1917;font-size:14px;">${dollars(priceCents)}</td></tr>
        ${tip != null ? `<tr><td style="padding:6px 0;color:#78716C;font-size:13px;">Tip</td><td style="padding:6px 0;text-align:right;color:#1C1917;font-size:14px;">${dollars(tip)}</td></tr>` : ''}
        <tr><td style="padding:10px 0;border-top:2px solid #E7E5E4;color:#1C1917;font-size:14px;font-weight:700;">Total</td><td style="padding:10px 0;border-top:2px solid #E7E5E4;text-align:right;color:#8B2E4A;font-size:16px;font-weight:700;">${dollars(total)}</td></tr>
        ${paymentLabel ? `<tr><td style="padding:6px 0;color:#78716C;font-size:13px;">Payment</td><td style="padding:6px 0;text-align:right;color:#1C1917;font-size:13px;">${paymentLabel}</td></tr>` : ''}
      </table>
      <p style="margin:24px 0 0;color:#A8A29E;font-size:12px;line-height:1.5;">
        ${facilityAddress ? `${facilityAddress}<br/>` : ''}
        Questions? Contact ${facilityName}${facilityPhone ? ` at ${facilityPhone}` : ''}.
      </p>
    </div>
    ${EMAIL_FOOTER}
  </div>
</body>
</html>`.trim()
}

export interface DigestFacilitySummary {
  facilityName: string
  facilityCode: string | null
  appointmentCount: number
  stylistNames: string[]
  // Phase 15 F3 — resident birthdays today + next 7 days (optional section)
  birthdays?: { name: string; dateLabel: string; isToday: boolean }[]
}

export function buildDailySummaryEmailHtml(params: {
  dateLabel: string
  facilities: DigestFacilitySummary[]
  isMasterDigest: boolean
}): string {
  const { dateLabel, facilities, isMasterDigest } = params
  const totalAppts = facilities.reduce((s, f) => s + f.appointmentCount, 0)

  const facilityRows = facilities
    .map((f) => {
      const stylists = f.stylistNames.length > 0 ? escHtml(f.stylistNames.join(', ')) : '<span style="color:#A8A29E;">—</span>'
      const code = f.facilityCode
        ? `<span style="font-size:11px;font-family:monospace;background:rgba(139,46,74,0.1);color:#8B2E4A;padding:2px 7px;border-radius:6px;margin-left:6px;">${escHtml(f.facilityCode)}</span>`
        : ''
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #F5F5F4;font-size:14px;font-weight:600;color:#1C1917;">${escHtml(f.facilityName)}${code}</td>
        <td style="padding:10px 0;border-bottom:1px solid #F5F5F4;text-align:center;font-size:14px;font-weight:700;color:#8B2E4A;">${f.appointmentCount}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #F5F5F4;font-size:12px;color:#78716C;">${stylists}</td>
      </tr>`
    })
    .join('')

  // Phase 15 F3 — birthdays section (today + next 7 days), shown when any facility has one
  const allBirthdays = facilities.flatMap((f) =>
    (f.birthdays ?? []).map((b) => ({ ...b, facilityName: f.facilityName })),
  )
  const birthdaySection = allBirthdays.length > 0
    ? `<div style="margin-top:20px;padding:14px 16px;background:#FDF6F8;border:1px solid rgba(139,46,74,0.15);border-radius:12px;">
        <div style="font-size:11px;font-weight:700;color:#8B2E4A;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">🎂 Birthdays</div>
        ${allBirthdays
          .map(
            (b) => `<div style="font-size:13px;color:#1C1917;padding:3px 0;">
              <span style="font-weight:600;">${escHtml(b.name)}</span>
              <span style="color:#78716C;"> — ${escHtml(b.dateLabel)}${b.isToday ? ' (today!)' : ''}${isMasterDigest ? ` · ${escHtml(b.facilityName)}` : ''}</span>
            </div>`,
          )
          .join('')}
      </div>`
    : ''

  const emptyState = facilities.length === 0
    ? '<p style="text-align:center;color:#A8A29E;font-size:14px;padding:24px 0;">No appointments scheduled today.</p>'
    : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    ${emailHeader({ eyebrow: 'Morning Digest', title: isMasterDigest ? 'Daily Summary' : (facilities[0]?.facilityName ?? 'Daily Summary'), subtitle: dateLabel })}
    <div style="padding:24px 32px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tr>
          <td style="width:50%;padding:12px;background:#F9EFF2;border-radius:10px;text-align:center;">
            <div style="color:#8B2E4A;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Total Appointments</div>
            <div style="color:#1C1917;font-size:26px;font-weight:700;margin-top:4px;">${totalAppts}</div>
          </td>
          <td style="width:8px;"></td>
          <td style="width:50%;padding:12px;background:#F5F5F4;border-radius:10px;text-align:center;">
            <div style="color:#78716C;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Facilities Active</div>
            <div style="color:#1C1917;font-size:26px;font-weight:700;margin-top:4px;">${facilities.filter((f) => f.appointmentCount > 0).length}</div>
          </td>
        </tr>
      </table>
      ${facilities.length > 0 ? `
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left;font-size:11px;font-weight:700;color:#78716C;text-transform:uppercase;letter-spacing:0.08em;padding-bottom:8px;border-bottom:2px solid #E7E5E4;">Facility</th>
            <th style="text-align:center;font-size:11px;font-weight:700;color:#78716C;text-transform:uppercase;letter-spacing:0.08em;padding-bottom:8px;border-bottom:2px solid #E7E5E4;">Appts</th>
            <th style="text-align:left;font-size:11px;font-weight:700;color:#78716C;text-transform:uppercase;letter-spacing:0.08em;padding-bottom:8px;border-bottom:2px solid #E7E5E4;">Stylists</th>
          </tr>
        </thead>
        <tbody>${facilityRows}</tbody>
      </table>` : emptyState}
      ${birthdaySection}
      <p style="margin:24px 0 0;font-size:12px;color:#A8A29E;text-align:center;">Sent automatically at 8:00 AM by Senior Stylist</p>
    </div>
    ${EMAIL_FOOTER}
  </div>
</body>
</html>`.trim()
}
