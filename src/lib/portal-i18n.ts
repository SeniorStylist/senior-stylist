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

  // ---- billing ----
  'billing.title': { en: 'Billing', es: 'Pagos' },
  'billing.outstandingBalance': { en: 'Outstanding balance', es: 'Saldo pendiente' },
  'billing.accountBalance': { en: 'Account balance', es: 'Saldo de la cuenta' },
  'billing.autopayOn': {
    en: "🔄 Automatic payment is on — new balances are charged to the card on file and you'll get an email receipt each time. Contact the facility to change this.",
    es: '🔄 El pago automático está activado — los saldos nuevos se cobran a la tarjeta guardada y recibirá un recibo por correo cada vez. Contacte al centro para cambiarlo.',
  },
  'billing.payOnline': { en: 'Pay online', es: 'Pagar en línea' },
  'billing.amount': { en: 'Amount', es: 'Monto' },
  'billing.payWithCard': { en: 'Pay with card', es: 'Pagar con tarjeta' },
  'billing.payBarCta': { en: 'Pay {amount}', es: 'Pagar {amount}' },
  'billing.secureStripe': { en: 'Secure payment via Stripe.', es: 'Pago seguro a través de Stripe.' },
  'billing.addFundsTitle': { en: 'Add funds to account', es: 'Agregar fondos a la cuenta' },
  'billing.addFundsHint': {
    en: 'Prepay credit toward future services. The facility applies it to your invoices.',
    es: 'Crédito prepagado para servicios futuros. El centro lo aplica a sus facturas.',
  },
  'billing.packageCredit': { en: '{amount} credit', es: '{amount} de crédito' },
  'billing.addFundsWithCard': { en: 'Add funds with card', es: 'Agregar fondos con tarjeta' },
  'billing.sendGift': { en: 'Send a gift', es: 'Enviar un regalo' },
  'billing.sendGiftHint': {
    en: 'Gift account credit to another resident at this facility.',
    es: 'Regale crédito de cuenta a otro residente de este centro.',
  },
  'billing.residentName': { en: 'Resident’s name', es: 'Nombre del residente' },
  'billing.roomNumber': { en: 'Room #', es: 'Habitación #' },
  'billing.recommended': { en: '(recommended)', es: '(recomendado)' },
  'billing.yourName': { en: 'Your name', es: 'Su nombre' },
  'billing.fromPlaceholder': { en: 'From…', es: 'De…' },
  'billing.sendGiftWithCard': { en: 'Send gift with card', es: 'Enviar regalo con tarjeta' },
  'billing.giftFootnote': {
    en: 'The credit is added to the resident’s account for the facility to apply.',
    es: 'El crédito se agrega a la cuenta del residente para que el centro lo aplique.',
  },
  'billing.payByCheck': { en: 'Pay by check', es: 'Pagar con cheque' },
  'billing.invoices': { en: 'Invoices', es: 'Facturas' },
  'billing.downloadStatement': { en: 'Download statement', es: 'Descargar estado de cuenta' },
  'billing.noInvoices': { en: 'No invoices yet.', es: 'Aún no hay facturas.' },
  'billing.invoiceLine': { en: 'Invoice #{num} · {amount}', es: 'Factura n.º {num} · {amount}' },
  'billing.paid': { en: 'Paid', es: 'Pagada' },
  'billing.open': { en: 'Open', es: 'Pendiente' },
  'billing.openAmount': { en: '{amount} open', es: '{amount} pendiente' },
  'billing.questions': {
    en: 'Questions about your bill? Contact the facility office',
    es: '¿Preguntas sobre su factura? Comuníquese con la oficina del centro',
  },
  'billing.paymentReceived': { en: 'Payment received — thank you!', es: '¡Pago recibido — gracias!' },
  'billing.giftSent': { en: 'Gift sent — thank you!', es: '¡Regalo enviado — gracias!' },
  'billing.minAmount': { en: 'Enter an amount of at least $0.50.', es: 'Ingrese un monto de al menos $0.50.' },
  'billing.checkoutFailed': { en: 'Could not start checkout.', es: 'No se pudo iniciar el pago.' },
  'billing.enterResidentName': { en: 'Enter the resident’s name.', es: 'Ingrese el nombre del residente.' },

  // ---- saved cards / add card (shared component — lang defaults to 'en' on staff surfaces) ----
  'cards.title': { en: 'Cards on file', es: 'Tarjetas guardadas' },
  'cards.add': { en: 'Add card', es: 'Agregar tarjeta' },
  'cards.none': { en: 'No card on file yet.', es: 'Aún no hay tarjeta guardada.' },
  'cards.default': { en: 'Default', es: 'Predeterminada' },
  'cards.removeAria': { en: 'Remove card', es: 'Eliminar tarjeta' },
  'cards.removed': { en: 'Card removed', es: 'Tarjeta eliminada' },
  'cards.removeFailed': { en: 'Could not remove card', es: 'No se pudo eliminar la tarjeta' },
  'cards.exp': { en: 'exp', es: 'vence' },
  'cards.saved': { en: 'Card saved', es: 'Tarjeta guardada' },
  'cards.saveCard': { en: 'Save card', es: 'Guardar tarjeta' },
  'cards.setupFailed': { en: 'Could not start card setup', es: 'No se pudo iniciar el registro de la tarjeta' },
  'cards.notConfigured': {
    en: 'Card payments are not configured for this facility.',
    es: 'Los pagos con tarjeta no están configurados para este centro.',
  },
  'cards.saveFailed': { en: 'Could not save card', es: 'No se pudo guardar la tarjeta' },
  'cards.setupIncomplete': { en: 'Card setup did not complete', es: 'El registro de la tarjeta no se completó' },
  'cards.authorizedNotSaved': {
    en: 'Card authorized but could not be saved',
    es: 'La tarjeta fue autorizada pero no se pudo guardar',
  },
  'cards.disclaimer': {
    en: 'Your card is stored securely by Stripe. Senior Stylist never sees or stores your full card number. You authorize Senior Stylist to charge this card for services rendered.',
    es: 'Stripe almacena su tarjeta de forma segura. Senior Stylist nunca ve ni guarda su número completo de tarjeta. Usted autoriza a Senior Stylist a hacer cargos en esta tarjeta por los servicios prestados.',
  },

  // ---- request ----
  'request.title': { en: 'Request a service', es: 'Solicitar un servicio' },
  'request.subtitle': {
    en: "For {name} — we'll confirm by email or phone.",
    es: 'Para {name} — confirmaremos por correo o teléfono.',
  },
  'request.submitted': { en: 'Request submitted', es: 'Solicitud enviada' },
  'request.submittedHint': {
    en: "We'll be in touch to confirm your appointment.",
    es: 'Nos comunicaremos para confirmar su cita.',
  },
  'request.backHome': { en: 'Back to home', es: 'Volver al inicio' },
  'request.makeAnother': { en: 'Make another', es: 'Hacer otra solicitud' },
  'request.noServices': { en: 'No services available', es: 'No hay servicios disponibles' },
  'request.contactOffice': { en: 'Please contact the office.', es: 'Comuníquese con la oficina.' },
  'request.pickServices': { en: '1. Pick services', es: '1. Elija servicios' },
  'request.selectedCount': { en: '{count}/6 selected', es: '{count}/6 seleccionados' },
  'request.preferredDate': { en: '2. Preferred date', es: '2. Fecha preferida' },
  'request.anytime': { en: 'Anytime', es: 'Cualquier fecha' },
  'request.dateRange': { en: 'Date range', es: 'Rango de fechas' },
  'request.from': { en: 'From', es: 'Desde' },
  'request.to': { en: 'To', es: 'Hasta' },
  'request.notes': { en: '3. Notes (optional)', es: '3. Notas (opcional)' },
  'request.notesPlaceholder': {
    en: 'Anything we should know? (preferences, mobility, etc.)',
    es: '¿Algo que debamos saber? (preferencias, movilidad, etc.)',
  },
  'request.submit': { en: 'Submit request', es: 'Enviar solicitud' },
  'request.submitting': { en: 'Submitting…', es: 'Enviando…' },
  'request.pickOne': { en: 'Pick at least one service.', es: 'Elija al menos un servicio.' },
  'request.pickDates': {
    en: 'Pick both a start and end date, or choose Anytime.',
    es: 'Elija fecha de inicio y de fin, o seleccione Cualquier fecha.',
  },
  'request.submitFailed': {
    en: 'Could not submit request. Please try again.',
    es: 'No se pudo enviar la solicitud. Inténtelo de nuevo.',
  },

  // ---- profile ----
  'cards.makeDefault': { en: 'Make main card', es: 'Hacer tarjeta principal' },
  'cards.defaultSet': { en: 'Main card updated', es: 'Tarjeta principal actualizada' },
  'prefs.title': { en: 'Care Preferences', es: 'Preferencias de cuidado' },
  'prefs.subtitle': { en: 'How they like their visits — the stylist sees this', es: 'Cómo prefieren sus visitas — la estilista lo verá' },
  'prefs.styleNotes': { en: 'Style notes', es: 'Notas de estilo' },
  'prefs.styleNotesHint': { en: 'e.g. Soft curls, no tight rollers, part on the left', es: 'p. ej. Rizos suaves, sin rulos apretados, raya a la izquierda' },
  'prefs.allergies': { en: 'Allergies & sensitivities', es: 'Alergias y sensibilidades' },
  'prefs.allergiesHint': { en: 'e.g. Sensitive scalp, allergic to fragrance', es: 'p. ej. Cuero cabelludo sensible, alergia a fragancias' },
  'prefs.preferredStylist': { en: 'Preferred stylist', es: 'Estilista preferida' },
  'prefs.noPreference': { en: 'No preference', es: 'Sin preferencia' },
  'prefs.visitRhythm': { en: 'How often would they like visits?', es: '¿Con qué frecuencia desean visitas?' },
  'prefs.weekly': { en: 'Weekly', es: 'Semanal' },
  'prefs.biweekly': { en: 'Every 2 weeks', es: 'Cada 2 semanas' },
  'prefs.monthly': { en: 'Monthly', es: 'Mensual' },
  'prefs.reminders': { en: 'Appointment reminders', es: 'Recordatorios de citas' },
  'prefs.emailReminders': { en: 'Email reminders', es: 'Recordatorios por correo' },
  'prefs.smsReminders': { en: 'Text reminders', es: 'Recordatorios por mensaje de texto' },
  'prefs.save': { en: 'Save preferences', es: 'Guardar preferencias' },
  'prefs.saved': { en: 'Preferences saved', es: 'Preferencias guardadas' },
  'prefs.error': { en: 'Could not save — try again', es: 'No se pudo guardar — intente de nuevo' },
  'profile.title': { en: 'Profile', es: 'Perfil' },
  'profile.subtitle': {
    en: 'Your contact info, tip preferences, and account rewards.',
    es: 'Su información de contacto, preferencias de propina y recompensas.',
  },
  'profile.discounts': { en: 'Your Discounts', es: 'Sus descuentos' },
  'profile.expires': { en: 'Expires {date}', es: 'Vence {date}' },
  'profile.percentOff': { en: '{value}% off', es: '{value}% de descuento' },
  'profile.amountOff': { en: '{amount} off', es: '{amount} de descuento' },
  'profile.contactInfo': { en: 'Contact Information', es: 'Información de contacto' },
  'profile.noResidents': {
    en: 'No residents linked to this account.',
    es: 'No hay residentes vinculados a esta cuenta.',
  },
  'profile.tipPreferences': { en: 'Tip Preferences', es: 'Preferencias de propina' },
  'profile.room': { en: 'Room {n}', es: 'Habitación {n}' },
  'profile.residentPhone': { en: 'Resident phone', es: 'Teléfono del residente' },
  'profile.poaSection': { en: 'Power of Attorney / Contact', es: 'Apoderado / Contacto' },
  'profile.name': { en: 'Name', es: 'Nombre' },
  'profile.fullNamePlaceholder': { en: 'Full name', es: 'Nombre completo' },
  'profile.phone': { en: 'Phone', es: 'Teléfono' },
  'profile.address': { en: 'Address', es: 'Dirección' },
  'profile.streetPlaceholder': { en: 'Street address', es: 'Calle y número' },
  'profile.city': { en: 'City', es: 'Ciudad' },
  'profile.email': { en: 'Email', es: 'Correo electrónico' },
  'profile.emailLocked': {
    en: 'Your email is your login — contact the facility to change it.',
    es: 'Su correo es su acceso — contacte al centro para cambiarlo.',
  },
  'profile.contactSaved': { en: 'Contact info saved', es: 'Información de contacto guardada' },
  'profile.saveFailed': { en: 'Failed to save', es: 'No se pudo guardar' },
  'profile.saved': { en: 'Saved', es: 'Guardado' },

  // ---- contact ----
  'contact.title': { en: 'Contact', es: 'Contacto' },
  'contact.subtitle': {
    en: 'Get in touch with us or your facility.',
    es: 'Comuníquese con nosotros o con su centro.',
  },
  'contact.billingLabel': { en: '(billing)', es: '(pagos)' },
  'contact.noInfo': {
    en: 'Contact info not on file. Please call Senior Stylist.',
    es: 'No hay información de contacto registrada. Llame a Senior Stylist.',
  },

  // ---- login ----
  'login.title': { en: 'Family Portal', es: 'Portal Familiar' },
  'login.subtitle': {
    en: 'Sign in to view appointments, request service, and pay balances.',
    es: 'Inicie sesión para ver citas, solicitar servicios y pagar saldos.',
  },
  'login.errNoAccess': {
    en: "We couldn't find a resident at this facility for your account. Try requesting a fresh link below.",
    es: 'No encontramos un residente en este centro para su cuenta. Solicite un enlace nuevo abajo.',
  },
  'login.errInvalidLink': {
    en: 'This link has expired or already been used. Please request a new one below.',
    es: 'Este enlace venció o ya fue usado. Solicite uno nuevo abajo.',
  },
  'login.tabLink': { en: 'Email me a link', es: 'Enviarme un enlace' },
  'login.tabPassword': { en: 'Sign in with password', es: 'Entrar con contraseña' },
  'login.email': { en: 'Email address', es: 'Correo electrónico' },
  'login.linkHint': {
    en: "We'll send a one-time link to sign in. No password needed.",
    es: 'Le enviaremos un enlace de un solo uso para entrar. Sin contraseña.',
  },
  'login.sendLink': { en: 'Send sign-in link', es: 'Enviar enlace de acceso' },
  'login.sending': { en: 'Sending…', es: 'Enviando…' },
  'login.password': { en: 'Password', es: 'Contraseña' },
  'login.signIn': { en: 'Sign in', es: 'Iniciar sesión' },
  'login.signingIn': { en: 'Signing in…', es: 'Iniciando sesión…' },
  'login.forgot': {
    en: 'Forgot your password? Use the email link tab to sign in.',
    es: '¿Olvidó su contraseña? Use la pestaña de enlace por correo.',
  },
  'login.checkEmail': { en: 'Check your email', es: 'Revise su correo' },
  'login.linkSent': {
    en: "If {email} is on file, we've sent a sign-in link.",
    es: 'Si {email} está registrado, le enviamos un enlace de acceso.',
  },
  'login.linkExpiry': { en: 'Link expires in 72 hours.', es: 'El enlace vence en 72 horas.' },
  'login.sendAnother': { en: 'Send another link', es: 'Enviar otro enlace' },
  'login.invalidCreds': { en: 'Invalid email or password', es: 'Correo o contraseña incorrectos' },
  'login.newHere': { en: 'New here?', es: '¿Primera vez aquí?' },
  'login.createAccount': { en: 'Create an account', es: 'Crear una cuenta' },

  // ---- signup ----
  'signup.title': { en: 'Create Account', es: 'Crear cuenta' },
  'signup.subtitle': {
    en: "Sign up to view appointments, request service, and manage your loved one's care at {facility}.",
    es: 'Regístrese para ver citas, solicitar servicios y gestionar el cuidado de su ser querido en {facility}.',
  },
  'signup.disabled': {
    en: 'Self-signup is not available for this facility. Please contact the facility for portal access.',
    es: 'El registro no está disponible para este centro. Contacte al centro para obtener acceso al portal.',
  },
  'signup.fullName': { en: 'Your full name', es: 'Su nombre completo' },
  'signup.fullNameHint': {
    en: 'Enter the name the facility has on file for you (POA/guardian).',
    es: 'Ingrese el nombre que el centro tiene registrado para usted (apoderado/tutor).',
  },
  'signup.valueStrip': {
    en: 'See upcoming appointments, pay the balance, and view style photos — all in one place.',
    es: 'Vea las próximas citas, pague el saldo y vea fotos de peinados — todo en un solo lugar.',
  },
  'signup.phone': { en: 'Phone number', es: 'Número de teléfono' },
  'signup.dob': { en: 'Date of birth', es: 'Fecha de nacimiento' },
  'signup.optional': { en: '(optional)', es: '(opcional)' },
  'signup.create': { en: 'Create account', es: 'Crear cuenta' },
  'signup.creating': { en: 'Creating account…', es: 'Creando cuenta…' },
  'signup.haveAccount': { en: 'Already have an account?', es: '¿Ya tiene una cuenta?' },
  'signup.welcome': { en: 'Welcome to {facility}!', es: '¡Bienvenido a {facility}!' },
  'signup.foundAccount': {
    en: 'We found your account. A sign-in link is on its way to {email}.',
    es: 'Encontramos su cuenta. Un enlace de acceso va en camino a {email}.',
  },
  'signup.linkExpirySpam': {
    en: "Link expires in 72 hours. Check your spam folder if you don't see it.",
    es: 'El enlace vence en 72 horas. Revise su carpeta de spam si no lo ve.',
  },
  'signup.goToSignIn': { en: 'Go to sign-in page', es: 'Ir a la página de acceso' },
  'signup.pendingTitle': { en: 'Request received', es: 'Solicitud recibida' },
  'signup.pendingBody': {
    en: "We couldn't automatically match your name to a resident. The facility team will review your request and send you an email when access is granted.",
    es: 'No pudimos vincular automáticamente su nombre con un residente. El equipo del centro revisará su solicitud y le enviará un correo cuando se otorgue el acceso.',
  },
  'signup.pendingEta': { en: 'This usually takes 1–2 business days.', es: 'Esto suele tardar de 1 a 2 días hábiles.' },
  'signup.alreadyAccess': {
    en: 'You already have portal access. Sign in instead.',
    es: 'Ya tiene acceso al portal. Inicie sesión.',
  },
  'signup.signIn': { en: 'Sign in →', es: 'Iniciar sesión →' },

  // ---- extra common ----
  'common.networkError': { en: 'Network error. Please try again.', es: 'Error de red. Inténtelo de nuevo.' },
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
