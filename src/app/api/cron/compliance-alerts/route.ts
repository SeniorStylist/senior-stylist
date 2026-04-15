import { db } from '@/db'
import {
  stylists,
  facilities,
  facilityUsers,
  profiles,
  complianceDocuments,
  stylistFacilityAssignments,
} from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { sendEmail, buildComplianceAlertEmailHtml } from '@/lib/email'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const DOC_TYPE_LABEL: Record<string, string> = {
  license: 'License',
  insurance: 'Insurance',
  w9: 'W-9',
  contractor_agreement: 'Contractor Agreement',
  background_check: 'Background Check',
}

function todayUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

function parseDateOnly(s: string): Date | null {
  if (!s) return null
  const d = new Date(s + 'T00:00:00Z')
  return Number.isNaN(d.getTime()) ? null : d
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const today = todayUTC()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://senior-stylist.vercel.app'

    const activeStylists = await db.query.stylists.findMany({
      where: eq(stylists.active, true),
    })
    if (activeStylists.length === 0) {
      return Response.json({ data: { alertsSent: 0 } })
    }

    const stylistIds = activeStylists.map((s) => s.id)

    // Load active facility assignments for this stylist set → stylistId -> facilityId[]
    const assignmentRows = await db
      .select({
        stylistId: stylistFacilityAssignments.stylistId,
        facilityId: stylistFacilityAssignments.facilityId,
      })
      .from(stylistFacilityAssignments)
      .where(
        and(
          inArray(stylistFacilityAssignments.stylistId, stylistIds),
          eq(stylistFacilityAssignments.active, true),
        ),
      )
    const facilitiesByStylist = new Map<string, string[]>()
    for (const row of assignmentRows) {
      if (!facilitiesByStylist.has(row.stylistId)) facilitiesByStylist.set(row.stylistId, [])
      facilitiesByStylist.get(row.stylistId)!.push(row.facilityId)
    }

    const facilityIdSet = new Set<string>()
    for (const ids of facilitiesByStylist.values()) for (const id of ids) facilityIdSet.add(id)
    // Legacy fallback: include stylists.facility_id for rows not yet assigned anywhere.
    for (const s of activeStylists) {
      if (!facilitiesByStylist.has(s.id) && s.facilityId) {
        facilitiesByStylist.set(s.id, [s.facilityId])
        facilityIdSet.add(s.facilityId)
      }
    }
    const facilityIds = Array.from(facilityIdSet)
    if (facilityIds.length === 0) {
      return Response.json({ data: { alertsSent: 0 } })
    }

    const [allDocs, allFacilityAdmins, facilityRows] = await Promise.all([
      db.query.complianceDocuments.findMany({
        where: and(
          inArray(complianceDocuments.stylistId, stylistIds),
          eq(complianceDocuments.verified, true)
        ),
      }),
      db
        .select({
          facilityId: facilityUsers.facilityId,
          email: profiles.email,
        })
        .from(facilityUsers)
        .innerJoin(profiles, eq(profiles.id, facilityUsers.userId))
        .where(and(inArray(facilityUsers.facilityId, facilityIds), eq(facilityUsers.role, 'admin'))),
      db.query.facilities.findMany({
        where: inArray(facilities.id, facilityIds),
      }),
    ])

    const facilityById = new Map(facilityRows.map((f) => [f.id, f]))

    const adminsByFacility = new Map<string, string[]>()
    for (const row of allFacilityAdmins) {
      if (!row.email) continue
      if (!adminsByFacility.has(row.facilityId)) adminsByFacility.set(row.facilityId, [])
      adminsByFacility.get(row.facilityId)!.push(row.email)
    }

    const docsByStylist = new Map<string, typeof allDocs>()
    for (const d of allDocs) {
      if (!docsByStylist.has(d.stylistId)) docsByStylist.set(d.stylistId, [])
      docsByStylist.get(d.stylistId)!.push(d)
    }

    let alertsSent = 0

    type Alert = {
      stylistName: string
      documentTypeLabel: string
      daysRemaining: number
      expiresAt: string
      facility: typeof facilities.$inferSelect
      stylistId: string
    }
    const alerts: Alert[] = []

    for (const stylist of activeStylists) {
      const assignedFacilityIds = facilitiesByStylist.get(stylist.id) ?? []
      if (assignedFacilityIds.length === 0) continue

      const seen = new Set<string>()

      const pushIfDue = (typeKey: string, expiresAtStr: string | null) => {
        if (!expiresAtStr) return
        const d = parseDateOnly(expiresAtStr)
        if (!d) return
        const days = daysBetween(today, d)
        if (days !== 30 && days !== 60) return
        const dedupeKey = `${typeKey}:${expiresAtStr}`
        if (seen.has(dedupeKey)) return
        seen.add(dedupeKey)

        // Fan out one alert per assigned facility so each facility's admins are notified.
        for (const fid of assignedFacilityIds) {
          const facility = facilityById.get(fid)
          if (!facility) continue
          alerts.push({
            stylistName: stylist.name,
            documentTypeLabel: DOC_TYPE_LABEL[typeKey] ?? typeKey,
            daysRemaining: days,
            expiresAt: expiresAtStr,
            facility,
            stylistId: stylist.id,
          })
        }
      }

      const docs = docsByStylist.get(stylist.id) ?? []
      for (const d of docs) {
        pushIfDue(d.documentType, d.expiresAt)
      }

      pushIfDue('license', stylist.licenseExpiresAt ?? null)
      pushIfDue('insurance', stylist.insuranceExpiresAt ?? null)
    }

    const fallback = process.env.NEXT_PUBLIC_ADMIN_EMAIL
    for (const a of alerts) {
      const recipients = adminsByFacility.get(a.facility.id) ?? (fallback ? [fallback] : [])
      if (recipients.length === 0) continue

      const html = buildComplianceAlertEmailHtml({
        stylistName: a.stylistName,
        documentTypeLabel: a.documentTypeLabel,
        daysRemaining: a.daysRemaining,
        expiresAt: a.expiresAt,
        facilityName: a.facility.name,
        stylistUrl: `${appUrl}/stylists/${a.stylistId}`,
      })
      const subject = `Compliance alert: ${a.stylistName}'s ${a.documentTypeLabel} expires in ${a.daysRemaining} days`

      for (const to of recipients) {
        sendEmail({ to, subject, html }).catch((err) =>
          console.error('[cron/compliance-alerts] send failed:', err)
        )
        alertsSent++
      }
    }

    return Response.json({ data: { alertsSent } })
  } catch (err) {
    console.error('[cron/compliance-alerts] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
