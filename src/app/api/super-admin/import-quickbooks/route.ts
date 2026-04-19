import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, facilityUsers, franchiseFacilities, franchises, profiles } from '@/db/schema'
import { eq } from 'drizzle-orm'
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

const FACILITY_REGEX = /^(F\d+)\s*-\s*(.+)$/
const RESIDENT_REGEX = /^(F\d+):(.+)$/

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

    // Separate into facility rows and resident rows
    const facilityRows: Array<{ qbId: string; name: string; row: Record<string, string> }> = []
    const residentRows: Array<{ facilityQbId: string; qbCustomerId: string; rest: string; row: Record<string, string> }> = []

    for (const row of rows) {
      const nameVal = (row['Name'] ?? row['name'] ?? '').trim()
      if (!nameVal) continue

      const facilityMatch = FACILITY_REGEX.exec(nameVal)
      if (facilityMatch) {
        facilityRows.push({ qbId: facilityMatch[1], name: facilityMatch[2].trim(), row })
        continue
      }

      const residentMatch = RESIDENT_REGEX.exec(nameVal)
      if (residentMatch) {
        residentRows.push({
          facilityQbId: residentMatch[1],
          qbCustomerId: nameVal,
          rest: residentMatch[2],
          row,
        })
      }
    }

    const warnings: string[] = []
    const stats = {
      facilities: { created: 0, updated: 0 },
      residents: { created: 0, updated: 0, skipped: 0 },
    }

    await db.transaction(async (tx) => {
      // Find master admin profile + franchise
      const profile = await tx.query.profiles.findFirst({
        where: eq(profiles.email, user.email!),
        columns: { id: true },
      })
      if (!profile) throw new Error('Master admin profile not found')

      const franchise = await tx.query.franchises.findFirst({
        where: eq(franchises.ownerUserId, profile.id),
        columns: { id: true },
      })
      const franchiseId = franchise?.id ?? null

      // First pass: facilities
      const facilityMap = new Map<string, string>() // qbCustomerId → facilityId

      for (const { qbId, name, row } of facilityRows) {
        const street = (row['Street Address'] ?? row['street_address'] ?? '').trim()
        const city = (row['City'] ?? row['city'] ?? '').trim()
        const state = (row['State'] ?? row['state'] ?? '').trim()
        const zip = (row['Zip'] ?? row['zip'] ?? '').trim()
        const phone = (row['Phone'] ?? row['phone'] ?? '').trim() || null
        const contactEmail = (row['Email'] ?? row['email'] ?? '').trim() || null
        const addressParts = [street, city, state, zip].filter(Boolean)
        const address = addressParts.length > 0 ? addressParts.join(', ') : null

        const existing = await tx.query.facilities.findFirst({
          where: eq(facilities.qbCustomerId, qbId),
          columns: { id: true },
        })

        if (existing) {
          await tx
            .update(facilities)
            .set({
              name,
              facilityCode: qbId,
              ...(address ? { address } : {}),
              ...(phone ? { phone } : {}),
              ...(contactEmail ? { contactEmail } : {}),
              updatedAt: new Date(),
            })
            .where(eq(facilities.id, existing.id))
          facilityMap.set(qbId, existing.id)
          stats.facilities.updated++
        } else {
          const [newFacility] = await tx
            .insert(facilities)
            .values({
              name,
              address,
              phone,
              contactEmail,
              qbCustomerId: qbId,
              facilityCode: qbId,
              active: true,
            })
            .returning({ id: facilities.id })

          // Add master admin as facility admin
          await tx.insert(facilityUsers).values({
            userId: profile.id,
            facilityId: newFacility.id,
            role: 'admin',
          }).onConflictDoNothing()

          // Link to franchise
          if (franchiseId) {
            await tx.insert(franchiseFacilities).values({
              franchiseId,
              facilityId: newFacility.id,
            }).onConflictDoNothing()
          }

          facilityMap.set(qbId, newFacility.id)
          stats.facilities.created++
        }
      }

      // Second pass: residents
      for (const { facilityQbId, qbCustomerId, rest, row } of residentRows) {
        const facilityId = facilityMap.get(facilityQbId)
        if (!facilityId) {
          warnings.push(`Skipped resident ${qbCustomerId} — no matching facility ${facilityQbId}`)
          stats.residents.skipped++
          continue
        }

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

        const existing = await tx.query.residents.findFirst({
          where: eq(residents.qbCustomerId, qbCustomerId),
          columns: { id: true },
        })

        if (existing) {
          await tx
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
            .where(eq(residents.id, existing.id))
          stats.residents.updated++
        } else {
          // Use onConflictDoUpdate so existing manual-entry residents get linked
          await tx
            .insert(residents)
            .values({
              facilityId,
              name,
              roomNumber: room,
              poaName,
              poaAddress,
              poaCity,
              poaEmail,
              poaPhone,
              qbCustomerId,
              portalToken: randomUUID(),
              active: true,
            })
            .onConflictDoUpdate({
              target: [residents.name, residents.facilityId],
              set: {
                qbCustomerId,
                ...(poaName ? { poaName } : {}),
                ...(poaAddress ? { poaAddress } : {}),
                ...(poaCity ? { poaCity } : {}),
                ...(poaEmail ? { poaEmail } : {}),
                ...(poaPhone ? { poaPhone } : {}),
                ...(room ? { roomNumber: room } : {}),
                updatedAt: new Date(),
              },
            })
          stats.residents.created++
        }
      }
    })

    return Response.json({ data: { ...stats, warnings } })
  } catch (err) {
    console.error('QB import error:', err)
    return Response.json({ error: (err as Error).message ?? 'Import failed' }, { status: 500 })
  }
}
