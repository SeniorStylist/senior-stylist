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
  // Skip header row(s) — first data row with a valid F-code starts processing
  const dataRows = rows.slice(1)

  // Pre-load all facilities keyed by facilityCode for O(1) lookup
  const allFacilities = await db.query.facilities.findMany({
    where: eq(facilities.active, true),
    columns: { id: true, facilityCode: true, contactEmail: true, paymentType: true, revSharePercentage: true },
  })
  const byCode = new Map(
    allFacilities.filter((f) => f.facilityCode).map((f) => [f.facilityCode!, f])
  )

  let updated = 0
  let skipped = 0
  let emailsFilled = 0
  let revShareSet = 0
  const warnings: string[] = []

  for (const row of dataRows) {
    const facilityCode = (row[1] ?? '').trim()
    const name = (row[0] ?? '').trim()

    // Skip rows without a valid F-code (header continuations, totals, blank rows)
    if (!F_CODE_RE.test(facilityCode)) continue

    // Skip junk rows: col[3] contains "@", "IS NOW", or "see above"
    const col3 = (row[3] ?? '').toLowerCase()
    if (col3.includes('@') || col3.includes('is now') || col3.includes('see above')) continue

    const match = byCode.get(facilityCode)
    if (!match) {
      skipped++
      if (warnings.length < 50) warnings.push(`No DB facility for ${facilityCode}${name ? ` (${name})` : ''}`)
      continue
    }

    const updates: Partial<typeof facilities.$inferInsert> = {}

    // col[3] = contact email (fill if null/empty)
    const email = (row[3] ?? '').trim()
    if (email && !email.toLowerCase().includes('is now') && !email.includes('@') === false && !match.contactEmail) {
      // email is in col[3] only when it looks like an email address
      if (email.includes('@')) {
        updates.contactEmail = email
        emailsFilled++
      }
    }

    // col[4] = billing type
    const billingRaw = (row[4] ?? '').trim()
    if (billingRaw) {
      const mappedType = mapBillingType(billingRaw)
      if (mappedType) updates.paymentType = mappedType
    }

    // col[5] = rev share percentage
    const revRaw = (row[5] ?? '').trim().replace('%', '')
    const revNum = parseInt(revRaw, 10)
    if (!isNaN(revNum) && revNum >= 0 && revNum <= 100) {
      updates.revSharePercentage = revNum
      revShareSet++
    }

    if (Object.keys(updates).length > 0) {
      await db.update(facilities).set(updates).where(eq(facilities.id, match.id))
      updated++
    } else {
      skipped++
    }
  }

  return Response.json({ data: { updated, skipped, emailsFilled, revShareSet, warnings } })
}
