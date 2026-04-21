import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { fuzzyBestMatch } from '@/lib/fuzzy'
import Papa from 'papaparse'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const VALID_PAYMENT_TYPES = new Set(['facility', 'ip', 'rfms', 'hybrid'])

function findCol(headers: string[], ...candidates: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().trim())
  for (const c of candidates) {
    const idx = lower.indexOf(c)
    if (idx !== -1) return idx
  }
  return -1
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
  if (rows.length < 2) return Response.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 })

  const headers = rows[0]
  const dataRows = rows.slice(1)

  const nameCol = findCol(headers, 'name', 'facility', 'facility name')
  const emailCol = findCol(headers, 'email', 'contact email', 'contact_email')
  const typeCol = findCol(headers, 'payment type', 'payment_type', 'type')
  const revCol = findCol(headers, 'rev share', 'rev_share', 'rev share %', 'rev_share_percentage', 'rev share percentage')

  if (nameCol === -1) {
    return Response.json({ error: 'CSV must have a facility name column (Name, Facility, or "Facility Name")' }, { status: 400 })
  }

  const allFacilities = await db.query.facilities.findMany({
    where: eq(facilities.active, true),
    columns: { id: true, name: true, contactEmail: true, paymentType: true, revSharePercentage: true },
  })

  let updated = 0
  let skipped = 0
  let emailsFilled = 0
  let revShareSet = 0
  const warnings: string[] = []

  for (const row of dataRows) {
    const rawName = (row[nameCol] ?? '').trim()
    if (!rawName) continue

    const match = fuzzyBestMatch(allFacilities, rawName, 0.7)
    if (!match) {
      skipped++
      if (warnings.length < 50) warnings.push(`No facility match for: "${rawName}"`)
      continue
    }

    const updates: Partial<typeof facilities.$inferInsert> = {}

    if (emailCol !== -1) {
      const email = (row[emailCol] ?? '').trim()
      if (email && !match.contactEmail) {
        updates.contactEmail = email
        emailsFilled++
      }
    }

    if (typeCol !== -1) {
      const ptype = (row[typeCol] ?? '').trim().toLowerCase()
      if (VALID_PAYMENT_TYPES.has(ptype)) {
        updates.paymentType = ptype
      }
    }

    if (revCol !== -1) {
      const rawRev = (row[revCol] ?? '').trim().replace('%', '')
      const revNum = parseInt(rawRev, 10)
      if (!isNaN(revNum) && revNum >= 0 && revNum <= 100) {
        updates.revSharePercentage = revNum
        revShareSet++
      }
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
