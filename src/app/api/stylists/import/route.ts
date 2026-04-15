import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylists, facilities, stylistAvailability, franchises, franchiseFacilities } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { generateStylistCode } from '@/lib/stylist-code'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_ROWS = 200

// Column names that indicate a row is the real header row
const HEADER_SIGNALS = ['lname', 'fname', 'id', 'name', 'stcode', 'stylistcode', '%pd', 'schedule']

function isHeaderRow(row: unknown[]): boolean {
  const cells = row.map((c) => String(c ?? '').toLowerCase().trim())
  return HEADER_SIGNALS.some((sig) => cells.includes(sig))
}

/**
 * Scan the first 5 rows of raw (no-header) parsed data for the real header row.
 * Returns { headers: string[], dataRows: unknown[][] } — headers derived from the
 * detected row; dataRows = everything after it.
 */
function detectHeaderRow(rows: unknown[][]): { headers: string[]; dataRows: unknown[][] } | null {
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if (isHeaderRow(rows[i])) {
      return {
        headers: (rows[i] as unknown[]).map((c) => String(c ?? '').trim()),
        dataRows: rows.slice(i + 1),
      }
    }
  }
  return null
}

function rawRowsToRecords(headers: string[], dataRows: unknown[][]): Record<string, unknown>[] {
  return dataRows.map((row) => {
    const rec: Record<string, unknown> = {}
    headers.forEach((h, idx) => {
      if (h) rec[h] = (row as unknown[])[idx] ?? ''
    })
    return rec
  })
}

// Fields to silently skip (never store)
const SKIP_HEADERS = new Set([
  'bankact', 'bankaccount', 'bankrout', 'bankrouting', 'bankname',
  'ssid', 'ssn', 'socialsecuritynumber',
])

const DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
}

const rowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(200).optional(),
  stylistCode: z.string().regex(/^ST\d{3,}$/).optional(),
  color: z.string().max(20).optional(),
  commissionPercent: z.number().int().min(0).max(100).optional(),
  paymentMethod: z.string().max(50).optional(),
  licenseState: z.string().max(200).optional(),
  licenseNumber: z.string().max(200).optional(),
  licenseType: z.string().max(100).optional(),
  licenseExpiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // email: pre-validated for format before Zod, Zod just caps length
  email: z.string().max(320).optional(),
  address: z.string().max(500).optional(),
  schedule: z.string().max(2000).optional(),
  facilityName: z.string().max(200).optional(),
})

type ParsedRow = z.infer<typeof rowSchema> & {
  derivedName?: string
  phonesRaw?: Array<{ label: string; number: string }>
}

function normalizeHeader(s: string): string {
  return String(s || '').toLowerCase().replace(/[\s_%]/g, '').replace(/_/g, '')
}

/** Parse a raw phone string — handles "or", "or alternate", "/" separators */
function parsePhones(raw: string): Array<{ label: string; number: string }> {
  const parts = raw
    .split(/\s+or\s+alternate\s*|\s+or\s+|\s*\/\s*|\s*&\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.map((p) => ({ label: 'mobile', number: p.slice(0, 50) }))
}

function mapRow(raw: Record<string, unknown>): {
  value?: ParsedRow
  error?: string
} {
  const byHeader: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const nh = normalizeHeader(k)
    if (SKIP_HEADERS.has(nh)) continue
    if (v == null || v === '') continue
    byHeader[nh] = String(v).trim()
  }

  // ST code mapping — drop silently if wrong format (auto-generate instead)
  let stylistCode: string | undefined = byHeader.id ?? byHeader.stcode ?? byHeader.stylistcode ?? byHeader.code
  if (stylistCode && !/^ST\d{3,}$/.test(stylistCode)) {
    stylistCode = undefined
  }

  // Name handling: FNAME+LNAME or name
  const firstName = byHeader.fname ?? byHeader.firstname
  const lastName = byHeader.lname ?? byHeader.lastname
  let derivedName: string | undefined
  if (firstName || lastName) {
    derivedName = [firstName, lastName].filter(Boolean).join(' ').trim()
  }
  const nameField = byHeader.name ?? derivedName

  if (!nameField) return { error: 'name (or FNAME/LNAME) is required' }

  // Commission: strip %, parse float, round to int, clamp 0–100
  const commissionRaw = byHeader['pd'] ?? byHeader['paid'] ?? byHeader.commission ?? byHeader.commissionpercent
  let commissionPercent: number | undefined
  if (commissionRaw) {
    const cleaned = commissionRaw.replace(/%/g, '')
    const n = parseFloat(cleaned)
    if (Number.isFinite(n) && n >= 0) {
      commissionPercent = Math.min(100, Math.round(n))
    }
  }

  // Address + zip
  let address = byHeader.address
  const zip = byHeader.zip ?? byHeader.zipcode
  if (address && zip && !address.endsWith(zip)) {
    address = `${address} ${zip}`
  } else if (!address && zip) {
    address = zip
  }

  // Email: drop silently if invalid format
  let email: string | undefined = byHeader.email
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    email = undefined
  }

  // Phone: parse raw string into structured array (not part of Zod schema)
  const phonesRaw = byHeader.phone ? parsePhones(byHeader.phone) : undefined

  const candidate: Record<string, unknown> = {
    name: nameField,
    stylistCode,
    color: byHeader.color,
    commissionPercent,
    paymentMethod: byHeader.howpd ?? byHeader.howpaid ?? byHeader.paymentmethod,
    licenseState: byHeader.licensest ?? byHeader.licensestate ?? byHeader.licensedstate,
    licenseNumber: byHeader.licensenumber ?? byHeader.licenseno ?? byHeader.licensenum ?? byHeader.license,
    licenseType: byHeader.licensetype,
    licenseExpiresAt:
      byHeader.licenseexpires ??
      byHeader.licenseexpireson ??
      byHeader.licenseexpiresdate ??
      byHeader.licenseexpiresat,
    email,
    address,
    schedule: byHeader.schedule,
    facilityName: byHeader.facility ?? byHeader.facilityname,
  }

  for (const k of Object.keys(candidate)) if (candidate[k] === undefined) delete candidate[k]

  const parsed = rowSchema.safeParse(candidate)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  }
  return { value: { ...parsed.data, derivedName, phonesRaw } }
}

interface GeminiScheduleEntry {
  facility: string
  days: string[]
}

/**
 * Send ALL schedule texts in a single Gemini request, indexed by position.
 * Returns a map from index → parsed entries (or empty array on parse failure for that row).
 * Returns null if the entire call fails — callers should fall back to raw scheduleNotes.
 */
async function batchParseSchedulesWithGemini(
  schedules: { index: number; text: string }[]
): Promise<Map<number, GeminiScheduleEntry[]> | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key || schedules.length === 0) return null

  const schedulesBlock = schedules
    .map(({ index, text }) => `${index}: ${text}`)
    .join('\n')

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`
    const body = {
      contents: [{
        parts: [{
          text: `Parse each of these stylist schedule strings into structured JSON.
Return a JSON object where each key is the index (as a string) and the value is an array of {facility, days[]} objects.
Normalize day names to full English: "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday".
Split day ranges like "Tuesdays and Thursdays" into separate days.
Ignore notes like "starting 9/23", "every other", "fill in", "available".
If a schedule cannot be parsed, use an empty array [].
Return ONLY valid JSON with no markdown, no explanation:
{"0": [{"facility": "Name", "days": ["Monday"]}], "1": [], ...}

Schedules:
${schedulesBlock}`,
        }]
      }]
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null

    const data = await res.json()
    const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    // Strip any accidental markdown fences
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned) as Record<string, GeminiScheduleEntry[]>

    const result = new Map<number, GeminiScheduleEntry[]>()
    for (const [k, v] of Object.entries(parsed)) {
      const idx = parseInt(k, 10)
      if (!isNaN(idx) && Array.isArray(v)) result.set(idx, v)
    }
    return result
  } catch {
    return null
  }
}

function fuzzyMatchFacility(
  name: string,
  facilities: { id: string; name: string }[]
): { id: string; name: string } | null {
  const lower = name.toLowerCase().trim()
  // 1. Exact case-insensitive
  const exact = facilities.find((f) => f.name.toLowerCase().trim() === lower)
  if (exact) return exact
  // 2. Substring in either direction
  const matches = facilities.filter(
    (f) =>
      f.name.toLowerCase().trim().includes(lower) ||
      lower.includes(f.name.toLowerCase().trim())
  )
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    // Pick the one with most characters in common (longest name match)
    return matches.sort((a, b) => b.name.length - a.name.length)[0]
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const rl = await checkRateLimit('import', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return Response.json({ error: 'file is required' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const isXlsx = /\.xlsx?$/i.test(file.name) || /sheet/.test(file.type)

    let records: Record<string, unknown>[] = []
    if (isXlsx) {
      const wb = XLSX.read(buffer, { type: 'buffer' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      // Parse as array of arrays so we can detect the real header row
      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
      const detected = detectHeaderRow(rawRows)
      if (detected) {
        records = rawRowsToRecords(detected.headers, detected.dataRows.filter((r) =>
          (r as unknown[]).some((c) => String(c ?? '').trim() !== '')
        ))
      } else {
        // Fallback: let xlsx auto-detect headers normally
        records = XLSX.utils.sheet_to_json(ws, { defval: '' })
      }
    } else {
      const text = buffer.toString('utf-8')
      // Parse without headers first so we can detect the real header row
      const rawParsed = Papa.parse<unknown[]>(text, {
        header: false,
        skipEmptyLines: true,
      })
      const detected = detectHeaderRow(rawParsed.data)
      if (detected) {
        records = rawRowsToRecords(detected.headers, detected.dataRows)
      } else {
        // Fallback: re-parse with header: true (first row is the header)
        const parsed = Papa.parse<Record<string, unknown>>(text, {
          header: true,
          skipEmptyLines: true,
        })
        records = parsed.data
      }
    }

    if (records.length === 0) {
      return Response.json({ error: 'File is empty or unreadable' }, { status: 422 })
    }
    if (records.length > MAX_ROWS) {
      return Response.json({ error: `File exceeds ${MAX_ROWS} rows` }, { status: 422 })
    }

    let franchise = await getUserFranchise(user.id)

    // Fallback for master admin in "Viewing as" mode: getUserFranchise may return null
    // because the super admin email doesn't have a matching facility_users row for every
    // franchise facility. Query franchises directly and use the first one.
    if (!franchise) {
      const isMasterAdmin =
        process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
        user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

      if (isMasterAdmin) {
        // Find the franchise that owns the current facility
        const franchiseMembership = await db
          .select({
            franchiseId: franchiseFacilities.franchiseId,
            franchiseName: franchises.name,
          })
          .from(franchiseFacilities)
          .innerJoin(franchises, eq(franchises.id, franchiseFacilities.franchiseId))
          .where(eq(franchiseFacilities.facilityId, facilityUser.facilityId))
          .limit(1)

        if (franchiseMembership.length > 0) {
          const { franchiseId: fid, franchiseName } = franchiseMembership[0]
          const siblingRows = await db
            .select({ facilityId: franchiseFacilities.facilityId })
            .from(franchiseFacilities)
            .where(eq(franchiseFacilities.franchiseId, fid))
          franchise = {
            franchiseId: fid,
            franchiseName,
            facilityIds: siblingRows.map((r) => r.facilityId),
          }
        } else {
          // Last resort: use the first franchise in the DB
          const firstFranchise = await db
            .select({ id: franchises.id, name: franchises.name })
            .from(franchises)
            .limit(1)
          if (firstFranchise.length > 0) {
            const fid = firstFranchise[0].id
            const siblingRows = await db
              .select({ facilityId: franchiseFacilities.facilityId })
              .from(franchiseFacilities)
              .where(eq(franchiseFacilities.franchiseId, fid))
            franchise = {
              franchiseId: fid,
              franchiseName: firstFranchise[0].name,
              facilityIds: siblingRows.map((r) => r.facilityId),
            }
          }
        }
      }
    }

    if (!franchise) {
      console.warn(
        `[import] franchiseId is null for user=${user.id} facility=${facilityUser.facilityId} — stylists will be imported without franchise association`,
      )
    }

    const allowedFacilityIds = franchise?.facilityIds ?? [facilityUser.facilityId]
    const franchiseId = franchise?.franchiseId ?? null

    const facilityRows = await db
      .select({ id: facilities.id, name: facilities.name })
      .from(facilities)
      .where(inArray(facilities.id, allowedFacilityIds))

    const errors: { row: number; message: string }[] = []
    const validRows: { index: number; row: ParsedRow; resolvedFacilityId: string | null }[] = []

    for (let i = 0; i < records.length; i++) {
      const mapped = mapRow(records[i])
      if (mapped.error || !mapped.value) {
        errors.push({ row: i + 2, message: mapped.error ?? 'invalid row' })
        continue
      }
      const row = mapped.value
      let resolvedFacilityId: string | null = null  // franchise pool by default
      if (row.facilityName) {
        const match = facilityRows.find(
          (f) => f.name.toLowerCase().trim() === row.facilityName!.toLowerCase().trim()
        )
        if (!match) {
          errors.push({ row: i + 2, message: `Unknown facility: ${row.facilityName}` })
          continue
        }
        resolvedFacilityId = match.id
      }
      validRows.push({ index: i + 2, row, resolvedFacilityId })
    }

    // Batch all schedule texts into a single Gemini call before the transaction
    const schedulesToParse = validRows
      .map(({ row }, vi) => (row.schedule ? { index: vi, text: row.schedule } : null))
      .filter((x): x is { index: number; text: string } => x !== null)

    // geminiMap: vi → parsed entries. null = entire batch call failed (fall back to raw notes)
    const geminiMap = await batchParseSchedulesWithGemini(schedulesToParse)

    const result = await db.transaction(async (tx) => {
      let imported = 0
      let updated = 0
      let availabilityCreated = 0
      let scheduleNotesCount = 0

      for (let vi = 0; vi < validRows.length; vi++) {
        const { index, row, resolvedFacilityId } = validRows[vi]
        try {
          let existing: { id: string } | undefined
          if (row.stylistCode) {
            const match = await tx
              .select({ id: stylists.id })
              .from(stylists)
              .where(eq(stylists.stylistCode, row.stylistCode))
              .limit(1)
            if (match.length) existing = match[0]
          }

          // Build schedule notes from Gemini batch parse
          let scheduleNotes: string | null = null
          let parsedSchedule: GeminiScheduleEntry[] | null = null

          if (row.schedule) {
            if (geminiMap === null) {
              // Entire batch call failed — store raw text for all rows
              scheduleNotes = row.schedule
            } else {
              const entries = geminiMap.get(vi)
              if (entries && entries.length > 0) {
                parsedSchedule = entries
              } else {
                // Gemini returned [] for this row — store raw text
                scheduleNotes = row.schedule
              }
            }
          }

          // Build shared fields
          const sharedFields = {
            ...(row.color ? { color: row.color } : {}),
            ...(row.commissionPercent != null
              ? { commissionPercent: Math.round(row.commissionPercent) }
              : {}),
            ...(row.licenseNumber !== undefined ? { licenseNumber: row.licenseNumber } : {}),
            ...(row.licenseType !== undefined ? { licenseType: row.licenseType } : {}),
            ...(row.licenseState !== undefined ? { licenseState: row.licenseState } : {}),
            ...(row.licenseExpiresAt !== undefined ? { licenseExpiresAt: row.licenseExpiresAt } : {}),
            ...(row.email !== undefined ? { email: row.email } : {}),
            ...(row.phonesRaw?.length ? { phones: row.phonesRaw } : {}),
            ...(row.address !== undefined ? { address: row.address } : {}),
            ...(row.paymentMethod !== undefined ? { paymentMethod: row.paymentMethod } : {}),
          }

          let stylistId: string

          if (existing) {
            // Merge scheduleNotes: append if existing
            let mergedNotes = scheduleNotes
            if (scheduleNotes) {
              const existingRow = await tx
                .select({ scheduleNotes: stylists.scheduleNotes })
                .from(stylists)
                .where(eq(stylists.id, existing.id))
                .limit(1)
              const prev = existingRow[0]?.scheduleNotes
              if (prev) mergedNotes = `${prev} | ${scheduleNotes}`
            }

            await tx
              .update(stylists)
              .set({
                name: row.name ?? row.derivedName ?? '',
                ...sharedFields,
                ...(resolvedFacilityId !== undefined ? { facilityId: resolvedFacilityId } : {}),
                franchiseId,
                ...(mergedNotes !== null ? { scheduleNotes: mergedNotes } : {}),
                updatedAt: new Date(),
              })
              .where(eq(stylists.id, existing.id))
            stylistId = existing.id
            updated++
          } else {
            const code = row.stylistCode ?? (await generateStylistCode(tx))
            const [inserted] = await tx.insert(stylists).values({
              name: row.name ?? row.derivedName ?? '',
              stylistCode: code,
              facilityId: resolvedFacilityId,
              franchiseId,
              ...sharedFields,
              ...(scheduleNotes !== null ? { scheduleNotes } : {}),
            }).returning({ id: stylists.id })
            stylistId = inserted.id
            imported++
          }

          // Create availability rows from Gemini parse
          if (parsedSchedule && parsedSchedule.length > 0 && resolvedFacilityId) {
            const dayAssigned = new Map<number, string>() // dayOfWeek → facilityId
            const unmatchedNotes: string[] = []

            for (const entry of parsedSchedule) {
              const matchedFacility = fuzzyMatchFacility(entry.facility, facilityRows)
              const targetFacilityId = matchedFacility?.id ?? resolvedFacilityId

              for (const dayName of entry.days) {
                const dow = DAY_NAMES[dayName.toLowerCase()]
                if (dow === undefined) continue

                if (dayAssigned.has(dow)) {
                  // Conflict: day already assigned to another facility
                  const conflictNote = `${dayName} at ${entry.facility} (conflict: already assigned to another facility)`
                  unmatchedNotes.push(conflictNote)
                  continue
                }

                if (!matchedFacility && allowedFacilityIds.length > 0) {
                  unmatchedNotes.push(`${entry.facility}: ${dayName}`)
                  continue
                }

                dayAssigned.set(dow, targetFacilityId)
                await tx.insert(stylistAvailability).values({
                  stylistId,
                  facilityId: targetFacilityId,
                  dayOfWeek: dow,
                  startTime: '09:00',
                  endTime: '17:00',
                  active: true,
                }).onConflictDoNothing()
                availabilityCreated++
              }
            }

            if (unmatchedNotes.length > 0) {
              const unmatchedStr = unmatchedNotes.join('; ')
              // Merge with existing scheduleNotes
              const existingRow = await tx
                .select({ scheduleNotes: stylists.scheduleNotes })
                .from(stylists)
                .where(eq(stylists.id, stylistId))
                .limit(1)
              const prev = existingRow[0]?.scheduleNotes
              const merged = prev ? `${prev} | ${unmatchedStr}` : unmatchedStr
              await tx.update(stylists).set({ scheduleNotes: merged }).where(eq(stylists.id, stylistId))
              scheduleNotesCount++
            }
          } else if (scheduleNotes) {
            scheduleNotesCount++
          }
        } catch (err) {
          const code = (err as { code?: string } | null)?.code
          if (code === '23505') {
            errors.push({ row: index, message: 'stylist_code already in use' })
          } else {
            errors.push({ row: index, message: (err as Error).message ?? 'insert failed' })
          }
        }
      }

      return { imported, updated, availabilityCreated, scheduleNotes: scheduleNotesCount }
    })

    return Response.json({ data: { ...result, errors } })
  } catch (err) {
    console.error('POST /api/stylists/import error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
