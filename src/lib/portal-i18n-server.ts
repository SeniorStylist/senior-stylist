// Phase 16 G3 — server-side half of the portal i18n. Separated from
// portal-i18n.ts because next/headers cannot be imported from client components.

import { cookies } from 'next/headers'
import {
  makePortalT,
  normalizePortalLang,
  PORTAL_LANG_COOKIE,
  type PortalLang,
  type PortalT,
} from './portal-i18n'

/** Read the visitor's portal language from the ss_portal_lang cookie. */
export async function getPortalLang(): Promise<PortalLang> {
  const store = await cookies()
  return normalizePortalLang(store.get(PORTAL_LANG_COOKIE)?.value)
}

/** Convenience: lang + t() in one call for server pages. */
export async function getPortalT(): Promise<{ lang: PortalLang; t: PortalT }> {
  const lang = await getPortalLang()
  return { lang, t: makePortalT(lang) }
}
