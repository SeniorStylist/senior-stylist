// P50 — who gets family-facing emails for a resident.
//
// THE fix for a recurring bug class: the person who signed up via the QR
// wizard (and who files portal requests) is often NOT the poaEmail on the
// resident record — claim-approved accounts routinely have a different
// address. Any sender that only reads residents.poaEmail silently misses
// exactly the QR-onboarded cohort. This resolver unions BOTH sources.

import { db } from '@/db'
import { portalAccountResidents, portalAccounts, residentPreferences, residents } from '@/db/schema'
import { eq } from 'drizzle-orm'

export interface FamilyRecipients {
  /** Deduped, lowercase: residents.poaEmail ∪ linked portal accounts' emails. */
  emails: string[]
  /** resident_preferences.email_reminders — null row = true (opt-out model). */
  emailReminders: boolean
  /** resident_preferences.sms_reminders — null row = true. */
  smsReminders: boolean
  /** residents.poa_notifications_enabled (staff-side master switch). */
  poaNotificationsEnabled: boolean
  poaPhone: string | null
  residentName: string
}

/**
 * ONE query (three cheap lookups batched) — never call in a per-resident loop
 * from a cron; batch there instead (max:1 pool rule).
 */
export async function getFamilyRecipients(residentId: string): Promise<FamilyRecipients | null> {
  const [resident, links, prefs] = await Promise.all([
    db.query.residents.findFirst({
      where: eq(residents.id, residentId),
      columns: { name: true, poaEmail: true, poaPhone: true, poaNotificationsEnabled: true },
    }),
    db
      .select({ email: portalAccounts.email })
      .from(portalAccountResidents)
      .innerJoin(portalAccounts, eq(portalAccounts.id, portalAccountResidents.portalAccountId))
      .where(eq(portalAccountResidents.residentId, residentId)),
    db.query.residentPreferences.findFirst({
      where: eq(residentPreferences.residentId, residentId),
      columns: { emailReminders: true, smsReminders: true },
    }).catch(() => null),
  ])
  if (!resident) return null

  const emails = new Set<string>()
  if (resident.poaEmail) emails.add(resident.poaEmail.toLowerCase())
  for (const l of links) if (l.email) emails.add(l.email.toLowerCase())

  return {
    emails: [...emails],
    emailReminders: prefs?.emailReminders !== false,
    smsReminders: prefs?.smsReminders !== false,
    poaNotificationsEnabled: resident.poaNotificationsEnabled !== false,
    poaPhone: resident.poaPhone ?? null,
    residentName: resident.name,
  }
}
