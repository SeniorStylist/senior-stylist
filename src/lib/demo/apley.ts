// APLEY — the self-contained world the owner-facing end-to-end demo runs in.
//
// Why a facility of its own rather than seeding an existing one: the demo has
// to create a family account, a resident and a saved card, and it has to charge
// that card. None of that can be allowed to touch a real community's data, and
// all of it has to be removable in one click so the demo can be re-run in front
// of someone without leftovers. `setup-demo-franchise/route.ts` established this
// pattern (demo facility + fixed code + teardown); Apley follows it.
//
// Deliberately NOT seeded: the resident and the family account. Creating those
// is what the walk demonstrates — seeding them would be demoing the outcome
// instead of the flow.

import { db } from '@/db'
import {
  bookings,
  facilities,
  facilityUsers,
  logEntries,
  paymentMethods,
  portalAccountResidents,
  portalAccounts,
  portalClaimRequests,
  portalMagicLinks,
  qbInvoices,
  qbPayments,
  residents,
  services,
  signupSheetEntries,
  stylistAvailability,
  stylistCheckins,
  stylistFacilityAssignments,
  stylists,
} from '@/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'

/**
 * Non-numeric ON PURPOSE. `nextFacilityCode` scans `^F[0-9]+` to pick the next
 * real F-number, so a numeric demo code (F9001) would push every future real
 * facility's number up. `FDEMO1` in the demo-franchise route is non-numeric for
 * the same reason.
 */
export const APLEY_CODE = 'FAPLEY'
export const APLEY_NAME = 'Apley Court (Demo)'
export const APLEY_STYLIST_NAME = 'Alex Rivera (Demo)'
export const APLEY_STYLIST_CODE = 'STAPLEY'
export const APLEY_TIMEZONE = 'America/New_York'

/**
 * SEVEN days, unlike a real community's Mon–Fri.
 *
 * Not laziness: the walk asks the family to request a visit for TODAY so the
 * stylist can complete it in the same sitting, and the Day Log opens on today.
 * With Mon–Fri the whole demo would fail to complete on a Saturday — the family
 * could not select today, the appointment would land on a future date, and the
 * Done/Finalize steps would find an empty log. A demo that only works five days
 * a week is a demo that fails in front of someone.
 */
const WORKING_DOWS = [0, 1, 2, 3, 4, 5, 6]
const OPEN = '09:00'
const CLOSE = '17:00'

const PRICE_LIST: { name: string; priceCents: number; durationMinutes: number; category: string }[] = [
  { name: 'Wash & Set', priceCents: 4500, durationMinutes: 45, category: 'Shampoo, Sets & Cuts' },
  { name: 'Haircut', priceCents: 3000, durationMinutes: 30, category: 'Shampoo, Sets & Cuts' },
  { name: 'Shampoo & Style', priceCents: 3500, durationMinutes: 30, category: 'Shampoo, Sets & Cuts' },
]

export interface ApleyWorld {
  facilityId: string
  facilityCode: string
  facilityName: string
  stylistId: string
  stylistName: string
  serviceIds: string[]
  /** Already had a resident or family account from a previous run. */
  hadPriorRun: boolean
}

/** Find the Apley facility, demo-scoped. Never matches a real facility. */
async function findApleyFacility() {
  return db.query.facilities.findFirst({
    where: and(eq(facilities.facilityCode, APLEY_CODE), eq(facilities.isDemo, true)),
    columns: { id: true, name: true, facilityCode: true },
  })
}

/**
 * Build (or repair) the Apley world. Idempotent — running it twice is a no-op
 * beyond re-activating anything that was deactivated.
 *
 * `masterUserId` gets a facility_users row so the master can enter the facility
 * from the switcher and impersonate the stylist inside it.
 */
export async function buildApleyWorld(masterUserId: string): Promise<ApleyWorld> {
  // ── Facility ────────────────────────────────────────────────────────────
  let facility = await findApleyFacility()
  if (!facility) {
    const [created] = await db
      .insert(facilities)
      .values({
        name: APLEY_NAME,
        facilityCode: APLEY_CODE,
        timezone: APLEY_TIMEZONE,
        isDemo: true,
        active: true,
        // The family half of the walk starts at the QR signup page.
        portalSelfSignupEnabled: true,
        // Residents pay for their own visits — the model the demo is showing.
        paymentType: 'ip',
        // THE setting that makes Finalize charge the saved card. Without it the
        // walk's money step would do nothing and the demo would prove nothing.
        autopayMode: 'on_completion',
        autopaySweepCadence: 'off',
        workingHours: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], startTime: OPEN, endTime: CLOSE },
      })
      .returning({ id: facilities.id, name: facilities.name, facilityCode: facilities.facilityCode })
    facility = created
  } else {
    // Re-running after a teardown that only deactivated: put it back.
    await db
      .update(facilities)
      .set({
        active: true,
        portalSelfSignupEnabled: true,
        autopayMode: 'on_completion',
        autopaySweepCadence: 'off',
        updatedAt: new Date(),
      })
      .where(eq(facilities.id, facility.id))
  }
  const facilityId = facility.id

  // ── The master's membership, so the switcher can reach it ────────────────
  await db
    .insert(facilityUsers)
    .values({ userId: masterUserId, facilityId, role: 'admin' })
    .onConflictDoNothing()

  // ── Stylist ──────────────────────────────────────────────────────────────
  let stylist = await db.query.stylists.findFirst({
    where: and(eq(stylists.stylistCode, APLEY_STYLIST_CODE), eq(stylists.isDemo, true)),
    columns: { id: true, name: true },
  })
  if (!stylist) {
    const [created] = await db
      .insert(stylists)
      .values({
        name: APLEY_STYLIST_NAME,
        stylistCode: APLEY_STYLIST_CODE,
        facilityId,
        color: '#8B2E4A',
        commissionPercent: 50,
        active: true,
        status: 'active',
        isDemo: true,
      })
      .returning({ id: stylists.id, name: stylists.name })
    stylist = created
  } else {
    await db
      .update(stylists)
      .set({ facilityId, active: true, status: 'active', updatedAt: new Date() })
      .where(eq(stylists.id, stylist.id))
  }

  // The assignment row is what every roster surface actually reads (P33/P60).
  await db
    .insert(stylistFacilityAssignments)
    .values({ stylistId: stylist.id, facilityId, active: true })
    .onConflictDoUpdate({
      target: [stylistFacilityAssignments.stylistId, stylistFacilityAssignments.facilityId],
      set: { active: true, updatedAt: new Date() },
    })

  // Availability drives BOTH the family's selectable days and the request
  // auto-assignment. Without it the request lands unassigned and the family's
  // date picker has nothing to offer.
  await db
    .insert(stylistAvailability)
    .values(
      WORKING_DOWS.map((dayOfWeek) => ({
        stylistId: stylist!.id,
        facilityId,
        dayOfWeek,
        startTime: OPEN,
        endTime: CLOSE,
        active: true,
      })),
    )
    .onConflictDoNothing()

  // ── Price list ───────────────────────────────────────────────────────────
  const existingServices = await db.query.services.findMany({
    where: and(eq(services.facilityId, facilityId), eq(services.isDemo, true)),
    columns: { id: true, name: true },
  })
  const byName = new Map(existingServices.map((s) => [s.name, s.id]))
  const serviceIds: string[] = []
  for (const svc of PRICE_LIST) {
    const existing = byName.get(svc.name)
    if (existing) {
      serviceIds.push(existing)
      continue
    }
    const [created] = await db
      .insert(services)
      .values({
        facilityId,
        name: svc.name,
        priceCents: svc.priceCents,
        durationMinutes: svc.durationMinutes,
        category: svc.category,
        pricingType: 'fixed',
        // `price_list`, not `ocr_import` — families only ever see price_list
        // services on the request page, and the walk has to reach them.
        source: 'price_list',
        active: true,
        isDemo: true,
      })
      .returning({ id: services.id })
    if (created) serviceIds.push(created.id)
  }

  // Did a previous run leave a family behind?
  const priorResident = await db.query.residents.findFirst({
    where: and(eq(residents.facilityId, facilityId), eq(residents.isDemo, true)),
    columns: { id: true },
  })

  return {
    facilityId,
    facilityCode: facility.facilityCode ?? APLEY_CODE,
    facilityName: facility.name,
    stylistId: stylist.id,
    stylistName: stylist.name,
    serviceIds,
    hadPriorRun: !!priorResident,
  }
}

export interface ApleyTeardown {
  found: boolean
  deleted: Record<string, number>
}

/**
 * Remove the Apley world completely so the demo can be run again from scratch.
 *
 * Order is FK-driven, the same lesson `DELETE /api/help/demo-data` records:
 * children before parents, or the deletes violate constraints. This goes
 * further than that route, which predates the family portal — it never removed
 * `portal_accounts`, `portal_account_residents`, `payment_methods`,
 * `portal_magic_links` or `portal_claim_requests`, all of which the Apley walk
 * creates. Leaving a portal account behind would make the next run's signup
 * collide with itself.
 *
 * Everything is scoped to the Apley facility and to `is_demo = true`, so this
 * can never reach a real record.
 */
export async function teardownApleyWorld(): Promise<ApleyTeardown> {
  const facility = await findApleyFacility()
  if (!facility) return { found: false, deleted: {} }
  const facilityId = facility.id
  const deleted: Record<string, number> = {}
  const count = (key: string, rows: { length: number }) => {
    deleted[key] = rows.length
  }

  // Residents at this facility — the anchor for the portal-side cleanup.
  const residentRows = await db
    .select({ id: residents.id })
    .from(residents)
    .where(eq(residents.facilityId, facilityId))
  const residentIds = residentRows.map((r) => r.id)

  // 1. Bookings and day-log rows first (they reference residents + stylists).
  count('bookings', await db.delete(bookings).where(eq(bookings.facilityId, facilityId)).returning({ id: bookings.id }))
  count('logEntries', await db.delete(logEntries).where(eq(logEntries.facilityId, facilityId)).returning({ id: logEntries.id }))
  count('checkins', await db.delete(stylistCheckins).where(eq(stylistCheckins.facilityId, facilityId)).returning({ id: stylistCheckins.id }))
  count('requests', await db.delete(signupSheetEntries).where(eq(signupSheetEntries.facilityId, facilityId)).returning({ id: signupSheetEntries.id }))

  // 2. Money rows.
  count('invoices', await db.delete(qbInvoices).where(eq(qbInvoices.facilityId, facilityId)).returning({ id: qbInvoices.id }))
  count('payments', await db.delete(qbPayments).where(eq(qbPayments.facilityId, facilityId)).returning({ id: qbPayments.id }))

  // 3. The portal side — the part the older teardown never covered.
  count('cards', await db.delete(paymentMethods).where(eq(paymentMethods.facilityId, facilityId)).returning({ id: paymentMethods.id }))
  count('portalLinks', await db.delete(portalAccountResidents).where(eq(portalAccountResidents.facilityId, facilityId)).returning({ id: portalAccountResidents.id }))
  if (residentIds.length > 0) {
    count('magicLinks', await db.delete(portalMagicLinks).where(inArray(portalMagicLinks.residentId, residentIds)).returning({ id: portalMagicLinks.id }))
  }
  count('claims', await db.delete(portalClaimRequests).where(eq(portalClaimRequests.facilityId, facilityId)).returning({ id: portalClaimRequests.id }))

  // Portal accounts are GLOBAL, not facility-scoped: one family can be linked
  // to residents at several communities. Deleting by facility would take a real
  // family's account with it, so only accounts left with no resident link at
  // all — which, after the delete above, is exactly the ones Apley created —
  // are removed.
  const orphanAccounts = await db
    .select({ id: portalAccounts.id })
    .from(portalAccounts)
    .leftJoin(portalAccountResidents, eq(portalAccountResidents.portalAccountId, portalAccounts.id))
    .where(isNull(portalAccountResidents.id))
  if (orphanAccounts.length > 0) {
    count(
      'portalAccounts',
      await db
        .delete(portalAccounts)
        .where(inArray(portalAccounts.id, orphanAccounts.map((a) => a.id)))
        .returning({ id: portalAccounts.id }),
    )
  }

  // 4. Residents, then the stylist's facility rows, then the facility.
  count('residents', await db.delete(residents).where(eq(residents.facilityId, facilityId)).returning({ id: residents.id }))
  count('availability', await db.delete(stylistAvailability).where(eq(stylistAvailability.facilityId, facilityId)).returning({ id: stylistAvailability.id }))
  count('assignments', await db.delete(stylistFacilityAssignments).where(eq(stylistFacilityAssignments.facilityId, facilityId)).returning({ id: stylistFacilityAssignments.id }))
  count('services', await db.delete(services).where(eq(services.facilityId, facilityId)).returning({ id: services.id }))
  count('stylists', await db.delete(stylists).where(and(eq(stylists.stylistCode, APLEY_STYLIST_CODE), eq(stylists.isDemo, true))).returning({ id: stylists.id }))
  count('memberships', await db.delete(facilityUsers).where(eq(facilityUsers.facilityId, facilityId)).returning({ id: facilityUsers.userId }))
  count('facility', await db.delete(facilities).where(eq(facilities.id, facilityId)).returning({ id: facilities.id }))

  return { found: true, deleted }
}
