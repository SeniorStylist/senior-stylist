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
  // P53 — pending sign-up requests shown before conversion
  'appts.requestedTitle': { en: 'Requested', es: 'Solicitadas' },
  'appts.requestedWaiting': {
    en: 'Waiting for the salon to pick a time — you’ll get an email when it’s scheduled.',
    es: 'Esperando a que el salón elija una hora — recibirá un correo cuando esté programada.',
  },
  'appts.requestedFor': { en: 'Preferred', es: 'Preferida' },
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
  // P50 — family autopay opt-in card
  'autopay.title': { en: 'Automatic payment', es: 'Pago automático' },
  'autopay.on': { en: 'On', es: 'Activado' },
  'autopay.off': { en: 'Off', es: 'Desactivado' },
  'autopay.hint': {
    en: 'When on, salon visits are charged to the saved card automatically — no checks, nothing to remember. You get an email receipt each time.',
    es: 'Cuando está activado, las visitas al salón se cobran automáticamente a la tarjeta guardada — sin cheques ni nada que recordar. Recibirá un recibo por correo cada vez.',
  },
  'autopay.chargesTo': { en: 'Charges go to {card}', es: 'Los cargos se hacen a {card}' },
  'autopay.turnOn': { en: 'Turn on automatic payment', es: 'Activar el pago automático' },
  'autopay.turnOff': { en: 'Turn off automatic payment', es: 'Desactivar el pago automático' },
  'autopay.confirmOn': {
    en: 'Charge the saved card automatically after each visit?',
    es: '¿Cobrar automáticamente a la tarjeta guardada después de cada visita?',
  },
  'autopay.confirmOff': { en: 'Turn off automatic charging?', es: '¿Desactivar el cobro automático?' },
  'autopay.emailNote': { en: "You'll get an email confirmation.", es: 'Recibirá una confirmación por correo electrónico.' },
  'autopay.needCard': {
    en: 'Add a card above first to turn this on.',
    es: 'Primero agregue una tarjeta arriba para activarlo.',
  },
  'autopay.confirmYes': { en: "Yes, I'm sure", es: 'Sí, seguro' },
  'autopay.saved': { en: 'Saved — check your email for confirmation.', es: 'Guardado — revise su correo para la confirmación.' },
  'autopay.saveFailed': { en: 'Could not save — please try again.', es: 'No se pudo guardar — inténtelo de nuevo.' },
  'billing.payOnline': { en: 'Pay online', es: 'Pagar en línea' },
  'billing.amount': { en: 'Amount', es: 'Monto' },
  'billing.payWithCard': { en: 'Pay with card', es: 'Pagar con tarjeta' },
  'billing.payBarCta': { en: 'Pay {amount}', es: 'Pagar {amount}' },
  'billing.secureStripe': { en: 'Secure payment via Stripe.', es: 'Pago seguro a través de Stripe.' },
  // P53 — visible salon credit + graceful cards-unavailable state
  'billing.creditAvailable': {
    en: 'Salon credit available: {amount} — the salon will apply it to your balance.',
    es: 'Crédito de salón disponible: {amount} — el salón lo aplicará a su saldo.',
  },
  'billing.cardsUnavailable': {
    en: "Card payments aren't set up yet — please call the salon at {phone} to arrange payment.",
    es: 'Los pagos con tarjeta aún no están disponibles — llame al salón al {phone} para coordinar el pago.',
  },
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
  // P55 — transaction history (payments + gifts + added funds)
  'billing.history.title': { en: 'Payment history', es: 'Historial de pagos' },
  'billing.history.payment': { en: 'Payment', es: 'Pago' },
  'billing.history.paymentVia': { en: 'Payment ({method})', es: 'Pago ({method})' },
  'billing.history.gift': { en: 'Gift received', es: 'Regalo recibido' },
  'billing.history.giftFrom': { en: 'Gift from {name}', es: 'Regalo de {name}' },
  'billing.history.credit': { en: 'Money added', es: 'Fondos agregados' },
  'billing.questions': {
    en: 'Questions about your bill? Contact the facility office',
    es: '¿Preguntas sobre su factura? Comuníquese con la oficina del centro',
  },
  'billing.paymentReceived': { en: 'Payment received — thank you!', es: '¡Pago recibido — gracias!' },
  'billing.giftSent': { en: 'Gift sent — thank you!', es: '¡Regalo enviado — gracias!' },
  // P55 — public shareable gift link (/gift/[token] + share affordances)
  'gift.title': { en: 'Send a gift', es: 'Enviar un regalo' },
  'gift.for': { en: 'A salon gift for {name}', es: 'Un regalo de salón para {name}' },
  'gift.subtitle': {
    en: "Your gift becomes salon credit at {facility} and helps pay for {name}'s hair appointments.",
    es: 'Su regalo se convierte en crédito de salón en {facility} y ayuda a pagar las citas de peluquería de {name}.',
  },
  'gift.amount': { en: 'Amount', es: 'Monto' },
  'gift.custom': { en: 'Other amount (5–500)', es: 'Otro monto (5–500)' },
  'gift.from': { en: 'From (shown to the family)', es: 'De parte de (visible para la familia)' },
  'gift.fromPlaceholder': { en: 'Your name', es: 'Su nombre' },
  'gift.send': { en: 'Send gift', es: 'Enviar regalo' },
  'gift.sending': { en: 'One moment…', es: 'Un momento…' },
  'gift.secure': {
    en: 'Payment is handled securely by Stripe. You will not see any account details.',
    es: 'El pago se procesa de forma segura con Stripe. No verá ningún detalle de la cuenta.',
  },
  'gift.successTitle': { en: 'Thank you!', es: '¡Gracias!' },
  'gift.successBody': {
    en: "Your gift is on its way — the salon will add it to {name}'s account.",
    es: 'Su regalo va en camino — el salón lo agregará a la cuenta de {name}.',
  },
  'gift.sendAnother': { en: 'Send another gift', es: 'Enviar otro regalo' },
  'gift.share': { en: 'Share a gift link', es: 'Compartir un enlace de regalo' },
  'gift.shareHint': {
    en: 'Send this link to any relative — they can chip in for visits without seeing the account.',
    es: 'Envíe este enlace a cualquier familiar — puede aportar para las visitas sin ver la cuenta.',
  },
  'gift.shareCopied': { en: 'Link copied', es: 'Enlace copiado' },
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
  // P55 — working-day guidance (days = localized weekday names)
  'request.workingDaysHint': {
    en: 'The stylist comes on {days}.',
    es: 'La estilista viene los {days}.',
  },
  'request.notWorkingDay': {
    en: "The stylist isn't there on those dates — the stylist comes on {days}. Please pick dates that include one of those days.",
    es: 'La estilista no está esos días — la estilista viene los {days}. Elija fechas que incluyan uno de esos días.',
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
  // P55 — the family-facing product name is "Salon Account" (owner decision)
  'login.title': { en: 'Salon Account', es: 'Cuenta del salón' },
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
  // P55 — the username is email OR phone
  'login.identifier': { en: 'Email or phone number', es: 'Correo o número de teléfono' },
  'login.identifierPlaceholder': { en: 'you@example.com or (555) 123-4567', es: 'usted@ejemplo.com o (555) 123-4567' },
  // P55 — SMS-code login tab (renders only when Twilio is live)
  'login.tabCode': { en: 'Text me a code', es: 'Envíenme un código' },
  'login.identifierPhone': { en: 'Phone number', es: 'Número de teléfono' },
  'login.codeSend': { en: 'Text me a code', es: 'Enviarme un código' },
  'login.codeSent': { en: "If that number is on file, we've texted a code.", es: 'Si ese número está registrado, le enviamos un código.' },
  'login.codeLabel': { en: '6-digit code', es: 'Código de 6 dígitos' },
  'login.codeVerify': { en: 'Sign in', es: 'Iniciar sesión' },
  'login.codeResend': { en: 'Send a new code', es: 'Enviar otro código' },
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
  'login.invalidCreds': { en: 'Invalid email/phone or password', es: 'Correo/teléfono o contraseña incorrectos' },
  'login.newHere': { en: 'New here?', es: '¿Primera vez aquí?' },
  'login.createAccount': { en: 'Create an account', es: 'Crear una cuenta' },

  // ---- signup ----
  'signup.title': { en: 'Create Account', es: 'Crear cuenta' },
  // P54 — the persistent facility banner's small-caps eyebrow
  'signup.facilityEyebrow': { en: 'Salon Account', es: 'Cuenta del salón' },
  'signup.fullName': { en: 'Your full name', es: 'Su nombre completo' },
  'signup.fullNameHint': {
    en: 'Enter the name the facility has on file for you (POA/guardian).',
    es: 'Ingrese el nombre que el centro tiene registrado para usted (apoderado/tutor).',
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
  'signup.created.title': { en: 'Your account is ready', es: 'Su cuenta está lista' },
  'signup.created.body': {
    en: 'We set up the salon account. Check your email for a sign-in link.',
    es: 'Configuramos la cuenta del salón. Revise su correo para el enlace de acceso.',
  },
  'signup.alreadyAccess': {
    en: 'You already have portal access. Sign in instead.',
    es: 'Ya tiene acceso al portal. Inicie sesión.',
  },
  'signup.signIn': { en: 'Sign in →', es: 'Iniciar sesión →' },
  // P50 — senior-first one-question-per-screen wizard
  // P54 — owner-locked copy (Fitzgerald meeting)
  'signup.step.whoTitle': { en: 'Account Info', es: 'Información de la cuenta' },
  'signup.step.whoSelf': { en: "I'm a resident at {facility}", es: 'Soy residente en {facility}' },
  'signup.step.whoFamily': { en: "I'm a family member or helper", es: 'Soy familiar o ayudante' },
  'signup.role.spouse': { en: 'Spouse or partner', es: 'Cónyuge o pareja' },
  'signup.role.child': { en: 'Son or daughter', es: 'Hijo o hija' },
  'signup.role.poa': { en: 'Power of attorney', es: 'Apoderado legal' },
  'signup.role.other': { en: 'Other family or friend', es: 'Otro familiar o amigo' },
  'signup.step.yourName': { en: 'What is your name?', es: '¿Cómo se llama usted?' },
  'signup.step.residentName': { en: "What is the resident's name?", es: '¿Cómo se llama el residente?' },
  'signup.step.residentHint': {
    en: 'The person who lives at {facility} and gets salon visits.',
    es: 'La persona que vive en {facility} y recibe visitas del salón.',
  },
  'signup.step.room': { en: 'What room are they in?', es: '¿En qué habitación está?' },
  'signup.step.roomSelf': { en: 'What room are you in?', es: '¿En qué habitación está usted?' },
  'signup.step.roomHint': {
    en: "It's okay if you're not sure — you can leave this blank.",
    es: 'No pasa nada si no está seguro — puede dejarlo en blanco.',
  },
  // P55 — one contact screen: email OR phone, at least one (owner decision)
  'signup.step.contact': { en: 'How can we reach you?', es: '¿Cómo podemos contactarle?' },
  'signup.step.contactHint': {
    en: 'Give us at least one — both is even better.',
    es: 'Déjenos al menos uno — los dos es aún mejor.',
  },
  'signup.step.contactEmailLabel': { en: 'Email address', es: 'Correo electrónico' },
  'signup.step.contactPhoneLabel': { en: 'Phone number', es: 'Número de teléfono' },
  'signup.step.contactError': {
    en: 'Please give us an email or a phone number.',
    es: 'Por favor déjenos un correo o un número de teléfono.',
  },
  'signup.step.contactEmailInvalid': {
    en: "That email doesn't look complete.",
    es: 'Ese correo no parece completo.',
  },
  'signup.step.contactPhoneInvalid': {
    en: "That phone number doesn't look complete.",
    es: 'Ese número no parece completo.',
  },
  // P55 — password created in the wizard (owner decision)
  'signup.step.password': { en: 'Choose a password', es: 'Elija una contraseña' },
  'signup.step.passwordHint': {
    en: "You'll sign in with your email or phone number plus this password.",
    es: 'Iniciará sesión con su correo o teléfono más esta contraseña.',
  },
  'password.label': { en: 'Password', es: 'Contraseña' },
  'password.placeholder': { en: 'At least 8 characters', es: 'Mínimo 8 caracteres' },
  'password.confirmLabel': { en: 'Confirm password', es: 'Confirme la contraseña' },
  'password.confirmPlaceholder': { en: 'Type it again', es: 'Escríbala otra vez' },
  'password.show': { en: 'Show password', es: 'Mostrar contraseña' },
  'password.hide': { en: 'Hide password', es: 'Ocultar contraseña' },
  'password.tooShort': { en: 'At least 8 characters, please', es: 'Mínimo 8 caracteres, por favor' },
  'password.weak': { en: 'Weak password', es: 'Contraseña débil' },
  'password.medium': { en: 'Medium password', es: 'Contraseña media' },
  'password.strong': { en: 'Strong password', es: 'Contraseña fuerte' },
  'password.match': { en: 'Passwords match', es: 'Las contraseñas coinciden' },
  'password.noMatch': { en: "Passwords don't match yet", es: 'Las contraseñas aún no coinciden' },
  'signup.nav.back': { en: '← Back', es: '← Atrás' },
  'signup.nav.next': { en: 'Next', es: 'Siguiente' },
  'signup.review.title': { en: 'Does this look right?', es: '¿Está todo correcto?' },
  'signup.review.you': { en: 'Your name', es: 'Su nombre' },
  'signup.review.resident': { en: 'Resident', es: 'Residente' },
  'signup.review.room': { en: 'Room', es: 'Habitación' },
  'signup.review.email': { en: 'Email', es: 'Correo' },
  'signup.review.phone': { en: 'Phone', es: 'Teléfono' },
  'signup.review.edit': { en: 'Change', es: 'Cambiar' },
  // P54 — with payments configured, review flows into the card page.
  'signup.review.submit': { en: 'Continue to Payment', es: 'Continuar al pago' },
  'signup.review.submitNoPay': { en: 'Create my account', es: 'Crear mi cuenta' },
  // P54 — the card page (card on file is the default; reassurance carries trust)
  'signup.payment.title': { en: 'Add a payment card', es: 'Agregue una tarjeta de pago' },
  'signup.payment.reassure': {
    en: 'Your card is stored securely by Stripe. Nothing is charged until you receive a service.',
    es: 'Stripe guarda su tarjeta de forma segura. No se cobra nada hasta que reciba un servicio.',
  },
  'signup.payment.skipAfterError': { en: 'Continue for now', es: 'Continuar por ahora' },
  'signup.payment.preview': {
    en: 'Preview — card entry is skipped in the dry run.',
    es: 'Vista previa — la tarjeta se omite en la prueba.',
  },
  'signup.done.goToAccount': { en: 'Go to my account', es: 'Ir a mi cuenta' },
  // P55 — phone-only done screens (no email = no sign-in link to mention)
  'signup.foundAccountPhone': {
    en: "You're all set — the salon has your number and will text you about visits.",
    es: 'Todo listo — el salón tiene su número y le enviará mensajes sobre las visitas.',
  },
  'signup.createdPhone.title': { en: "You're signed up", es: 'Ya está registrado' },
  'signup.createdPhone.body': {
    en: 'The salon has your number. Sign in any time with your phone number and password.',
    es: 'El salón tiene su número. Inicie sesión cuando quiera con su teléfono y contraseña.',
  },
  'signup.progress': { en: 'Step {step} of {total}', es: 'Paso {step} de {total}' },
  // P52 — "is this them?" match confirmation step
  'signup.match.title': { en: 'We found them — is this right?', es: 'Los encontramos — ¿es correcto?' },
  'signup.match.hint': {
    en: 'This resident is on file at {facility}.',
    es: 'Este residente está registrado en {facility}.',
  },
  'signup.match.roomLabel': { en: 'Room {room}', es: 'Habitación {room}' },
  'signup.match.poaLine': {
    en: 'Family contact on file: {name}',
    es: 'Contacto familiar registrado: {name}',
  },
  'signup.match.yes': { en: "Yes — that's them", es: 'Sí — es esa persona' },
  'signup.match.no': { en: 'No, someone else', es: 'No, es otra persona' },
  'signup.match.checking': { en: 'Checking…', es: 'Verificando…' },
  'signup.tooMany': {
    en: 'A lot of families are signing up right now — please wait a few minutes and try again.',
    es: 'Muchas familias se están registrando en este momento — espere unos minutos e inténtelo de nuevo.',
  },
  // P53 — master-only dry-run mode (Debug tab)
  'signup.preview.banner': {
    en: 'Preview — nothing will be created. The wizard runs all the real checks, but no accounts, residents, or emails are made.',
    es: 'Vista previa — no se creará nada. El asistente ejecuta todas las verificaciones reales, pero no se crean cuentas, residentes ni correos.',
  },
  'signup.preview.done': {
    en: 'Preview — nothing was created.',
    es: 'Vista previa — no se creó nada.',
  },
  'signup.disabledFacility': {
    en: "Online sign-up isn't set up at {facility} yet. Please ask at the front desk — they can send you an invitation.",
    es: 'El registro en línea aún no está disponible en {facility}. Pregunte en la recepción — pueden enviarle una invitación.',
  },

  // ---- P50-C7 first-login welcome flow ----
  'welcome.title': { en: "Let's get set up", es: 'Vamos a configurar' },
  'welcome.subtitle': {
    en: 'A few quick steps — you can skip any of them.',
    es: 'Unos pasos rápidos — puede omitir cualquiera.',
  },
  'welcome.stepCard.title': { en: 'Save a card for {name}', es: 'Guardar una tarjeta para {name}' },
  'welcome.stepCard.hint': {
    en: 'Salon visits can then be paid automatically — no checks to mail. Nothing is charged now.',
    es: 'Las visitas al salón podrán pagarse automáticamente — sin cheques por correo. No se cobra nada ahora.',
  },
  'welcome.stepAutopay.title': { en: 'Turn on automatic payment?', es: '¿Activar el pago automático?' },
  'welcome.stepAutopay.hint': {
    en: 'Each visit is charged to the saved card and you get an email receipt every time.',
    es: 'Cada visita se cobra a la tarjeta guardada y recibirá un recibo por correo cada vez.',
  },
  'welcome.stepAutopay.yes': { en: 'Yes, turn it on', es: 'Sí, activarlo' },
  'welcome.stepRhythm.title': {
    en: 'How often does {name} like salon visits?',
    es: '¿Con qué frecuencia le gustan a {name} las visitas al salón?',
  },
  'welcome.stepRhythm.hint': {
    en: 'This helps the salon keep a regular rhythm. You can change it any time.',
    es: 'Esto ayuda al salón a mantener un ritmo regular. Puede cambiarlo en cualquier momento.',
  },
  'welcome.rhythm.weekly': { en: 'Every week', es: 'Cada semana' },
  'welcome.rhythm.biweekly': { en: 'Every 2 weeks', es: 'Cada 2 semanas' },
  'welcome.rhythm.monthly': { en: 'Once a month', es: 'Una vez al mes' },
  'welcome.rhythm.notSure': { en: 'Not sure yet', es: 'Aún no estoy seguro' },
  'welcome.skipStep': { en: 'Skip this step', es: 'Omitir este paso' },
  'welcome.skipAll': { en: 'Skip setup for now', es: 'Omitir la configuración por ahora' },
  'welcome.done.title': { en: "You're all set!", es: '¡Todo listo!' },
  'welcome.done.hint': {
    en: 'Would you like to request a first appointment now?',
    es: '¿Le gustaría solicitar una primera cita ahora?',
  },
  'welcome.done.request': { en: 'Request an appointment', es: 'Solicitar una cita' },
  'welcome.done.home': { en: 'Go to my home page', es: 'Ir a mi página principal' },
  'welcome.cardSaved': { en: 'Card saved ✓', es: 'Tarjeta guardada ✓' },
  // ---- P50-C7 request-page visit rhythm ----
  'request.rhythm.title': {
    en: 'How often does {name} like visits?',
    es: '¿Con qué frecuencia le gustan las visitas a {name}?',
  },
  'request.rhythm.saved': { en: 'Preference saved', es: 'Preferencia guardada' },

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
