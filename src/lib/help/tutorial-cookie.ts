// Phase 13-Tutorial — tutorial-mode cookie.
//
// While a scripted tour is active we set a short-lived `ss_tutorial_mode=1`
// cookie. Because cookies ride along on every same-origin request automatically,
// BOTH server components (SSR page queries that feed props like the booking
// modal's resident/service lists) and API route handlers can read it — no
// window.fetch patching required. The server uses it to (a) persist new records
// with is_demo=true and (b) relax `eq(table.isDemo,false)` read filters so the
// tour's demo records are visible mid-tour.
//
// Safety: a short max-age (TTL) means that even if a tour crashes without
// cleanup, demo records only surface in the user's OWN lists for a few minutes
// before the cookie expires on its own. It's cleared explicitly on tour end.

export const TUTORIAL_COOKIE = 'ss_tutorial_mode'
const TTL_SECONDS = 15 * 60 // 15 min safety expiry

export function setTutorialCookie() {
  if (typeof document === 'undefined') return
  document.cookie = `${TUTORIAL_COOKIE}=1; path=/; max-age=${TTL_SECONDS}; samesite=lax`
}

export function clearTutorialCookie() {
  if (typeof document === 'undefined') return
  document.cookie = `${TUTORIAL_COOKIE}=; path=/; max-age=0; samesite=lax`
}
