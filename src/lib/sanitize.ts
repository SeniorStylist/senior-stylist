import type { Facility, Stylist } from '@/types'
import type { stylists as stylistsTable, facilities as facilitiesTable } from '@/db/schema'
import { safeTimeZone } from '@/lib/time'

type StylistRow = typeof stylistsTable.$inferSelect
type FacilityRow = typeof facilitiesTable.$inferSelect

export function sanitizeStylist(stylist: StylistRow): Stylist {
  const { googleRefreshToken: _drop, ...rest } = stylist
  return rest as Stylist
}

export function sanitizeStylists(stylists: StylistRow[]): Stylist[] {
  return stylists.map(sanitizeStylist)
}

// P51 lockdown — operational roster shape for NON-manage-tier browsers
// (facility admin, front desk, stylist). No commission, no email/phones/
// address/license/payment fields — those never leave the server for
// facility-side roles.
export interface RosterStylist {
  id: string
  name: string
  color: string
  status: string
  stylistCode: string
  facilityId: string | null
  isDemo: boolean
}

export function toRosterStylist(s: StylistRow): RosterStylist {
  return {
    id: s.id,
    name: s.name,
    color: s.color,
    status: s.status,
    stylistCode: s.stylistCode,
    facilityId: s.facilityId ?? null,
    isDemo: s.isDemo,
  }
}

export type PublicFacility = Omit<Facility, 'stripeSecretKey' | 'qbAccessToken' | 'qbRefreshToken'> & {
  hasStripeSecret: boolean
  hasQuickBooks: boolean
}

/**
 * `hasQuickBooks` now reflects the realm-level connection (qb_connections),
 * not the legacy per-facility token columns. Server components resolve it
 * with `isFacilityConnected()` and pass it through `overrides`; without an
 * override it falls back to the legacy columns (only meaningful before the
 * 0046 backfill ran).
 */
export function sanitizeFacility(
  facility: FacilityRow,
  overrides: { hasQuickBooks?: boolean } = {},
): PublicFacility {
  const { stripeSecretKey, qbAccessToken, qbRefreshToken, ...rest } = facility
  return {
    ...(rest as Omit<Facility, 'stripeSecretKey' | 'qbAccessToken' | 'qbRefreshToken'>),
    // P63 — normalize the timezone at the ONE boundary every facility row
    // crosses on its way to a client. Client components read `facility.timezone`
    // raw (25 sites in dashboard-client alone) and hand it straight to
    // Intl.DateTimeFormat, which THROWS on null or a non-IANA name — and the
    // bulk importers create facilities with no timezone at all. That crash
    // happened during a useState initializer, above any error boundary the
    // component owns, so it took the whole page down with "Something went
    // wrong". Fix it here and every downstream reader is safe.
    timezone: safeTimeZone(rest.timezone),
    hasStripeSecret: !!stripeSecretKey,
    hasQuickBooks: overrides.hasQuickBooks ?? !!(qbAccessToken && qbRefreshToken),
  }
}

const SENSITIVE_KEYS = new Set([
  'googleRefreshToken',
  'stripeSecretKey',
  'qbAccessToken',
  'qbRefreshToken',
])

// Recursively strips server-only secrets from any value before it crosses the
// server→client boundary. Use INSTEAD OF `JSON.parse(JSON.stringify(x))` on any
// server-rendered page prop or API response that includes stylists/facilities
// (directly or via relations like `with: { stylist: true }`).
// Returns `any` intentionally — the JSON round-trip converts Date→string, which
// the caller-side types already model as `string`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toClientJson(value: unknown): any {
  return JSON.parse(
    JSON.stringify(value, (key, val) => (SENSITIVE_KEYS.has(key) ? undefined : val)),
  )
}
