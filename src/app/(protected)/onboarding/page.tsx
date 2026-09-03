import { redirect } from 'next/navigation'

// P57 — the first-run facility step now lives in the /facilities/new wizard
// (ONE creation flow for every role). Kept as a redirect for old bookmarks
// and the dashboard's "invited user with no facility" branch.
export default function OnboardingPage() {
  redirect('/facilities/new?returnTo=/dashboard')
}
