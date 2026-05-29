// Phase 13-Tutorial — server-side readers for the tutorial-mode cookie.
//
// The scripted-tour engine sets a short-lived `ss_tutorial_mode=1` cookie while
// a tour is active (see tutorial-cookie.ts). Routes / server components read it
// to (a) persist new records with is_demo=true and (b) relax their
// `eq(table.isDemo,false)` read filters so tour-created records are visible
// mid-tour. The flag only ever affects the CALLER'S OWN facility data (every
// route still runs its normal auth + facility scoping), so it grants no new
// privilege — worst case a user flags their own rows demo, which are hidden from
// their own lists and auto-cleaned by the weekly cron.
import { cookies } from 'next/headers'
import { TUTORIAL_COOKIE } from './tutorial-cookie'

// For API route handlers — reads the cookie off the incoming request.
export function isTutorialRequest(request: Request): boolean {
  const cookie = request.headers.get('cookie')
  if (!cookie) return false
  return new RegExp(`(?:^|;\\s*)${TUTORIAL_COOKIE}=1(?:;|$)`).test(cookie)
}

// For server components / pages (no request object in scope).
export async function isTutorialModeActive(): Promise<boolean> {
  const c = await cookies()
  return c.get(TUTORIAL_COOKIE)?.value === '1'
}
