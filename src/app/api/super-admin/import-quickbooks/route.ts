import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, facilityUsers, franchiseFacilities, franchises, profiles } from '@/db/schema'
import { eq, inArray, sql } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { randomUUID } from 'crypto'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

async function getSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) return null
  return user
}

// Facility format A: "F123 - Facility Name"
const FAC_A = /^(F\d+)\s*-\s*(.+)$/
// Facility format B: "F223 Sholom Home West" (space-separated, no dash)
const FAC_B = /^(F\d+)\s+(.+)$/
// Facility format C: "F127" (standalone code only)
const FAC_C = /^F\d+$/
// Resident format A: "F123:Last, First - Room"
const RES_A = /^F\d+:/
// Resident format B: "F174 - Facility Name:Last, First - Room"
const RES_B = /^F\d+\s*-\s*[^:]+:/

function classifyRow(nameVal: string): 'facilityA' | 'facilityB' | 'facilityC' | 'residentA' | 'residentB' | null {
  // Resident checks first — colon is the definitive marker
  if (RES_A.test(nameVal)) return 'residentA'
  if (RES_B.test(nameVal)) return 'residentB'
  // Facility checks — no colon variants
  if (!nameVal.includes(':')) {
    if (FAC_A.test(nameVal)) return 'facilityA'
    if (FAC_B.test(nameVal)) return 'facilityB'
    if (FAC_C.test(nameVal)) return 'facilityC'
  }
  return null
}

function parseResidentName(rest: string): { name: string; room: string | null } {
  const lastDash = rest.lastIndexOf(' - ')
  const room = lastDash !== -1 ? rest.slice(lastDash + 3).trim() : null
  const namePart = lastDash !== -1 ? rest.slice(0, lastDash).trim() : rest.trim()
  if (namePart.includes(', ')) {
    const commaIdx = namePart.indexOf(', ')
    const last = namePart.slice(0, commaIdx)
    const first = namePart.slice(commaIdx + 2)
    return { name: `${first.trim()} ${last.trim()}`, room }
  }
  return { name: namePart.trim(), room }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

export async function POST(request: Request) {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const rl = await checkRateLimit('qbImport', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' })

    // Parse all rows first — no DB
    const facilityRows: Array<{ qbId: string; name: string; row: Record<string, string> }> = []
    const residentRows: Array<{ facilityQbId: string; qbCustomerId: string; rest: string; row: Record<string, string> }> = []
    const warnings: string[] = []

    for (const row of rows) {
      const nameVal = (row['Name'] ?? row['name'] ?? '').trim()
      if (!nameVal) continue

      const kind = classifyRow(nameVal)

      if (kind === null) {
        warnings.push(`Skipped unrecognized row: ${nameVal.slice(0, 80)}`)
        continue
      }

      if (kind === 'facilityA' || kind === 'facilityB' || kind === 'facilityC') {
        let qbId: string
        let name: string
        if (kind === 'facilityA') {
          const m = FAC_A.exec(nameVal)!
          qbId = m[1]; name = m[2].trim()
        } else if (kind === 'facilityB') {
          const m = FAC_B.exec(nameVal)!
          qbId = m[1]; name = m[2].trim()
        } else {
          // Format C — standalone "F127": insert with empty name, admin can fill in later
          qbId = nameVal; name = ''
        }
        facilityRows.push({ qbId, name, row })
      } else {
        // Resident — extract F### from start, resident portion from after last colon
        const facilityQbId = /^(F\d+)/.exec(nameVal)![1]
        const colonIdx = nameVal.lastIndexOf(':')
        const rest = nameVal.slice(colonIdx + 1).trim()
        residentRows.push({ facilityQbId, qbCustomerId: nameVal, rest, row })
      }
    }

    // Deduplicate facilityRows by qbId — keep last occurrence
    // QB exports sometimes list the same F-code twice with different names
    const dedupFacilityMap = new Map<string, typeof facilityRows[0]>()
    for (const f of facilityRows) dedupFacilityMap.set(f.qbId, f)
    const dedupedFacilityRows = Array.from(dedupFacilityMap.values())

    const stats = {
      facilities: { created: 0, updated: 0 },
      residents: { created: 0, updated: 0, skipped: 0 },
    }

    // Find master admin profile + franchise
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.email, user.email!),
      columns: { id: true },
    })
    if (!profile) throw new Error('Master admin profile not found')

    const franchise = await db.query.franchises.findFirst({
      where: eq(franchises.ownerUserId, profile.id),
      columns: { id: true },
    })
    const franchiseId = franchise?.id ?? null

    // ── Facilities ──────────────────────────────────────────────────────────

    // Bulk fetch existing facilities by qbCustomerId
    const allFacilityQbIds = dedupedFacilityRows.map((f) => f.qbId)
    const existingFacilityRows = allFacilityQbIds.length > 0
      ? await db.query.facilities.findMany({
          where: inArray(facilities.qbCustomerId, allFacilityQbIds),
          columns: { id: true, qbCustomerId: true },
        })
      : []
    const existingFacilityMap = new Map(existingFacilityRows.map((r) => [r.qbCustomerId!, r.id]))

    const toInsertFacilities = dedupedFacilityRows.filter((f) => !existingFacilityMap.has(f.qbId))
    const toUpdateFacilities = dedupedFacilityRows.filter((f) => existingFacilityMap.has(f.qbId))

    // Batch insert new facilities
    const newFacilityUserRows: Array<{ userId: string; facilityId: string; role: 'admin' }> = []
    const newFranchiseFacilityRows: Array<{ franchiseId: string; facilityId: string }> = []

    for (const facilityChunk of chunk(toInsertFacilities, 50)) {
      const values = facilityChunk.map(({ qbId, name, row }) => {
        const street = (row['Street Address'] ?? row['street_address'] ?? '').trim()
        const city = (row['City'] ?? row['city'] ?? '').trim()
        const state = (row['State'] ?? row['state'] ?? '').trim()
        const zip = (row['Zip'] ?? row['zip'] ?? '').trim()
        const phone = (row['Phone'] ?? row['phone'] ?? '').trim() || null
        const contactEmail = (row['Email'] ?? row['email'] ?? '').trim() || null
        const addressParts = [street, city, state, zip].filter(Boolean)
        const address = addressParts.length > 0 ? addressParts.join(', ') : null
        return { name, address, phone, contactEmail, qbCustomerId: qbId, facilityCode: qbId, active: true }
      })

      const inserted = await db.insert(facilities).values(values).returning({ id: facilities.id })

      inserted.forEach(({ id }) => {
        newFacilityUserRows.push({ userId: profile.id, facilityId: id, role: 'admin' })
        if (franchiseId) newFranchiseFacilityRows.push({ franchiseId, facilityId: id })
      })

      stats.facilities.created += inserted.length
    }

    // Batch insert facilityUsers + franchiseFacilities for new facilities
    if (newFacilityUserRows.length > 0) {
      await db.insert(facilityUsers).values(newFacilityUserRows).onConflictDoNothing()
    }
    if (newFranchiseFacilityRows.length > 0) {
      await db.insert(franchiseFacilities).values(newFranchiseFacilityRows).onConflictDoNothing()
    }

    // Update existing facilities
    for (const { qbId, name, row } of toUpdateFacilities) {
      const facilityId = existingFacilityMap.get(qbId)!
      const street = (row['Street Address'] ?? row['street_address'] ?? '').trim()
      const city = (row['City'] ?? row['city'] ?? '').trim()
      const state = (row['State'] ?? row['state'] ?? '').trim()
      const zip = (row['Zip'] ?? row['zip'] ?? '').trim()
      const phone = (row['Phone'] ?? row['phone'] ?? '').trim() || null
      const contactEmail = (row['Email'] ?? row['email'] ?? '').trim() || null
      const addressParts = [street, city, state, zip].filter(Boolean)
      const address = addressParts.length > 0 ? addressParts.join(', ') : null

      await db
        .update(facilities)
        .set({
          name,
          facilityCode: qbId,
          ...(address ? { address } : {}),
          ...(phone ? { phone } : {}),
          ...(contactEmail ? { contactEmail } : {}),
          updatedAt: new Date(),
        })
        .where(eq(facilities.id, facilityId))

      stats.facilities.updated++
    }

    // Re-query all facilities to build complete qbId → facilityId map (includes newly inserted rows)
    const allFacilityRows = allFacilityQbIds.length > 0
      ? await db.query.facilities.findMany({
          where: inArray(facilities.qbCustomerId, allFacilityQbIds),
          columns: { id: true, qbCustomerId: true },
        })
      : []
    const facilityIdMap = new Map(allFacilityRows.map((r) => [r.qbCustomerId!, r.id]))

    // ── Residents ───────────────────────────────────────────────────────────

    // Filter out residents whose facility wasn't found
    const validResidentRows: typeof residentRows = []
    for (const r of residentRows) {
      if (!facilityIdMap.has(r.facilityQbId)) {
        warnings.push(`Skipped resident ${r.qbCustomerId} — no matching facility ${r.facilityQbId}`)
        stats.residents.skipped++
      } else {
        validResidentRows.push(r)
      }
    }

    // Bulk fetch existing residents by qbCustomerId
    const allResidentQbIds = validResidentRows.map((r) => r.qbCustomerId)
    const existingResidentRows = allResidentQbIds.length > 0
      ? await db.query.residents.findMany({
          where: inArray(residents.qbCustomerId, allResidentQbIds),
          columns: { id: true, qbCustomerId: true },
        })
      : []
    const existingResidentMap = new Map(existingResidentRows.map((r) => [r.qbCustomerId!, r.id]))

    // Parse resident data
    type ParsedResident = {
      facilityId: string
      name: string
      room: string | null
      poaName: string | null
      poaAddress: string | null
      poaCity: string | null
      poaEmail: string | null
      poaPhone: string | null
      qbCustomerId: string
    }

    const toInsertResidents: ParsedResident[] = []
    const toUpdateResidents: Array<{ id: string } & ParsedResident> = []

    for (const { facilityQbId, qbCustomerId, rest, row } of validResidentRows) {
      const facilityId = facilityIdMap.get(facilityQbId)!
      const { name, room } = parseResidentName(rest)
      if (!name) {
        warnings.push(`Skipped resident ${qbCustomerId} — could not parse name`)
        stats.residents.skipped++
        continue
      }

      const rawAddress = (row['Street Address'] ?? '').trim()
      let poaName: string | null = null
      let poaAddress: string | null = null

      if (rawAddress) {
        const lines = rawAddress.split('\n').map((l: string) => l.trim()).filter(Boolean)
        const firstLine = lines[0] ?? ''
        const secondLine = lines[1] ?? ''
        if (/^c\/o\s+/i.test(firstLine)) {
          poaName = firstLine.replace(/^c\/o\s+/i, '').trim() || null
          poaAddress = secondLine || null
        } else {
          poaAddress = lines.join(', ') || null
        }
      }

      const poaCity = (row['City'] ?? '').trim() || null
      const poaEmail = (row['Email'] ?? '').trim() || null
      const poaPhone = (row['Phone'] ?? '').trim() || null

      const parsed = { facilityId, name, room, poaName, poaAddress, poaCity, poaEmail, poaPhone, qbCustomerId }

      const existingId = existingResidentMap.get(qbCustomerId)
      if (existingId) {
        toUpdateResidents.push({ id: existingId, ...parsed })
      } else {
        toInsertResidents.push(parsed)
      }
    }

    // Deduplicate toInsertResidents by qbCustomerId — QB export can repeat the same customer ID
    const residentDedupeMap = new Map<string, ParsedResident>()
    for (const r of toInsertResidents) residentDedupeMap.set(r.qbCustomerId, r)
    const dedupedInsertResidents = Array.from(residentDedupeMap.values())

    // Batch insert new residents (chunks of 50 to stay within Postgres bind-param limits)
    for (const residentChunk of chunk(dedupedInsertResidents, 50)) {
      // Within-chunk dedup by (name, facilityId) — prevents "affect row a second time" when two
      // QB residents share a name at the same facility (different qbCustomerIds, same name+facility)
      const chunkDedupeMap = new Map<string, ParsedResident>()
      for (const r of residentChunk) chunkDedupeMap.set(`${r.name}__${r.facilityId}`, r)
      const safeChunk = Array.from(chunkDedupeMap.values())

      const values = safeChunk.map((r) => ({
        facilityId: r.facilityId,
        name: r.name,
        roomNumber: r.room,
        poaName: r.poaName,
        poaAddress: r.poaAddress,
        poaCity: r.poaCity,
        poaEmail: r.poaEmail,
        poaPhone: r.poaPhone,
        qbCustomerId: r.qbCustomerId,
        portalToken: randomUUID(),
        active: true,
      }))

      // Conflict target is qbCustomerId (the true unique key from QB) — not (name, facilityId)
      // which would silently merge two different residents who share a name at the same facility
      await db
        .insert(residents)
        .values(values)
        .onConflictDoUpdate({
          target: residents.qbCustomerId,
          targetWhere: sql`${residents.qbCustomerId} IS NOT NULL`,
          set: {
            name: sql`excluded.name`,
            roomNumber: sql`excluded.room_number`,
            poaName: sql`COALESCE(excluded.poa_name, ${residents.poaName})`,
            poaAddress: sql`COALESCE(excluded.poa_address, ${residents.poaAddress})`,
            poaCity: sql`COALESCE(excluded.poa_city, ${residents.poaCity})`,
            poaEmail: sql`COALESCE(excluded.poa_email, ${residents.poaEmail})`,
            poaPhone: sql`COALESCE(excluded.poa_phone, ${residents.poaPhone})`,
            updatedAt: new Date(),
          },
        })

      stats.residents.created += safeChunk.length
    }

    // Update existing residents in parallel chunks
    for (const updateChunk of chunk(toUpdateResidents, 50)) {
      await Promise.all(
        updateChunk.map(({ id, name, room, poaName, poaAddress, poaCity, poaEmail, poaPhone }) =>
          db
            .update(residents)
            .set({
              name,
              ...(room ? { roomNumber: room } : {}),
              ...(poaName ? { poaName } : {}),
              ...(poaAddress ? { poaAddress } : {}),
              ...(poaCity ? { poaCity } : {}),
              ...(poaEmail ? { poaEmail } : {}),
              ...(poaPhone ? { poaPhone } : {}),
              updatedAt: new Date(),
            })
            .where(eq(residents.id, id))
        )
      )
      stats.residents.updated += updateChunk.length
    }

    return Response.json({ data: { ...stats, warnings } })
  } catch (err) {
    console.error('QB import error:', err)
    return Response.json({ error: (err as Error).message ?? 'Import failed' }, { status: 500 })
  }
}
