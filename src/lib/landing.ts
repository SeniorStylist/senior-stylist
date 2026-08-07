// P51 — role-appropriate landing page, applied at LOGIN-ENTRY points only
// (src/app/page.tsx, the auth callback default, the login fallback). It is
// deliberately NOT a blanket /dashboard redirect: a facility admin lands on
// their reports but can still open the calendar any time. The one standing
// exception stays in dashboard/page.tsx — bookkeepers get bounced to /log
// because they have no calendar at all.

export function landingPathFor(o: { role: string; rawRole?: string; isMaster: boolean }): string {
  if (o.isMaster) return '/master-admin'
  if (o.rawRole === 'super_admin') return '/franchise'
  if (o.role === 'bookkeeper') return '/log'
  if (o.role === 'admin') return '/analytics'
  return '/dashboard' // facility_staff, stylist, viewer
}
