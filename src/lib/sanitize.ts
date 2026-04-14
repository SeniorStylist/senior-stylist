import type { Facility, Stylist } from '@/types'
import type { stylists as stylistsTable, facilities as facilitiesTable } from '@/db/schema'

type StylistRow = typeof stylistsTable.$inferSelect
type FacilityRow = typeof facilitiesTable.$inferSelect

export function sanitizeStylist(stylist: StylistRow): Stylist {
  const { googleRefreshToken: _drop, ...rest } = stylist
  return rest as Stylist
}

export function sanitizeStylists(stylists: StylistRow[]): Stylist[] {
  return stylists.map(sanitizeStylist)
}

export type PublicFacility = Omit<Facility, 'stripeSecretKey'> & { hasStripeSecret: boolean }

export function sanitizeFacility(facility: FacilityRow): PublicFacility {
  const { stripeSecretKey, ...rest } = facility
  return { ...(rest as Omit<Facility, 'stripeSecretKey'>), hasStripeSecret: !!stripeSecretKey }
}

const SENSITIVE_KEYS = new Set([
  'googleRefreshToken',
  'stripeSecretKey',
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
