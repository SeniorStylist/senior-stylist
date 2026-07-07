import { FamilyEntryClient } from './family-entry-client'

// Phase 15 F5 — public /family root: facility-code entry for family members who
// don't have a direct link (and the entry point for the native app's family mode).
// /family is already on the middleware public allowlists (startsWith('/family')).

export const dynamic = 'force-dynamic'

export default function FamilyEntryPage() {
  return <FamilyEntryClient />
}
