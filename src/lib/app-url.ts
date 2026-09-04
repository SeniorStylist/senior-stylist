// P60 — THE app URL. Four modules used to compute this independently, with
// three different fallbacks: a dead `senior-stylist.vercel.app` (portal-auth),
// a hardcoded production host (family-confirmation), and `window.location.
// origin` in the poster/signage builders — a poster printed from a preview
// deploy encoded a domain families can't reach.
//
// Client-safe: NEXT_PUBLIC_APP_URL is inlined at build time, so this module
// works in both server routes and 'use client' components. No server imports
// may ever be added here.

const PRODUCTION_FALLBACK = 'https://portal.seniorstylist.com'

/**
 * Absolute origin for links we send to people (magic links, pay links, QR
 * posters, admin deep links). Never returns a trailing slash.
 *
 * Order: NEXT_PUBLIC_APP_URL → the browser's own origin (client only, so a
 * self-hosted deploy that forgot the env var still links to itself) → the
 * production host.
 */
export function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '')
  }
  return PRODUCTION_FALLBACK
}

/** `${appUrl()}/family/<code>` — the family portal home for a facility. */
export function familyPortalUrl(facilityCode: string): string {
  return `${appUrl()}/family/${encodeURIComponent(facilityCode)}`
}
