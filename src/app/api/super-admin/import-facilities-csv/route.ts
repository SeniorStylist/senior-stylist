import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { FACILITY_CODE_RE, generateFacilityCode } from '@/lib/facility-code'
import { TIMEZONES } from '@/lib/facility-options'
import Papa from 'papaparse'
import { revalidateTag } from 'next/cache'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// P60-C3 — "import-first" (owner decision): the owners keep the facility list
// in a spreadsheet. This importer now (a) READS A HEADER ROW when the sheet
// has one (any column order) and falls back to the legacy fixed positions,
// and (b) CREATES facilities for rows with an unknown F-code — or no code at
// all — instead of skipping them. Live Google Sheets sync is a later phase.

// Extract first email address from a cell value
const EMAIL_RE = /[\w.+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/
const MAX_ROWS = 500

// Map billing type values from the CSV to DB payment_type values
function mapBillingType(raw: string): string | null {
  const v = raw.toUpperCase().trim()
  if (!v) return null
  if (v.includes('IP') && v.includes('F')) return 'hybrid'
  if (v === 'HYBRID') return 'hybrid'
  if (v === 'IP' || v === 'IPM' || v.startsWith('IP') || v.includes('RESIDENT')) return 'ip'
  if (v === 'RFMS' || v === 'F' || v === 'NB' || v === 'SC' || v.startsWith('F')) return 'rfms'
  if (v === 'FACILITY') return 'facility'
  return null
}

function mapTimezone(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  const exact = TIMEZONES.find((t) => t.value.toLowerCase() === v.toLowerCase())
  if (exact) return exact.value
  const byLabel = TIMEZONES.find((t) => t.label.toLowerCase() === v.toLowerCase())
  if (byLabel) return byLabel.value
  const abbr: Record<string, string> = { et: 'America/New_York', est: 'America/New_York', edt: 'America/New_York', ct: 'America/Chicago', cst: 'America/Chicago', mt: 'America/Denver', mst: 'America/Denver', pt: 'America/Los_Angeles', pst: 'America/Los_Angeles', az: 'America/Phoenix' }
  return abbr[v.toLowerCase()] ?? null
}

// ── Header detection ──────────────────────────────────────────────────────
type Col = 'code' | 'name' | 'billing' | 'revShare' | 'email' | 'phone' | 'address' | 'timezone' | 'priority' | 'notes'

const HEADER_ALIASES: Record<Col, string[]> = {
  code: ['code', 'fid', 'facilitycode', 'fcode', 'facilityid', 'id'],
  name: ['name', 'facility', 'facilityname', 'community', 'communityname'],
  billing: ['billing', 'billingtype', 'type', 'paymenttype', 'payment'],
  revShare: ['revshare', 'revshare%', 'revenueshare', 'share', '%', 'rev'],
  email: ['email', 'contact', 'contactemail', 'emailaddress'],
  phone: ['phone', 'phonenumber', 'telephone', 'tel'],
  address: ['address', 'streetaddress', 'location'],
  timezone: ['timezone', 'tz', 'zone'],
  priority: ['priority', 'tier'],
  notes: ['notes', 'note', 'comments'],
}

function normalizeHeader(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[\s_\-.#()]/g, '')
}

/** Returns a column→index map when a row looks like a header (≥2 recognized names, incl. name or code). */
function detectHeader(row: string[]): Partial<Record<Col, number>> | null {
  const map: Partial<Record<Col, number>> = {}
  row.forEach((cell, idx) => {
    const n = normalizeHeader(cell)
    if (!n) return
    for (const col of Object.keys(HEADER_ALIASES) as Col[]) {
      if (map[col] === undefined && HEADER_ALIASES[col].includes(n)) {
        map[col] = idx
        return
      }
    }
  })
  const hits = Object.keys(map).length
  if (hits >= 2 && (map.name !== undefined || map.code !== undefined)) return map
  return null
}

// Legacy positional layout (the original master spreadsheet export):
// col[0] notes · col[1] F-code · col[2] priority · col[3] NAME · col[4] billing
// col[5] rev share % · col[6] contact email · col[8] phone · col[9] address
const LEGACY: Partial<Record<Col, number>> = { notes: 0, code: 1, priority: 2, name: 3, billing: 4, revShare: 5, email: 6, phone: 8, address: 9 }

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await checkRateLimit('billingImport', user.id)
  if (!rl.ok) return rateLimitResponse(rl.retryAfter)

  const formData = await request.formData()
  const csvFile = formData.get('csv') as File | null
  if (!csvFile) return Response.json({ error: 'csv file is required' }, { status: 400 })
  // Creation is opt-out: the wizard/hub UI sends createMissing=0 for a pure update run.
  const createMissing = formData.get('createMissing') !== '0'

  const text = await csvFile.text()
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true })
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return Response.json({ error: 'Could not parse CSV' }, { status: 400 })
  }

  const rows = parsed.data as string[][]
  if (rows.length > MAX_ROWS + 5) {
    return Response.json({ error: `File exceeds ${MAX_ROWS} rows` }, { status: 422 })
  }

  // Header detection over the first 5 rows; legacy positions otherwise.
  let cols: Partial<Record<Col, number>> = LEGACY
  let dataRows = rows.slice(1)
  let headerDetected = false
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const map = detectHeader(rows[i])
    if (map) {
      cols = map
      dataRows = rows.slice(i + 1)
      headerDetected = true
      break
    }
  }
  const cell = (row: string[], col: Col): string => {
    const idx = cols[col]
    return idx === undefined ? '' : (row[idx] ?? '').trim()
  }

  // Pre-load facilities keyed by code (ACTIVE + inactive — an inactive code
  // must never be silently re-minted) and by lower-cased name.
  const allFacilities = await db.query.facilities.findMany({
    where: eq(facilities.isDemo, false),
    columns: { id: true, facilityCode: true, name: true, contactEmail: true, paymentType: true, revSharePercentage: true, active: true },
  })
  const byCode = new Map(allFacilities.filter((f) => f.facilityCode).map((f) => [f.facilityCode!.toUpperCase(), f]))
  const byName = new Map(allFacilities.map((f) => [f.name.trim().toLowerCase(), f]))

  let updated = 0
  let created = 0
  let skipped = 0
  let namesFilled = 0
  let emailsFilled = 0
  let revShareSet = 0
  const warnings: string[] = []
  const createdList: { facilityCode: string; name: string }[] = []
  const warn = (m: string) => { if (warnings.length < 50) warnings.push(m) }

  const toCreate: { row: string[]; code: string | null; name: string }[] = []

  for (const row of dataRows) {
    const rawCode = cell(row, 'code').toUpperCase()
    const csvName = cell(row, 'name')
    const hasCode = FACILITY_CODE_RE.test(rawCode)

    // Legacy mode: rows without a valid F-code are header continuations /
    // totals / blanks — skip silently as before. Header mode: a name is enough.
    if (!hasCode && (!headerDetected || !csvName)) continue

    let match = hasCode ? byCode.get(rawCode) : undefined
    if (!match && csvName) {
      const nameHit = byName.get(csvName.toLowerCase())
      // Name match only when the row carries no code, or the code isn't taken
      // (a code typo on a known facility must not create a duplicate).
      if (nameHit && !hasCode) match = nameHit
      else if (nameHit && hasCode && !nameHit.facilityCode) match = nameHit
    }

    if (!match) {
      if (!createMissing) {
        skipped++
        warn(`No DB facility for ${rawCode || '(no code)'}${csvName ? ` (${csvName})` : ''}`)
        continue
      }
      if (!csvName) {
        skipped++
        warn(`${rawCode}: no facility name — can't create`)
        continue
      }
      toCreate.push({ row, code: hasCode ? rawCode : null, name: csvName })
      continue
    }
    if (!match.active) {
      skipped++
      warn(`${match.facilityCode ?? ''} ${match.name} is deactivated — reactivate it in Master Admin before importing`)
      continue
    }

    const updates: Partial<typeof facilities.$inferInsert> = {}

    if (csvName && (!match.name || match.name.trim() === '')) {
      updates.name = csvName
      namesFilled++
    }
    // A name-matched row with no stored code adopts the sheet's code.
    if (hasCode && !match.facilityCode && !byCode.has(rawCode)) {
      updates.facilityCode = rawCode
      byCode.set(rawCode, match)
    }

    const mappedType = mapBillingType(cell(row, 'billing'))
    if (mappedType) updates.paymentType = mappedType

    const revRaw = cell(row, 'revShare').replace('%', '')
    const revNum = parseFloat(revRaw)
    if (revRaw && !isNaN(revNum) && revNum >= 0 && revNum <= 100) {
      updates.revSharePercentage = Math.round(revNum)
      revShareSet++
    }

    const emailFound = cell(row, 'email').match(EMAIL_RE)
    if (emailFound && !match.contactEmail) {
      updates.contactEmail = emailFound[0]
      emailsFilled++
    }

    const phoneRaw = cell(row, 'phone')
    if (phoneRaw) updates.phone = phoneRaw
    const addressRaw = cell(row, 'address')
    if (addressRaw) updates.address = addressRaw
    const tz = mapTimezone(cell(row, 'timezone'))
    if (tz) updates.timezone = tz

    if (Object.keys(updates).length > 0) {
      await db.update(facilities).set(updates).where(eq(facilities.id, match.id))
      updated++
    } else {
      skipped++
    }
  }

  // Creates — one transaction, codes minted under the advisory lock so a
  // code-less row can't collide with a coded one later in the same sheet.
  if (toCreate.length > 0) {
    await db.transaction(async (tx) => {
      const seen = new Set<string>()
      for (const item of toCreate) {
        const { row, name } = item
        let code = item.code
        if (code) {
          if (seen.has(code) || byCode.has(code)) {
            skipped++
            warn(`${code} (${name}): code appears twice in the sheet — second row skipped`)
            continue
          }
          const clash = await tx
            .select({ id: facilities.id })
            .from(facilities)
            .where(sql`upper(${facilities.facilityCode}) = ${code}`)
            .limit(1)
          if (clash.length > 0) {
            skipped++
            warn(`${code} (${name}): code already exists — skipped`)
            continue
          }
        } else {
          code = await generateFacilityCode(tx)
        }
        seen.add(code)
        const emailFound = cell(row, 'email').match(EMAIL_RE)
        const revRaw = cell(row, 'revShare').replace('%', '')
        const revNum = parseFloat(revRaw)
        await tx.insert(facilities).values({
          name,
          facilityCode: code,
          address: cell(row, 'address') || null,
          phone: cell(row, 'phone') || null,
          contactEmail: emailFound ? emailFound[0] : null,
          timezone: mapTimezone(cell(row, 'timezone')) ?? 'America/New_York',
          paymentType: mapBillingType(cell(row, 'billing')) ?? 'ip',
          ...(revRaw && !isNaN(revNum) && revNum >= 0 && revNum <= 100 ? { revSharePercentage: Math.round(revNum) } : {}),
          portalSelfSignupEnabled: true, // P52 — signup on by default
          isDemo: false,
        })
        created++
        createdList.push({ facilityCode: code, name })
      }
    })
  }

  revalidateTag('facilities', {})

  return Response.json({
    data: { updated, created, skipped, namesFilled, emailsFilled, revShareSet, warnings, headerDetected, createdList: createdList.slice(0, 50) },
  })
}
