// Phase 16 G3 — Spanish family portal. Pure (client-safe) i18n module:
// typed string table + tiny interpolation. Server-side cookie reading lives in
// portal-i18n-server.ts (imports next/headers — keep it out of this file so
// client components can import the dictionary and hook).
//
// Conventions:
// - Language preference is the `ss_portal_lang` cookie ('en' | 'es', 1 year).
//   Portal pages are force-dynamic, so SSR re-renders on toggle via router.refresh().
// - Dates/times use portalLocale(lang) with Intl; money stays en-US USD everywhere
//   (formatDollars untouched — dollar amounts are not localized).
// - Server error messages from API routes are NOT translated — map known portal
//   error surfaces to keys client-side instead.

export type PortalLang = 'en' | 'es'

export const PORTAL_LANG_COOKIE = 'ss_portal_lang'

export function portalLocale(lang: PortalLang): string {
  return lang === 'es' ? 'es-US' : 'en-US'
}

export function normalizePortalLang(value: string | undefined | null): PortalLang {
  return value === 'es' ? 'es' : 'en'
}

/**
 * Every user-facing portal string. Keys are grouped by surface with a prefix
 * (nav., home., appts., billing., request., profile., contact., login., signup.,
 * common.). `{name}`-style placeholders are interpolated by t().
 */
export const PORTAL_STRINGS = {
  // ---- chrome ----
  'nav.home': { en: 'Home', es: 'Inicio' },
  'nav.appointments': { en: 'Appts', es: 'Citas' },
  'nav.request': { en: 'Request', es: 'Solicitar' },
  'nav.billing': { en: 'Billing', es: 'Pagos' },
  'nav.profile': { en: 'Profile', es: 'Perfil' },
  'nav.contact': { en: 'Contact', es: 'Contacto' },
  'header.signOut': { en: 'Sign out', es: 'Salir' },
  'header.switchResident': { en: 'Switch resident', es: 'Cambiar de residente' },

  // ---- common ----
  'common.service': { en: 'Service', es: 'Servicio' },
  'common.scheduled': { en: 'Scheduled', es: 'Programada' },
  'common.pendingApproval': { en: 'Pending approval', es: 'Pendiente de aprobación' },
  'common.completed': { en: 'Completed', es: 'Completada' },
  'common.cancelled': { en: 'Cancelled', es: 'Cancelada' },
  'common.loading': { en: 'Loading…', es: 'Cargando…' },
  'common.saving': { en: 'Saving…', es: 'Guardando…' },
  'common.save': { en: 'Save', es: 'Guardar' },
  'common.cancel': { en: 'Cancel', es: 'Cancelar' },
  'common.close': { en: 'Close', es: 'Cerrar' },
  'common.error': { en: 'Something went wrong. Please try again.', es: 'Algo salió mal. Inténtelo de nuevo.' },

  // ---- home ----
  'home.welcomeBack': { en: 'Welcome back', es: 'Bienvenido de nuevo' },
  'home.hi': { en: 'Hi, {name}', es: 'Hola, {name}' },
  'home.residentAt': { en: "Here's {resident} at {facility}.", es: 'Aquí está {resident} en {facility}.' },
  'home.balanceAttention': { en: 'Balance attention', es: 'Saldo pendiente' },
  'home.outstandingHint': { en: 'Outstanding balance — pay online or by check.', es: 'Saldo pendiente — pague en línea o con cheque.' },
  'home.viewBilling': { en: 'View billing', es: 'Ver pagos' },
  'home.allPaidUp': { en: 'All paid up', es: 'Todo pagado' },
  'home.noBalance': { en: 'No outstanding balance — thank you.', es: 'Sin saldo pendiente — gracias.' },
  'home.upcomingAppointments': { en: 'Upcoming appointments', es: 'Próximas citas' },
  'home.viewAll': { en: 'View all →', es: 'Ver todas →' },
  'home.noUpcoming': { en: 'No upcoming appointments scheduled.', es: 'No hay citas programadas.' },
  'home.requestService': { en: 'Request a service', es: 'Solicitar un servicio' },

  // ---- appointments ----
  'appts.title': { en: 'Appointments', es: 'Citas' },
  'appts.for': { en: 'For {name}', es: 'Para {name}' },
  'appts.upcoming': { en: 'Upcoming', es: 'Próximas' },
  'appts.noUpcoming': { en: 'No upcoming appointments.', es: 'No hay citas próximas.' },
  'appts.past6Months': { en: 'Past 6 months', es: 'Últimos 6 meses' },
  'appts.noPast': { en: 'No completed appointments in the past 6 months.', es: 'No hay citas completadas en los últimos 6 meses.' },
  'appts.stylePhoto': { en: 'Style photo', es: 'Foto del peinado' },
} as const

export type PortalStringKey = keyof typeof PORTAL_STRINGS

export type PortalT = (key: PortalStringKey, vars?: Record<string, string | number>) => string

/** Build a translate function for a language. Pure — usable in server and client. */
export function makePortalT(lang: PortalLang): PortalT {
  return (key, vars) => {
    const entry = PORTAL_STRINGS[key]
    let s: string = entry ? entry[lang] : key
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replaceAll(`{${k}}`, String(v))
      }
    }
    return s
  }
}

/** Client hook — lang arrives as a prop from the server layout/page. */
export function usePortalT(lang: PortalLang): PortalT {
  return makePortalT(lang)
}
