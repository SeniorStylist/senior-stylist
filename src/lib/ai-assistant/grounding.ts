// P42 — always-on grounding digest for the assistant preamble. This is what
// makes the default FAST (flash) model feel smart: every turn carries a
// compact map of roles, pages, and money rules so "where is X" / "what can a
// bookkeeper do" / money questions answer correctly WITHOUT a tool round.
// Budget: keep the whole digest under ~2.5 KB (~650 tokens) — it rides every
// request. explain_feature remains the deep-dive path (full guides).
//
// RULE: when roles, pages, or money semantics change, update THIS file in
// the same commit (same rule as help-kb.ts and the Help Center tours).

import { HELP_GUIDES } from './help-kb'
import type { AssistantCtx } from './tools'

// One line per role: what they can see/do + how to help them.
const ROLE_LINES: Record<Exclude<AssistantCtx['role'], 'viewer'>, string> = {
  master:
    'Master admin (owner): everything, every facility — Master Admin dashboard, imports, merges, stylist directory, feedback replies; can act on any facility by naming it.',
  admin:
    "Admin (facility): runs facility operations — residents, sign-up sheet requests, billing (own bill + rev-share), analytics, signage, team logins, time-off approval. They do NOT place time slots: requests go on the Sign-Up Sheet, the STYLIST picks the time; they view the calendar, cancel, and edit non-time details. Stylist roster + services are VIEW-ONLY; payroll and stylist/service management belong to the franchise admin or bookkeeper — redirect kindly.",
  facility_staff:
    'Front desk (facility staff): residents, sign-up sheet requests (no time slots — the stylist converts; can cancel + edit non-time details), signage; services view-only — NO money pages. Route money questions to their admin.',
  bookkeeper:
    'Bookkeeper: billing, payroll, analytics, scanning + correcting day logs across EVERY facility — AND manages stylists (add/rename/re-code ST-codes, hours, commissions, compliance), the service catalog, applicants (manage tier); creates facilities from the scan screen; edits residents (fix misread names/rooms from the Day Log edit form or resident page). No schedule changes (walk-ins + imported-log fixes OK); cannot change appointment status. Facility deactivation stays with the owner.',
  stylist:
    'Stylist: their own world only — own calendar, own daily-log rows, own earnings, own hours/time off; can scan their own log sheets and add walk-ins (incl. new residents). Never show them money/roster data beyond their own.',
}

const APP_MAP = `Pages: Calendar (book/move appointments) · Day Log (record a day: done/no-show, payments, walk-ins, scan paper sheets, finalize) · Residents (roster, POA contacts, photos, duplicates merge) · Services (menu + prices; editing is franchise admin/bookkeeper) · Sign-Up Sheet (requests without a time) · Billing (invoices, checks, statements, QuickBooks) · Analytics (monthly report + this Ask AI) · Payroll (pay periods, commissions, tips — franchise admin/bookkeeper) · Stylists (roster; hours/time off/compliance managed by franchise admin/bookkeeper) · Signage (printable signs incl. the family sign-up QR poster) · My Account (stylist profile/earnings) · Settings (facility, team invites, family portal, notifications) · Help (guided tutorials) · Master Admin (owner: all facilities, imports, feedback).`

const MONEY_RULES = `Money rules (always true): revenue = COMPLETED visits only (scheduled/cancelled never count). Tips belong to the stylist — never facility revenue. Payment types Cash/Check/Card/ACH = paid; Invoice/RFMS/COF/RA/None = still on the open balance. Days and months bucket in the FACILITY's timezone. QuickBooks is the billing source of truth — the app never invents invoice records. When answering money questions, show the math: state the period, the total, and the 2–4 components it splits into (e.g. "July so far: $4,820 = 96 completed visits; $310 of that is still unpaid").`

/**
 * The always-on digest block for buildPreamble. Highlights the caller's own
 * role, lists the others briefly, and appends an auto-derived topics line
 * from the help KB (can't drift — derived from HELP_GUIDES).
 */
export function buildGroundingDigest(role: AssistantCtx['role']): string {
  const ownLine =
    role !== 'viewer' && ROLE_LINES[role]
      ? `YOU are helping this role → ${ROLE_LINES[role]}`
      : ''
  const otherLines = (Object.keys(ROLE_LINES) as Array<keyof typeof ROLE_LINES>)
    .filter((r) => r !== role)
    .map((r) => `- ${ROLE_LINES[r]}`)
    .join('\n')
  const topics = HELP_GUIDES.map((g) => g.id.replace(/-/g, ' ')).join(', ')

  return `App knowledge (answer simple where-is/who-can questions directly from this — no tool call needed):
${ownLine ? `${ownLine}\n` : ''}Other roles in the app:
${otherLines}
${APP_MAP}
${MONEY_RULES}
Deep-dive guides exist for: ${topics} — call explain_feature for the full walkthrough.`
}
