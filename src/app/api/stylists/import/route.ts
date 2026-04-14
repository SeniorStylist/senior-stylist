import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylists, facilities } from '@/db/schema'
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

const rowSchema = z.object({
  name: z.string().min(1).max(200),
  stylistCode: z.string().regex(/^ST\d{3,}$/).optional(),
  color: z.string().max(20).optional(),
  commissionPercent: z.number().min(0).max(100).optional(),
  facilityName: z.string().max(200).optional(),
  licenseNumber: z.string().max(200).optional(),
  licenseType: z.string().max(50).optional(),
  licenseExpiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

type ParsedRow = z.infer<typeof rowSchema>

function normalizeHeader(s: string): string {
  return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/_/g, '')
}

function mapRow(raw: Record<string, unknown>): {
  value?: ParsedRow
  error?: string
} {
  const byHeader: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v == null || v === '') continue
    byHeader[normalizeHeader(k)] = String(v).trim()
  }

  const name = byHeader.name
  if (!name) return { error: 'name is required' }

  const stylistCode = byHeader.stylistcode ?? byHeader.stcode ?? byHeader.code
  const commissionRaw = byHeader.commission ?? byHeader.commissionpercent
  let commissionPercent: number | undefined
  if (commissionRaw) {
    const cleaned = commissionRaw.replace(/%/g, '')
    const n = Number(cleaned)
    if (Number.isFinite(n)) commissionPercent = n
  }

  const candidate: Record<string, unknown> = {
    name,
    stylistCode,
    color: byHeader.color,
    commissionPercent,
    facilityName: byHeader.facility ?? byHeader.facilityname,
    licenseNumber: byHeader.licensenumber ?? byHeader.license,
    licenseType: byHeader.licensetype,
    licenseExpiresAt: byHeader.licenseexpires ?? byHeader.licenseexpiresat,
  }
  for (const k of Object.keys(candidate)) if (candidate[k] === undefined) delete candidate[k]

  const parsed = rowSchema.safeParse(candidate)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  }
  return { value: parsed.data }
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
    const isXlsx = /\.xlsx$/i.test(file.name) || /sheet/.test(file.type)

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
    const facilitiesByName = new Map<string, string>()
    for (const f of facilityRows) facilitiesByName.set(f.name.trim().toLowerCase(), f.id)

    const errors: { row: number; message: string }[] = []
    const validRows: { index: number; row: ParsedRow; facilityId: string | null }[] = []

    for (let i = 0; i < records.length; i++) {
      const mapped = mapRow(records[i])
      if (mapped.error || !mapped.value) {
        errors.push({ row: i + 2, message: mapped.error ?? 'invalid row' })
        continue
      }
      const row = mapped.value
      let facilityId: string | null = facilityUser.facilityId
      if (row.facilityName) {
        const match = facilitiesByName.get(row.facilityName.trim().toLowerCase())
        if (!match) {
          errors.push({ row: i + 2, message: `Unknown facility: ${row.facilityName}` })
          continue
        }
        facilityId = match
      }
      validRows.push({ index: i + 2, row, facilityId })
    }

    const result = await db.transaction(async (tx) => {
      let imported = 0
      let updated = 0
      for (const { index, row, facilityId } of validRows) {
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

          if (existing) {
            await tx
              .update(stylists)
              .set({
                name: row.name,
                ...(row.color ? { color: row.color } : {}),
                ...(row.commissionPercent != null
                  ? { commissionPercent: Math.round(row.commissionPercent) }
                  : {}),
                ...(facilityId !== undefined ? { facilityId } : {}),
                franchiseId,
                ...(row.licenseNumber !== undefined ? { licenseNumber: row.licenseNumber } : {}),
                ...(row.licenseType !== undefined ? { licenseType: row.licenseType } : {}),
                ...(row.licenseExpiresAt !== undefined
                  ? { licenseExpiresAt: row.licenseExpiresAt }
                  : {}),
                updatedAt: new Date(),
              })
              .where(eq(stylists.id, existing.id))
            updated++
          } else {
            const code = row.stylistCode ?? (await generateStylistCode(tx))
            await tx.insert(stylists).values({
              name: row.name,
              stylistCode: code,
              facilityId,
              franchiseId,
              ...(row.color ? { color: row.color } : {}),
              ...(row.commissionPercent != null
                ? { commissionPercent: Math.round(row.commissionPercent) }
                : {}),
              ...(row.licenseNumber ? { licenseNumber: row.licenseNumber } : {}),
              ...(row.licenseType ? { licenseType: row.licenseType } : {}),
              ...(row.licenseExpiresAt ? { licenseExpiresAt: row.licenseExpiresAt } : {}),
            })
            imported++
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
      return { imported, updated }
    })

    return Response.json({ data: { ...result, errors } })
  } catch (err) {
    console.error('POST /api/stylists/import error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

