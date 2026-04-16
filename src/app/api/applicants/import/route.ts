import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { applicants } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import Papa from 'papaparse'
import type { ApplicantStatus } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_ROWS = 2000

const STATUS_MAP: Record<string, ApplicantStatus> = {
  'awaiting review': 'new',
  'reviewed': 'reviewing',
  'contacting': 'contacting',
  'rejected': 'rejected',
  'hired': 'hired',
}

function parseIndeedDate(raw: string): string | null {
  if (!raw?.trim()) return null
  // MM/DD/YYYY or M/D/YYYY
  const slash = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) {
    const [, m, d, y] = slash
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim()
  return null
}

function norm(s: string): string {
  return s.toLowerCase().trim()
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const franchise = await getUserFranchise(user.id)
    if (!franchise) return Response.json({ error: 'No franchise' }, { status: 400 })

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    const text = await file.text()

    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => norm(h),
    })

    const rows = parsed.data
    if (rows.length > MAX_ROWS) {
      return Response.json({ error: `CSV exceeds ${MAX_ROWS} row limit` }, { status: 422 })
    }

    // Load all existing applicants for this franchise (including inactive) for dedup
    const existing = await db
      .select({ email: applicants.email, name: applicants.name, appliedDate: applicants.appliedDate })
      .from(applicants)
      .where(eq(applicants.franchiseId, franchise.franchiseId))

    const existingKeys = new Set<string>()
    for (const r of existing) {
      if (r.email) existingKeys.add(`email:${r.email.toLowerCase()}`)
      if (r.name && r.appliedDate) existingKeys.add(`namedate:${r.name.toLowerCase()}:${r.appliedDate}`)
    }

    const toInsert: typeof applicants.$inferInsert[] = []
    let skipped = 0
    const errors: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]

      try {
        const name = row['name']?.trim()
        if (!name) { errors.push(`Row ${i + 2}: missing name`); continue }

        const emailRaw = row['email']?.trim() ?? null
        const email = emailRaw || null
        const isIndeedEmail = !!email && email.toLowerCase().endsWith('@indeedemail.com')

        const appliedDate = parseIndeedDate(row['date'] ?? '')
        const statusRaw = norm(row['status'] ?? '')
        const status: ApplicantStatus = STATUS_MAP[statusRaw] ?? 'new'

        // Dedup check
        const emailKey = email ? `email:${email.toLowerCase()}` : null
        const nameKey = name && appliedDate ? `namedate:${name.toLowerCase()}:${appliedDate}` : null
        if ((emailKey && existingKeys.has(emailKey)) || (nameKey && existingKeys.has(nameKey))) {
          skipped++
          continue
        }

        // Build qualifications array
        const qualifications: Array<{ question: string; answer: string; match: string }> = []
        for (let q = 1; q <= 4; q++) {
          const question = row[`qualification ${q}`]?.trim()
          if (!question) continue
          qualifications.push({
            question,
            answer: row[`qualification ${q} answer`]?.trim() ?? '',
            match: row[`qualification ${q} match`]?.trim() ?? '',
          })
        }

        const record: typeof applicants.$inferInsert = {
          franchiseId: franchise.franchiseId,
          name,
          email,
          isIndeedEmail,
          phone: row['phone']?.trim() || null,
          location: row['candidate location']?.trim() || null,
          appliedDate,
          jobTitle: row['job title']?.trim() || null,
          jobLocation: row['job location']?.trim() || null,
          relevantExperience: row['relevant experience']?.trim() || null,
          education: row['education']?.trim() || null,
          source: row['source']?.trim() || null,
          status,
          qualifications,
        }

        toInsert.push(record)

        // Register new keys to prevent within-batch dups
        if (emailKey) existingKeys.add(emailKey)
        if (nameKey) existingKeys.add(nameKey)
      } catch (e) {
        errors.push(`Row ${i + 2}: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
    }

    // Batch insert in chunks of 200
    let imported = 0
    const CHUNK = 200
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK)
      if (chunk.length === 0) continue
      await db.insert(applicants).values(chunk).onConflictDoNothing()
      imported += chunk.length
    }

    return Response.json({ data: { imported, skipped, errors } })
  } catch (err) {
    console.error('POST /api/applicants/import', err)
    return Response.json({ error: 'Import failed' }, { status: 500 })
  }
}
