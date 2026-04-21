import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import Papa from 'papaparse'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// col[1] must be a valid F-code: F120, F1200, etc.
const F_CODE_RE = /^F\d{2,4}$/

// Extract first email address from a cell value
const EMAIL_RE = /[\w.+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/

// Map billing type values from the CSV to DB payment_type values
function mapBillingType(raw: string): string | null {
  const v = raw.toUpperCase().trim()
  if (v.includes('IP') && v.includes('F')) return 'hybrid'
  if (v === 'IP' || v === 'IPM' || v.startsWith('IP')) return 'ip'
  if (v === 'F' || v === 'NB' || v === 'SC' || v.startsWith('F')) return 'rfms'
  return null
}

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

  const text = await csvFile.text()
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true })
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return Response.json({ error: 'Could not parse CSV' }, { status: 400 })
  }

  const rows = parsed.data as string[][]
  // Skip header row — first data row with a valid F-code starts processing
  const dataRows = rows.slice(1)

  // Pre-load all facilities keyed by facilityCode for O(1) lookup
  const allFacilities = await db.query.facilities.findMany({
    where: eq(facilities.active, true),
    columns: { id: true, facilityCode: true, name: true, contactEmail: true, paymentType: true, revSharePercentage: true },
  })
  const byCode = new Map(
    allFacilities.filter((f) => f.facilityCode).map((f) => [f.facilityCode!, f])
  )

  // CSV column layout:
  // col[0] = notes/prefix (blank or context label)
  // col[1] = F-code (e.g. "F127")
  // col[2] = priority (A/B/C)
  // col[3] = facility NAME
  // col[4] = billing type (F, IP, NB, etc.)
  // col[5] = rev share % (e.g. "10.00%")
  // col[6] = contact email
  // col[8] = phone
  // col[9] = address

  let updated = 0
  let skipped = 0
  let namesFilled = 0
  let emailsFilled = 0
  let revShareSet = 0
  const warnings: string[] = []

  for (const row of dataRows) {
    const facilityCode = (row[1] ?? '').trim()

    // Skip rows without a valid F-code (header continuations, totals, blank rows)
    if (!F_CODE_RE.test(facilityCode)) continue

    const match = byCode.get(facilityCode)
    if (!match) {
      skipped++
      const rowName = (row[3] ?? '').trim()
      if (warnings.length < 50) warnings.push(`No DB facility for ${facilityCode}${rowName ? ` (${rowName})` : ''}`)
      continue
    }

    const updates: Partial<typeof facilities.$inferInsert> = {}

    // col[3] = facility name (fill if null/empty)
    const csvName = (row[3] ?? '').trim()
    if (csvName && (!match.name || match.name.trim() === '')) {
      updates.name = csvName
      namesFilled++
    }

    // col[4] = billing type (always overwrite if valid)
    const billingRaw = (row[4] ?? '').trim()
    if (billingRaw) {
      const mappedType = mapBillingType(billingRaw)
      if (mappedType) updates.paymentType = mappedType
    }

    // col[5] = rev share percentage (always overwrite if valid 0–100)
    const revRaw = (row[5] ?? '').trim().replace('%', '')
    const revNum = parseFloat(revRaw)
    if (!isNaN(revNum) && revNum >= 0 && revNum <= 100) {
      updates.revSharePercentage = Math.round(revNum)
      revShareSet++
    }

    // col[6] = contact email (fill if null/empty)
    const emailRaw = (row[6] ?? '').trim()
    const emailFound = emailRaw.match(EMAIL_RE)
    if (emailFound && !match.contactEmail) {
      updates.contactEmail = emailFound[0]
      emailsFilled++
    }

    // col[8] = phone (always overwrite if provided)
    const phoneRaw = (row[8] ?? '').trim()
    if (phoneRaw) updates.phone = phoneRaw

    // col[9] = address (always overwrite if provided)
    const addressRaw = (row[9] ?? '').trim()
    if (addressRaw) updates.address = addressRaw

    if (Object.keys(updates).length > 0) {
      await db.update(facilities).set(updates).where(eq(facilities.id, match.id))
      updated++
    } else {
      skipped++
    }
  }

  return Response.json({ data: { updated, skipped, namesFilled, emailsFilled, revShareSet, warnings } })
}
