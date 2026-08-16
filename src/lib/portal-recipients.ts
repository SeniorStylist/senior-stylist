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
import { normalizePhoneDigits } from '@/lib/phone'

export interface FamilyRecipients {
  /** Deduped, lowercase: residents.poaEmail ∪ linked portal accounts' emails. */
  emails: string[]
  /**
   * P55 — deduped on digits: residents.poaPhone ∪ linked portal accounts'
   * phones (the mirror of the emails union — a phone-only signup's number
   * lives on the account, not always on the resident).
   */
  phones: string[]
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
      .select({ email: portalAccounts.email, phone: portalAccounts.phone })
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

  // P55 — phones union, deduped on digits (raw strings preserved for sendSms).
  const phones: string[] = []
  const phoneKeys = new Set<string>()
  for (const raw of [resident.poaPhone, ...links.map((l) => l.phone)]) {
    const digits = normalizePhoneDigits(raw)
    if (digits.length < 7 || phoneKeys.has(digits)) continue
    phoneKeys.add(digits)
    phones.push(raw as string)
  }

  return {
    emails: [...emails],
    phones,
    emailReminders: prefs?.emailReminders !== false,
    smsReminders: prefs?.smsReminders !== false,
    poaNotificationsEnabled: resident.poaNotificationsEnabled !== false,
    poaPhone: resident.poaPhone ?? null,
    residentName: resident.name,
  }
}
