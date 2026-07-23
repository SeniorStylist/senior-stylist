// P35 — "Ask AI" business analyst (the GlossGenius borrow).
//
// SAFETY CONTRACT (do not regress):
// - The model NEVER writes SQL and NEVER touches the DB. This module runs a
//   FIXED set of read-only aggregates (active=true, is_demo=false, revenue
//   earned = completed only, facility-tz month windows) and hands the model a
//   JSON "data pack" to answer from. Scope is decided by the CALLER's role in
//   the route — never by the question text.
// - Money in the pack is integer cents; the prompt instructs USD formatting.
// - Resident names appear ONLY in the facility pack's top-open-balances list —
//   the same data the /billing page already shows the allowed roles.
// - Gemini via the canonical direct-fetch pattern: v1beta, gemini-2.5-flash,
//   camelCase fields, instructions folded into the text part (no
//   systemInstruction), never the SDK.

import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { dayRangeInTimezone, getLocalParts } from '@/lib/time'

type Row = Record<string, unknown>
const n = (v: unknown) => Number(v ?? 0)
const s = (v: unknown) => (v == null ? null : String(v))

function localDateStr(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/** Facility-scoped aggregates for admins/bookkeepers. ~7 small queries. */
export async function buildFacilityDataPack(facilityId: string): Promise<Record<string, unknown>> {
  const facRows = await db.execute(sql`
    SELECT name, facility_code, timezone, payment_type, qb_outstanding_balance_cents
    FROM facilities WHERE id = ${facilityId}
  `)
  const fac = (facRows as unknown as Row[])[0] ?? {}
  const tz = s(fac.timezone) ?? 'America/New_York'

  const now = new Date()
  const p = getLocalParts(now, tz)
  const monthStart = dayRangeInTimezone(localDateStr(p.year, p.month, 1), tz)!.start
  const lastMonthStart = dayRangeInTimezone(localDateStr(p.year, p.month - 1, 1), tz)!.start
  const d90 = new Date(now.getTime() - 90 * 24 * 3600 * 1000)
  const ahead14 = new Date(now.getTime() + 14 * 24 * 3600 * 1000)

  // Period totals in ONE scan. revenue earned = completed only (P32 rule);
  // counts of cancels/no-shows are this month's.
  const totalsRows = await db.execute(sql`
    SELECT
      COALESCE(SUM(COALESCE(b.price_cents, s.price_cents, 0)) FILTER (WHERE b.status = 'completed' AND b.start_time >= ${monthStart.toISOString()}::timestamptz AND b.start_time <= NOW()), 0)::bigint AS month_rev,
      COUNT(*) FILTER (WHERE b.status = 'completed' AND b.start_time >= ${monthStart.toISOString()}::timestamptz AND b.start_time <= NOW()) AS month_visits,
      COALESCE(SUM(COALESCE(b.price_cents, s.price_cents, 0)) FILTER (WHERE b.status = 'completed' AND b.start_time >= ${lastMonthStart.toISOString()}::timestamptz AND b.start_time < ${monthStart.toISOString()}::timestamptz), 0)::bigint AS last_month_rev,
      COUNT(*) FILTER (WHERE b.status = 'completed' AND b.start_time >= ${lastMonthStart.toISOString()}::timestamptz AND b.start_time < ${monthStart.toISOString()}::timestamptz) AS last_month_visits,
      COALESCE(SUM(COALESCE(b.price_cents, s.price_cents, 0)) FILTER (WHERE b.status = 'completed' AND b.start_time >= ${d90.toISOString()}::timestamptz AND b.start_time <= NOW()), 0)::bigint AS d90_rev,
      COUNT(*) FILTER (WHERE b.status = 'completed' AND b.start_time >= ${d90.toISOString()}::timestamptz AND b.start_time <= NOW()) AS d90_visits,
      COUNT(*) FILTER (WHERE b.status = 'cancelled' AND b.start_time >= ${monthStart.toISOString()}::timestamptz) AS month_cancels,
      COUNT(*) FILTER (WHERE b.status = 'no_show' AND b.start_time >= ${monthStart.toISOString()}::timestamptz) AS month_no_shows,
      COUNT(*) FILTER (WHERE b.status = 'scheduled' AND b.start_time > NOW() AND b.start_time <= ${ahead14.toISOString()}::timestamptz) AS booked_next_14d
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    WHERE b.facility_id = ${facilityId} AND b.active = true AND b.is_demo = false
  `)
  const t = (totalsRows as unknown as Row[])[0] ?? {}

  // Revenue by service, last 90 days (top 15). completed only.
  const byService = (await db.execute(sql`
    SELECT COALESCE(s.name, b.raw_service_name, 'Unknown service') AS service,
      COUNT(*) AS visits,
      COALESCE(SUM(COALESCE(b.price_cents, s.price_cents, 0)), 0)::bigint AS revenue_cents
    FROM bookings b LEFT JOIN services s ON s.id = b.service_id
    WHERE b.facility_id = ${facilityId} AND b.active = true AND b.is_demo = false
      AND b.status = 'completed' AND b.start_time >= ${d90.toISOString()}::timestamptz
    GROUP BY 1 ORDER BY revenue_cents DESC LIMIT 15
  `)) as unknown as Row[]

  // Revenue by stylist, last 90 days. completed only.
  const byStylist = (await db.execute(sql`
    SELECT st.name AS stylist, st.commission_percent,
      COUNT(*) AS visits,
      COALESCE(SUM(COALESCE(b.price_cents, s.price_cents, 0)), 0)::bigint AS revenue_cents
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    INNER JOIN stylists st ON st.id = b.stylist_id
    WHERE b.facility_id = ${facilityId} AND b.active = true AND b.is_demo = false
      AND b.status = 'completed' AND b.start_time >= ${d90.toISOString()}::timestamptz
    GROUP BY st.id, st.name, st.commission_percent ORDER BY revenue_cents DESC LIMIT 15
  `)) as unknown as Row[]

  // Open invoices + aging (same FILTER shape as the billing summary).
  const agingRows = await db.execute(sql`
    SELECT
      COALESCE(SUM(open_balance_cents), 0)::bigint AS open_total,
      COALESCE(SUM(open_balance_cents) FILTER (WHERE CURRENT_DATE - invoice_date <= 30), 0)::bigint AS b0_30,
      COALESCE(SUM(open_balance_cents) FILTER (WHERE CURRENT_DATE - invoice_date BETWEEN 31 AND 60), 0)::bigint AS b31_60,
      COALESCE(SUM(open_balance_cents) FILTER (WHERE CURRENT_DATE - invoice_date BETWEEN 61 AND 90), 0)::bigint AS b61_90,
      COALESCE(SUM(open_balance_cents) FILTER (WHERE CURRENT_DATE - invoice_date > 90), 0)::bigint AS b90plus
    FROM qb_invoices
    WHERE facility_id = ${facilityId} AND is_demo = false AND open_balance_cents > 0
  `)
  const aging = (agingRows as unknown as Row[])[0] ?? {}

  const paymentsRows = await db.execute(sql`
    SELECT COALESCE(SUM(amount_cents), 0)::bigint AS collected_30d
    FROM qb_payments
    WHERE facility_id = ${facilityId} AND is_demo = false
      AND payment_date >= CURRENT_DATE - 30
  `)
  const collected30d = n((paymentsRows as unknown as Row[])[0]?.collected_30d)

  // Top open resident balances — P40: LIVE per-resident SUM over qb_invoices
  // (pattern from unapplied-apply.ts::recomputeFacilityBalances). The
  // denormalized residents.qb_outstanding_balance_cents column is only
  // refreshed by QB sync / check save / credit apply and sat stale-zero while
  // invoices held real balances (Josh's "no specific residents owe money"
  // screenshot). Live SUM always agrees with the aging block above.
  const topBalances = (await db.execute(sql`
    SELECT r.id::text AS rid, r.name, COALESCE(SUM(qi.open_balance_cents), 0)::bigint AS owed_cents
    FROM residents r
    JOIN qb_invoices qi ON qi.resident_id = r.id AND qi.is_demo = false AND qi.open_balance_cents > 0
    WHERE r.facility_id = ${facilityId} AND r.active = true AND r.is_demo = false
    GROUP BY r.id, r.name
    ORDER BY owed_cents DESC LIMIT 10
  `)) as unknown as Row[]

  // Open money not attributed to any resident (invoice.resident_id IS NULL) —
  // surfaced so per-resident balances + this figure reconcile with the aging
  // total instead of silently disagreeing.
  const unattributedRows = await db.execute(sql`
    SELECT COALESCE(SUM(open_balance_cents), 0)::bigint AS c
    FROM qb_invoices
    WHERE facility_id = ${facilityId} AND is_demo = false
      AND open_balance_cents > 0 AND resident_id IS NULL
  `)
  const unattributedOpenCents = n((unattributedRows as unknown as Row[])[0]?.c)

  // P36 — family care preferences (style/allergy notes shown to the model
  // verbatim-truncated so "what does Mrs. Smith like?" answers correctly;
  // grounded data only, never generative). Best-effort pre-migration.
  let carePreferences: Array<Record<string, unknown>> = []
  try {
    carePreferences = ((await db.execute(sql`
      SELECT r.name, rp.style_notes, rp.allergy_notes, rp.visit_frequency, st.name AS preferred_stylist
      FROM resident_preferences rp
      JOIN residents r ON r.id = rp.resident_id AND r.active = true AND r.is_demo = false
      LEFT JOIN stylists st ON st.id = rp.preferred_stylist_id
      WHERE r.facility_id = ${facilityId}
        AND (rp.style_notes IS NOT NULL OR rp.allergy_notes IS NOT NULL OR rp.visit_frequency IS NOT NULL OR rp.preferred_stylist_id IS NOT NULL)
      ORDER BY r.name LIMIT 50
    `)) as unknown as Row[]).map((r) => ({
      resident: s(r.name),
      styleNotes: s(r.style_notes)?.slice(0, 120) ?? null,
      allergyNotes: s(r.allergy_notes)?.slice(0, 120) ?? null,
      visitFrequency: s(r.visit_frequency),
      preferredStylist: s(r.preferred_stylist),
    }))
  } catch { /* pre-migration */ }

  const countsRows = await db.execute(sql`
    SELECT COUNT(*) FILTER (WHERE active = true AND is_demo = false) AS residents
    FROM residents WHERE facility_id = ${facilityId}
  `)

  const monthLabel = `${p.year}-${String(p.month).padStart(2, '0')}`
  return {
    scope: 'facility',
    facility: { name: s(fac.name), code: s(fac.facility_code), timezone: tz, billingType: s(fac.payment_type) },
    periods: {
      thisMonth: monthLabel,
      note: 'All revenue figures are COMPLETED visits only (price + built-in addons, tips excluded). Money values are integer cents.',
    },
    revenue: {
      thisMonthCents: n(t.month_rev), thisMonthVisits: n(t.month_visits),
      lastMonthCents: n(t.last_month_rev), lastMonthVisits: n(t.last_month_visits),
      last90DaysCents: n(t.d90_rev), last90DaysVisits: n(t.d90_visits),
    },
    activity: {
      cancelledThisMonth: n(t.month_cancels), noShowsThisMonth: n(t.month_no_shows),
      scheduledNext14Days: n(t.booked_next_14d),
      activeResidents: n((countsRows as unknown as Row[])[0]?.residents),
    },
    byServiceLast90Days: byService.map((r) => ({ service: s(r.service), visits: n(r.visits), revenueCents: n(r.revenue_cents) })),
    byStylistLast90Days: byStylist.map((r) => ({ stylist: s(r.stylist), commissionPercent: n(r.commission_percent), visits: n(r.visits), revenueCents: n(r.revenue_cents) })),
    familyCarePreferences: carePreferences,
    billing: {
      openInvoicesTotalCents: n(aging.open_total),
      agingCents: { days0to30: n(aging.b0_30), days31to60: n(aging.b31_60), days61to90: n(aging.b61_90), over90: n(aging.b90plus) },
      collectedLast30DaysCents: collected30d,
      // residentId (P47) feeds the assistant's tappable answer cards.
      topOpenResidentBalances: topBalances.map((r) => ({ residentId: s(r.rid), resident: s(r.name), owedCents: n(r.owed_cents) })),
      // Open invoice money with no resident attached — mention it when asked
      // "who owes us" so the per-resident list + this reconcile with the total.
      unattributedOpenInvoicesCents: unattributedOpenCents,
    },
  }
}

/** Cross-facility aggregates for the master admin. 3 queries. */
export async function buildMasterDataPack(): Promise<Record<string, unknown>> {
  // Month window anchored to ET (dominant tz) — labeled in the pack.
  const tz = 'America/New_York'
  const p = getLocalParts(new Date(), tz)
  const monthStart = dayRangeInTimezone(localDateStr(p.year, p.month, 1), tz)!.start

  const facilities = (await db.execute(sql`
    SELECT id, name, facility_code, COALESCE(qb_outstanding_balance_cents, 0)::bigint AS open_cents
    FROM facilities WHERE active = true AND is_demo = false ORDER BY name
  `)) as unknown as Row[]

  const mtd = (await db.execute(sql`
    SELECT b.facility_id::text AS fid,
      COALESCE(SUM(COALESCE(b.price_cents, s.price_cents, 0)) FILTER (WHERE b.status = 'completed'), 0)::bigint AS rev_cents,
      COUNT(*) FILTER (WHERE b.status = 'completed') AS visits
    FROM bookings b LEFT JOIN services s ON s.id = b.service_id
    WHERE b.active = true AND b.is_demo = false
      AND b.start_time >= ${monthStart.toISOString()}::timestamptz AND b.start_time <= NOW()
    GROUP BY b.facility_id
  `)) as unknown as Row[]
  const mtdMap = new Map(mtd.map((r) => [s(r.fid), r]))

  const collected = (await db.execute(sql`
    SELECT facility_id::text AS fid, COALESCE(SUM(amount_cents), 0)::bigint AS c
    FROM qb_payments WHERE is_demo = false AND payment_date >= CURRENT_DATE - 30
    GROUP BY facility_id
  `)) as unknown as Row[]
  const collectedMap = new Map(collected.map((r) => [s(r.fid), n(r.c)]))

  const rows = facilities.map((f) => {
    const m = mtdMap.get(s(f.id))
    return {
      facility: s(f.name),
      code: s(f.facility_code),
      monthToDateRevenueCents: n(m?.rev_cents),
      monthToDateVisits: n(m?.visits),
      openBalanceCents: n(f.open_cents),
      collectedLast30DaysCents: collectedMap.get(s(f.id)) ?? 0,
    }
  })

  return {
    scope: 'network',
    periods: {
      thisMonth: `${p.year}-${String(p.month).padStart(2, '0')}`,
      note: 'Month-to-date figures use Eastern-time month boundaries. Revenue = COMPLETED visits only, tips excluded. Money values are integer cents.',
    },
    totals: {
      facilities: rows.length,
      monthToDateRevenueCents: rows.reduce((a, r) => a + r.monthToDateRevenueCents, 0),
      monthToDateVisits: rows.reduce((a, r) => a + r.monthToDateVisits, 0),
      openBalanceCents: rows.reduce((a, r) => a + r.openBalanceCents, 0),
      collectedLast30DaysCents: rows.reduce((a, r) => a + r.collectedLast30DaysCents, 0),
    },
    facilities: rows,
  }
}

export interface AnalystTurn {
  q: string
  a: string
}

/** Ask Gemini the question, grounded on the data pack. Returns null on failure. */
export async function askAnalyst(
  question: string,
  history: AnalystTurn[],
  pack: Record<string, unknown>,
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const historyBlock = history.length
    ? `\n\nRecent conversation (for follow-up context):\n${history
        .map((h) => `Q: ${h.q}\nA: ${h.a}`)
        .join('\n')}`
    : ''

  const prompt = `You are the built-in business analyst for Senior Stylist, a salon-services platform for senior living facilities. Answer the operator's question using ONLY the JSON data below.

Rules:
- Never invent numbers. If the data can't answer the question, say so plainly and mention which page of the app would have it (Billing, Analytics, Payroll, Daily Log).
- All *Cents fields are integer US cents — always present money as dollars, e.g. 12345 → $123.45.
- Revenue means COMPLETED visits only; say what period a figure covers when it matters.
- Be concise: a direct answer first, then at most 2-3 supporting lines. Plain text only — no markdown headers or tables; short "-" lists are fine.
- Stay on business questions about this data. Politely decline anything else.

DATA:
${JSON.stringify(pack)}${historyBlock}

Question: ${question.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim()
    return text || null
  } catch {
    return null
  }
}
