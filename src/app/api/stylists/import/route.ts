import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylists, facilities, stylistAvailability } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { generateStylistCode } from '@/lib/stylist-code'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_ROWS = 200

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
  email: z.string().email().max(320).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  schedule: z.string().max(2000).optional(),
  facilityName: z.string().max(200).optional(),
})

type ParsedRow = z.infer<typeof rowSchema> & { derivedName?: string }

function normalizeHeader(s: string): string {
  return String(s || '').toLowerCase().replace(/[\s_%]/g, '').replace(/_/g, '')
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

  // ST code mapping
  const stylistCode = byHeader.id ?? byHeader.stcode ?? byHeader.stylistcode ?? byHeader.code

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
    email: byHeader.email,
    phone: byHeader.phone,
    address,
    schedule: byHeader.schedule,
    facilityName: byHeader.facility ?? byHeader.facilityname,
  }

  for (const k of Object.keys(candidate)) if (candidate[k] === undefined) delete candidate[k]

  const parsed = rowSchema.safeParse(candidate)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  }
  return { value: { ...parsed.data, derivedName } }
}

interface GeminiScheduleEntry {
  facility: string
  days: string[]
}

async function parseScheduleWithGemini(scheduleText: string): Promise<GeminiScheduleEntry[] | null> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`
    const body = {
      contents: [{
        parts: [{
          text: `You are parsing a stylist scheduling string into structured JSON.
Extract every facility name and its associated days of the week.
Normalize day names to full English: "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday".
If a day range like "Tuesdays and Thursdays" is mentioned, split into separate days.
Ignore notes like "starting 9/23", "every other", "fill in", "available".
Return ONLY a JSON array with no markdown, no explanation:
[{"facility": "Facility Name", "days": ["Monday", "Tuesday"]}]
If nothing can be parsed, return: []

Schedule text: ${scheduleText}`,
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
    const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    return JSON.parse(text.trim()) as GeminiScheduleEntry[]
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
      records = XLSX.utils.sheet_to_json(ws, { defval: '' })
    } else {
      const text = buffer.toString('utf-8')
      const parsed = Papa.parse<Record<string, unknown>>(text, {
        header: true,
        skipEmptyLines: true,
      })
      records = parsed.data
    }

    if (records.length === 0) {
      return Response.json({ error: 'File is empty or unreadable' }, { status: 422 })
    }
    if (records.length > MAX_ROWS) {
      return Response.json({ error: `File exceeds ${MAX_ROWS} rows` }, { status: 422 })
    }

    const franchise = await getUserFranchise(user.id)
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
      let resolvedFacilityId: string | null = facilityUser.facilityId
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

    // Fire all Gemini calls in parallel before entering the transaction
    const geminiResults = await Promise.allSettled(
      validRows.map(({ row }) =>
        row.schedule ? parseScheduleWithGemini(row.schedule) : Promise.resolve(null)
      )
    )

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

          // Build schedule notes from Gemini parse
          let scheduleNotes: string | null = null
          const geminiResult = geminiResults[vi]
          let parsedSchedule: GeminiScheduleEntry[] | null = null

          if (row.schedule) {
            if (geminiResult.status === 'fulfilled' && Array.isArray(geminiResult.value)) {
              parsedSchedule = geminiResult.value
            } else {
              // Fallback: store raw text
              scheduleNotes = row.schedule
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
            ...(row.phone !== undefined ? { phone: row.phone } : {}),
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
