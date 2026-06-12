// QB "Customer Contact List" CSV import — syncs resident POA contact info,
// links QB customers to existing residents (fuzzy merge), creates missing residents,
// and fills facility contact details. Master admin only.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { fuzzyScore } from '@/lib/fuzzy'
import { parseContactListCsv, chunkArr, type ContactResidentRow } from '@/lib/imports/qb-csv'
import { randomUUID } from 'crypto'
import { revalidateTag } from 'next/cache'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const LINK_THRESHOLD = 0.85
const MAX_WARNINGS = 200

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!superAdminEmail || user.email !== superAdminEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await checkRateLimit('qbImport', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    const parsed = parseContactListCsv(await file.text())
    if (parsed.residents.length === 0 && parsed.facilities.length === 0) {
      return Response.json({ error: 'No customer rows found — is this the QB "Customer Contact List" export?' }, { status: 400 })
    }

    const warnings: string[] = []
    const warn = (msg: string) => { if (warnings.length < MAX_WARNINGS) warnings.push(msg) }

    // Lookup maps
    const facilityRows = await db.select({
      id: facilities.id,
      facilityCode: facilities.facilityCode,
      qbCustomerId: facilities.qbCustomerId,
      phone: facilities.phone,
      contactEmail: facilities.contactEmail,
      address: facilities.address,
    }).from(facilities)
    const facilityByCode = new Map<string, typeof facilityRows[0]>()
    for (const f of facilityRows) {
      if (f.facilityCode) facilityByCode.set(f.facilityCode, f)
      if (f.qbCustomerId && !facilityByCode.has(f.qbCustomerId)) facilityByCode.set(f.qbCustomerId, f)
    }

    const residentRows = await db.select({
      id: residents.id,
      facilityId: residents.facilityId,
      name: residents.name,
      roomNumber: residents.roomNumber,
      qbCustomerId: residents.qbCustomerId,
    }).from(residents).where(eq(residents.active, true))
    const residentByQbId = new Map<string, typeof residentRows[0]>()
    const residentsByFacility = new Map<string, typeof residentRows>()
    for (const r of residentRows) {
      if (r.qbCustomerId) residentByQbId.set(r.qbCustomerId, r)
      const list = residentsByFacility.get(r.facilityId) ?? []
      list.push(r)
      residentsByFacility.set(r.facilityId, list)
    }

    const stats = {
      residentsUpdated: 0,
      residentsLinked: 0,
      residentsCreated: 0,
      facilitiesUpdated: 0,
      skippedNoFacility: 0,
      skippedRows: parsed.skipped,
    }

    type Update = { id: string; set: Record<string, unknown> }
    const updates: Update[] = []
    const creates: ContactResidentRow[] = []
    const claimedIds = new Set<string>() // a DB resident can only be linked to one QB customer per run

    for (const row of parsed.residents) {
      const contactSet: Record<string, unknown> = {}
      if (row.email) contactSet.poaEmail = row.email
      if (row.phone) contactSet.poaPhone = row.phone
      if (row.poaName) contactSet.poaName = row.poaName
      if (row.poaAddress) contactSet.poaAddress = row.poaAddress

      const exact = residentByQbId.get(row.qbCustomerId)
      if (exact) {
        if (Object.keys(contactSet).length > 0) {
          updates.push({ id: exact.id, set: contactSet })
          stats.residentsUpdated++
        }
        continue
      }

      const facility = facilityByCode.get(row.fCode)
      if (!facility) {
        stats.skippedNoFacility++
        warn(`No facility ${row.fCode} in DB — skipped resident "${row.name}"`)
        continue
      }

      // Fuzzy-link: merge with an existing in-app resident that has no QB link yet
      const candidates = (residentsByFacility.get(facility.id) ?? []).filter(
        (r) => !r.qbCustomerId && !claimedIds.has(r.id),
      )
      let best: typeof candidates[0] | null = null
      let bestScore = 0
      let tie = false
      for (const c of candidates) {
        const score = fuzzyScore(c.name, row.name)
        if (score > bestScore) { best = c; bestScore = score; tie = false }
        else if (score === bestScore && score >= LINK_THRESHOLD) tie = true
      }
      if (best && bestScore >= LINK_THRESHOLD && !tie) {
        claimedIds.add(best.id)
        updates.push({
          id: best.id,
          set: {
            ...contactSet,
            qbCustomerId: row.qbCustomerId,
            ...(row.room && !best.roomNumber ? { roomNumber: row.room } : {}),
          },
        })
        stats.residentsLinked++
        continue
      }

      creates.push(row)
    }

    // Apply updates in parallel chunks
    for (const ch of chunkArr(updates, 25)) {
      await Promise.all(ch.map(({ id, set }) =>
        db.update(residents).set({ ...set, updatedAt: new Date() }).where(eq(residents.id, id)),
      ))
    }

    // Create missing residents (dedupe by qbCustomerId within batch)
    const createMap = new Map<string, ContactResidentRow>()
    for (const r of creates) createMap.set(r.qbCustomerId, r)
    for (const ch of chunkArr(Array.from(createMap.values()), 50)) {
      const values = ch.map((r) => ({
        facilityId: facilityByCode.get(r.fCode)!.id,
        name: r.name,
        roomNumber: r.room,
        poaName: r.poaName,
        poaEmail: r.email,
        poaPhone: r.phone,
        poaAddress: r.poaAddress,
        qbCustomerId: r.qbCustomerId,
        portalToken: randomUUID(),
        active: true,
      }))
      await db.insert(residents).values(values).onConflictDoUpdate({
        target: residents.qbCustomerId,
        targetWhere: sql`${residents.qbCustomerId} IS NOT NULL`,
        set: {
          poaEmail: sql`COALESCE(excluded.poa_email, ${residents.poaEmail})`,
          poaPhone: sql`COALESCE(excluded.poa_phone, ${residents.poaPhone})`,
          poaName: sql`COALESCE(excluded.poa_name, ${residents.poaName})`,
          poaAddress: sql`COALESCE(excluded.poa_address, ${residents.poaAddress})`,
          updatedAt: new Date(),
        },
      })
      stats.residentsCreated += values.length
    }

    // Facility contact details — phone/address overwrite when present, email fill-if-null
    // (mirrors import-facilities-csv conventions)
    const facilityUpdates: Update[] = []
    for (const f of parsed.facilities) {
      const existing = facilityByCode.get(f.fCode)
      if (!existing) continue
      const set: Record<string, unknown> = {}
      if (f.phone && f.phone !== existing.phone) set.phone = f.phone
      if (f.address && f.address !== existing.address) set.address = f.address
      if (f.email && !existing.contactEmail) set.contactEmail = f.email
      if (Object.keys(set).length > 0) facilityUpdates.push({ id: existing.id, set })
    }
    for (const ch of chunkArr(facilityUpdates, 25)) {
      await Promise.all(ch.map(({ id, set }) =>
        db.update(facilities).set({ ...set, updatedAt: new Date() }).where(eq(facilities.id, id)),
      ))
      stats.facilitiesUpdated += ch.length
    }

    revalidateTag('facilities', {})

    return Response.json({ data: { ...stats, warnings } })
  } catch (err) {
    console.error('qb-import/contacts failed:', err)
    return Response.json({ error: 'Import failed — check file format and try again' }, { status: 500 })
  }
}
