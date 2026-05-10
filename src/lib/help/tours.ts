// Help Center: tutorial catalog + navigation-aware Driver.js tour engine.
//
// Phase 12H rewrite: tours iterate one step at a time, hard-nav across routes
// (with sessionStorage resume), wait for elements to appear, and auto-advance
// on user click for action steps. Driver.js is dynamic-imported on first use.

import type { Driver } from 'driver.js'

// ────────────────────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────────────────────

export type TutorialRole =
  | 'admin'
  | 'super_admin'
  | 'facility_staff'
  | 'bookkeeper'
  | 'stylist'
  | 'viewer'

export type TutorialIcon =
  | 'KeyRound' | 'Calendar' | 'FileText' | 'Users' | 'UserPlus'
  | 'CheckCircle2' | 'UserCog' | 'Building2' | 'Mail' | 'BarChart3'
  | 'HeartHandshake' | 'ShieldCheck' | 'CreditCard' | 'ScanLine'
  | 'GitMerge' | 'Database' | 'FileSpreadsheet' | 'Wallet' | 'PlusSquare'
  | 'Network' | 'BookOpen' | 'CircleHelp'

export type Tutorial = {
  id: string
  category: string
  title: string
  blurb: string
  estMinutes: number
  icon: TutorialIcon
  roles: TutorialRole[]
  /** Non-null when a Driver.js tour is implemented. */
  tourId: string | null
  /** Master-admin (env-email) only. */
  masterOnly?: boolean
}

export type TourStep = {
  /** CSS selector for the element to highlight. Empty string = no highlight (info-only step). */
  element: string
  /** Pathname this element lives on. Hard-nav to here if window.location.pathname differs. */
  route: string
  title: string
  description: string
  /** true = wait for user to click highlighted element to advance; false = show Next button. */
  isAction: boolean
  /** Sub-text shown below description on action steps, e.g. "Tap Calendar to continue". */
  actionHint?: string
  /** Optional mobile-specific title; falls back to `title` when omitted (Phase 12J). */
  mobileTitle?: string
  /** Optional mobile-specific description; falls back to `description` when omitted (Phase 12J). */
  mobileDescription?: string
}

export type TourDefinition = {
  id: string
  title: string
  /** When true, tour is disabled on mobile breakpoints (sidebar-only navigation, etc). */
  desktopOnly?: boolean
  steps: TourStep[]
}

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

export const SESSION_KEY = 'helpTour'
export const SESSION_TTL_MS = 5 * 60 * 1000 // 5 minutes
export const ELEMENT_WAIT_MS = 5000

export const isMobile = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(max-width: 767px)').matches

/**
 * On mobile, prefer [data-tour-mobile="X"] but fall back to [data-tour="X"].
 * Lets step authors write a single selector and have it resolve correctly per device.
 */
export function resolveQuery(selector: string): string {
  if (!isMobile()) return selector
  const m = selector.match(/^\[data-tour="([^"]+)"\]$/)
  if (!m) return selector
  return `[data-tour-mobile="${m[1]}"], [data-tour="${m[1]}"]`
}

/** Poll for an element via requestAnimationFrame. Returns null on timeout. */
export function waitForElement(selector: string, timeoutMs: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const tick = () => {
      const el = document.querySelector<HTMLElement>(selector)
      if (el && el.offsetParent !== null) {
        resolve(el)
        return
      }
      if (Date.now() > deadline) {
        resolve(null)
        return
      }
      requestAnimationFrame(tick)
    }
    tick()
  })
}

export type SessionState = {
  tourId: string
  stepIndex: number
  expiresAt: number
  /** Sticky to the device that started the tour. When true, resume via mobile renderer. */
  mobile?: boolean
}

export function saveSessionState(state: SessionState) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state))
  } catch {
    // sessionStorage unavailable — tour will not resume after nav
  }
}

export function loadSessionState(): SessionState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionState
    if (Date.now() > parsed.expiresAt) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearSessionState() {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // no-op
  }
}

// Lightweight global toast surface. The Help Center renders inside the
// protected layout where useToast() is available, but the tour engine runs
// outside React. We dispatch a CustomEvent that any mounted listener can pick up.
export function toastWarning(message: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('help-tour-toast', { detail: { kind: 'warning', message } }))
}

export function toastInfo(message: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('help-tour-toast', { detail: { kind: 'info', message } }))
}

// ────────────────────────────────────────────────────────────────────────────
// TUTORIAL CATALOG — every card on /help. Cards with non-null tourId launch
// a real Driver.js tour. The remainder still show "Coming soon".
// ────────────────────────────────────────────────────────────────────────────

export const TUTORIAL_CATALOG: Tutorial[] = [
  // STYLIST
  { id: 'stylist-getting-started', category: 'Getting Started', title: 'Getting Started', blurb: 'A quick orientation: your calendar, daily log, and My Account page.', estMinutes: 2, icon: 'KeyRound', roles: ['stylist'], tourId: 'stylist-getting-started' },
  { id: 'stylist-calendar', category: 'Scheduling', title: 'Your Calendar', blurb: 'Read your schedule, tap appointments to edit them, and create new bookings.', estMinutes: 3, icon: 'Calendar', roles: ['stylist'], tourId: 'stylist-calendar' },
  { id: 'stylist-daily-log', category: 'Daily Log', title: 'Daily Log', blurb: 'Record services, add walk-ins, and finalize your log at end of shift.', estMinutes: 3, icon: 'FileText', roles: ['stylist'], tourId: 'stylist-daily-log' },
  { id: 'stylist-residents', category: 'Residents', title: 'Managing Residents', blurb: 'Find, edit, and add residents at your facility.', estMinutes: 3, icon: 'Users', roles: ['stylist'], tourId: 'stylist-residents' },
  { id: 'stylist-finalize-day', category: 'Daily Log', title: 'Finalizing the Day', blurb: 'Step-by-step guide to reviewing and locking the daily log.', estMinutes: 2, icon: 'CheckCircle2', roles: ['stylist'], tourId: 'stylist-finalize-day' },
  { id: 'stylist-my-account', category: 'Account', title: 'My Account', blurb: 'Manage your schedule, upload compliance documents, and request time off.', estMinutes: 3, icon: 'UserCog', roles: ['stylist'], tourId: 'stylist-my-account' },

  // FACILITY STAFF
  { id: 'staff-getting-started', category: 'Getting Started', title: 'Getting Started', blurb: 'Sign in and find your way around.', estMinutes: 2, icon: 'KeyRound', roles: ['facility_staff'], tourId: null },
  { id: 'facility-staff-residents', category: 'Residents', title: 'Resident List', blurb: 'Find, edit, and manage residents.', estMinutes: 3, icon: 'Users', roles: ['facility_staff'], tourId: 'facility-staff-residents' },
  { id: 'facility-staff-scheduling', category: 'Scheduling', title: 'Scheduling', blurb: 'Book appointments from the calendar and manage residents.', estMinutes: 3, icon: 'Calendar', roles: ['facility_staff'], tourId: 'facility-staff-scheduling' },
  { id: 'staff-daily-log-readonly', category: 'Daily Log', title: 'Daily Log (Read-Only)', blurb: 'See what was done today. View-only.', estMinutes: 2, icon: 'FileText', roles: ['facility_staff'], tourId: null },

  // ADMIN
  { id: 'admin-facility-setup', category: 'Facility', title: 'Facility Setup', blurb: 'Set name, hours, working days, payment type, contact info.', estMinutes: 4, icon: 'Building2', roles: ['admin', 'super_admin'], tourId: 'admin-facility-setup' },
  { id: 'admin-inviting-staff', category: 'Team', title: 'Inviting Staff', blurb: 'Send invites and pick the right role.', estMinutes: 3, icon: 'Mail', roles: ['admin', 'super_admin'], tourId: 'admin-inviting-staff' },
  { id: 'admin-residents', category: 'Residents', title: 'Residents', blurb: 'Add, search, and manage your facility roster.', estMinutes: 3, icon: 'Users', roles: ['admin', 'super_admin'], tourId: 'admin-residents' },
  { id: 'admin-reports', category: 'Reports', title: 'Reports & Analytics', blurb: 'Run revenue and stylist breakdowns.', estMinutes: 3, icon: 'BarChart3', roles: ['admin', 'super_admin'], tourId: 'admin-reports' },
  { id: 'admin-family-portal', category: 'Family Portal', title: 'Family Portal', blurb: 'Send a private portal link to a resident\'s POA.', estMinutes: 4, icon: 'HeartHandshake', roles: ['admin', 'super_admin'], tourId: 'admin-family-portal' },
  { id: 'admin-compliance', category: 'Compliance', title: 'Compliance Documents', blurb: 'Manage stylist licenses, insurance, and contracts.', estMinutes: 3, icon: 'ShieldCheck', roles: ['admin', 'super_admin'], tourId: 'admin-compliance' },

  // BOOKKEEPER
  { id: 'bookkeeper-billing-dashboard', category: 'Billing', title: 'Billing Dashboard', blurb: 'Navigate AR, statements, and outstanding balances.', estMinutes: 4, icon: 'CreditCard', roles: ['bookkeeper'], tourId: 'bookkeeper-billing-dashboard' },
  { id: 'bookkeeper-scan-logs', category: 'Daily Log', title: 'Scanning Daily Logs', blurb: 'Upload paper logs and let OCR fill the entries.', estMinutes: 5, icon: 'ScanLine', roles: ['bookkeeper'], tourId: 'bookkeeper-scan-logs' },
  { id: 'bookkeeper-duplicates', category: 'Residents', title: 'Duplicate Resolution', blurb: 'Find and merge duplicate resident records.', estMinutes: 3, icon: 'GitMerge', roles: ['bookkeeper'], tourId: 'bookkeeper-duplicates' },
  { id: 'bookkeeper-quickbooks', category: 'Billing', title: 'QuickBooks Data', blurb: 'Import QB data and read balances.', estMinutes: 4, icon: 'Database', roles: ['bookkeeper'], tourId: null },
  { id: 'bookkeeper-financial-reports', category: 'Reports', title: 'Financial Reports', blurb: 'Run and export reports for accounting.', estMinutes: 3, icon: 'FileSpreadsheet', roles: ['bookkeeper'], tourId: null },
  { id: 'bookkeeper-payroll', category: 'Payroll', title: 'Payroll & Pay Periods', blurb: 'Review pay periods and confirm payments.', estMinutes: 4, icon: 'Wallet', roles: ['bookkeeper'], tourId: 'bookkeeper-payroll' },

  // MASTER ADMIN (master-only)
  { id: 'master-add-facility', category: 'Facilities', title: 'Adding a Facility', blurb: 'Create and configure a new facility.', estMinutes: 4, icon: 'PlusSquare', roles: ['admin', 'super_admin'], tourId: 'master-add-facility', masterOnly: true },
  { id: 'master-quickbooks-setup', category: 'Billing', title: 'QuickBooks Setup', blurb: 'Connect QuickBooks per facility.', estMinutes: 5, icon: 'Database', roles: ['admin', 'super_admin'], tourId: 'master-quickbooks-setup', masterOnly: true },
  { id: 'master-franchise', category: 'Franchise', title: 'Franchise Management', blurb: 'Manage franchises and super admin assignments.', estMinutes: 4, icon: 'Network', roles: ['admin', 'super_admin'], tourId: null, masterOnly: true },
  { id: 'master-cross-facility-analytics', category: 'Reports', title: 'Cross-Facility Analytics', blurb: 'View revenue and KPIs across facilities.', estMinutes: 3, icon: 'BarChart3', roles: ['admin', 'super_admin'], tourId: null, masterOnly: true },
  { id: 'master-merge-duplicates', category: 'Residents', title: 'Merging Duplicates', blurb: 'Merge duplicate facilities and residents.', estMinutes: 4, icon: 'GitMerge', roles: ['admin', 'super_admin'], tourId: null, masterOnly: true },
  { id: 'master-team-roster', category: 'Team', title: 'Global Team Roster', blurb: 'See every user across every facility.', estMinutes: 3, icon: 'Users', roles: ['admin', 'super_admin'], tourId: null, masterOnly: true },
]

// ────────────────────────────────────────────────────────────────────────────
// TOUR DEFINITIONS — 19 fully implemented tours.
// ────────────────────────────────────────────────────────────────────────────

const NAV_CALENDAR = '[data-tour="nav-calendar"]'
const NAV_DAILY_LOG = '[data-tour="nav-daily-log"]'
const NAV_RESIDENTS = '[data-tour="nav-residents"]'
const NAV_BILLING = '[data-tour="nav-billing"]'
const NAV_SETTINGS = '[data-tour="nav-settings"]'
const NAV_ANALYTICS = '[data-tour="nav-analytics"]'
const NAV_PAYROLL = '[data-tour="nav-payroll"]'
const NAV_STYLISTS = '[data-tour="nav-stylists"]'
const NAV_MASTER_ADMIN = '[data-tour="nav-master-admin"]'
const NAV_MY_ACCOUNT = '[data-tour="nav-my-account"]'

export const TOUR_DEFINITIONS: Record<string, TourDefinition> = {
  // 1
  'stylist-getting-started': {
    id: 'stylist-getting-started',
    title: 'Getting Started',
    steps: [
      { route: '/help', element: '', isAction: false, title: 'Welcome', description: 'Welcome to Senior Stylist! This quick tour will show you the three things you\'ll use every day: your Calendar, your Daily Log, and your My Account page.', mobileDescription: 'Quick tour of your Calendar, Daily Log, and My Account.' },
      { route: '/help', element: NAV_CALENDAR, isAction: true, title: 'Navigate to Calendar', description: 'Your Calendar is your home base — this is where you see your schedule and manage appointments.', actionHint: 'Tap Calendar to take a look.' },
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'Your schedule', description: 'On mobile you\'ll see today\'s appointments. On desktop you\'ll see the full week. Each colored block is a booked appointment.' },
      { route: '/dashboard', element: NAV_DAILY_LOG, isAction: true, title: 'Go to Daily Log', description: 'The Daily Log is where you record and finalize your work at the end of each day.', actionHint: 'Tap Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: 'Daily Log overview', description: 'Each row is an appointment from your calendar. At the end of your shift, you\'ll review these and tap Finalize Day.' },
      { route: '/log', element: NAV_MY_ACCOUNT, isAction: true, title: 'My Account', description: 'My Account is where you manage your schedule, upload your license and documents, and request time off.', actionHint: 'Tap My Account to continue.' },
      { route: '/my-account', element: '', isAction: false, title: 'You\'re ready', description: 'That\'s the overview! Use the Help section anytime to revisit any of these tours in more detail.' },
    ],
  },

  // 2
  'stylist-calendar': {
    id: 'stylist-calendar',
    title: 'Your Calendar',
    steps: [
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'Your calendar', description: 'This is your calendar. On mobile it shows today\'s appointments. On desktop it shows the full week. Use the arrows to move between days.', mobileDescription: 'Your calendar shows today\'s appointments. Use the arrows to switch days.' },
      { route: '/dashboard', element: '[data-tour="calendar-today-btn"]', isAction: false, title: 'Today button', description: 'Tap Today anytime to jump back to the current date.' },
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'Existing appointments', description: 'Each colored block is a booked appointment. Tap any appointment to open it and make changes — update the service, add a note, or adjust the time.', mobileDescription: 'Each colored block is a booking. Tap one to edit the service, time, or notes.' },
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'Create a new booking', description: 'To create a new booking, tap any empty area on the calendar. A form will appear where you choose the resident, service, date, and time — then tap Save.', mobileDescription: 'Tap any empty area to create a new booking. Pick a resident, service, and time, then Save.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Walk-ins', description: 'You can also add a walk-in from the Daily Log if a resident comes in without a booking. We\'ll cover that in the Daily Log tour.' },
    ],
  },

  // 3
  'stylist-daily-log': {
    id: 'stylist-daily-log',
    title: 'Daily Log',
    steps: [
      { route: '/dashboard', element: NAV_DAILY_LOG, isAction: true, title: 'Go to Daily Log', description: 'Let\'s go to your Daily Log.', actionHint: 'Tap Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: 'What is the Daily Log', description: 'The Daily Log shows every appointment from your calendar for today. At the end of your shift, you\'ll review and finalize these entries.' },
      { route: '/log', element: '', isAction: false, title: 'Each entry', description: 'Each row is one appointment. You can see the resident\'s name, the service, and the price. Tap a row to edit the price or add a note.' },
      { route: '/log', element: '[data-tour="daily-log-add-walkin"]', isAction: true, title: 'Add a walk-in', description: 'If a resident came in without a booking, tap \'Add Walk-in\' to add them to today\'s log.', actionHint: 'Tap Add Walk-in to continue.' },
      { route: '/log', element: '', isAction: false, title: 'Walk-in form', description: 'Search for the resident by name. If they\'re not in the system yet, you can add them as a new resident. Then choose the service and price.' },
      { route: '/log', element: '[data-tour="daily-log-finalize-button"]', isAction: true, title: 'Finalize the day', description: 'When you\'re done for the day, tap \'Finalize Day\'. This locks your log and submits it to your admin. Double-check everything first — you won\'t be able to edit after finalizing.', mobileDescription: 'Tap Finalize Day to lock and submit your log. Double-check first — you can\'t edit after.', actionHint: 'Tap Finalize Day to continue.' },
      { route: '/log', element: '', isAction: false, title: 'After finalizing', description: 'Once finalized, your admin can see the completed log. If you made a mistake, contact your admin and they can make corrections.' },
    ],
  },

  // 4
  'stylist-residents': {
    id: 'stylist-residents',
    title: 'Managing Residents',
    steps: [
      { route: '/residents', element: '[data-tour="residents-table"]', isAction: false, title: 'Resident list', description: 'This is the resident list for your facility. Every resident who receives services is listed here.' },
      { route: '/residents', element: '[data-tour="residents-search"]', isAction: true, title: 'Search', description: 'Use the search bar to find a resident quickly by name or room number.', actionHint: 'Tap the search bar to continue.' },
      { route: '/residents', element: '[data-tour="residents-table"]', isAction: false, title: 'Resident card', description: 'Tap any resident\'s name to open their profile. You\'ll see their room number, POA contact, and full booking history.' },
      { route: '/residents', element: '[data-tour="residents-new-button"]', isAction: true, title: 'Add a new resident', description: 'If a resident isn\'t in the list yet, tap the + button to add them.', actionHint: 'Tap "+" to continue.' },
      { route: '/residents', element: '[data-tour="residents-add-form"]', isAction: false, title: 'New resident form', description: 'Fill in their name and room number. POA contact info is optional but helpful for billing and portal access.' },
    ],
  },

  // 5
  'stylist-finalize-day': {
    id: 'stylist-finalize-day',
    title: 'Finalizing the Day',
    steps: [
      { route: '/dashboard', element: NAV_DAILY_LOG, isAction: true, title: 'Go to Daily Log', description: 'Let\'s walk through finalizing your day.', actionHint: 'Tap Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: 'Check entries', description: 'Before finalizing, check that every entry has the right service and price. Tap any row to make a correction.' },
      { route: '/log', element: '[data-tour="daily-log-add-walkin"]', isAction: false, title: 'Check for walk-ins', description: 'Make sure any walk-ins are added. Anyone who came in without a pre-booked appointment needs to be added here before you finalize.', mobileDescription: 'Make sure all walk-ins are added before finalizing.' },
      { route: '/log', element: '[data-tour="daily-log-finalize-button"]', isAction: true, title: 'Finalize Day', description: 'When everything looks right, tap \'Finalize Day\'.', actionHint: 'Tap Finalize Day to continue.' },
      { route: '/log', element: '', isAction: false, title: 'Log submitted', description: 'Your log is now submitted. Entries are locked — if anything needs correcting, reach out to your admin.' },
    ],
  },

  // 5b
  'stylist-my-account': {
    id: 'stylist-my-account',
    title: 'My Account',
    steps: [
      { route: '/dashboard', element: NAV_MY_ACCOUNT, isAction: true, title: 'My Account', description: 'Let\'s explore your My Account page — this is where you manage your personal info, schedule, and documents.', actionHint: 'Tap My Account to continue.' },
      { route: '/my-account', element: '[data-tour="my-account-schedule"]', isAction: false, title: 'Your schedule', description: 'Your Schedule shows which days and hours you\'re working at each facility. This is what admins use to assign you bookings.' },
      { route: '/my-account', element: '', isAction: false, title: 'Edit your hours', description: 'Tap Edit hours next to any day to change your start and end time for that day. Tap Save — changes take effect immediately and your calendar will reflect the new availability.', mobileDescription: 'Tap Edit hours next to a day to change your start and end time. Changes apply right away.' },
      { route: '/my-account', element: '[data-tour="my-account-compliance"]', isAction: false, title: 'Compliance documents', description: 'The Compliance section is where you upload your documents — cosmetology license, liability insurance, W-9, and any other required paperwork.' },
      { route: '/my-account', element: '[data-tour="my-account-compliance-upload"]', isAction: false, title: 'Upload a document', description: 'Tap Upload to add a document. Choose the document type and your admin will be notified to verify it.' },
      { route: '/my-account', element: '[data-tour="my-account-timeoff"]', isAction: false, title: 'Time off requests', description: 'Need a day off? Use the Time Off section to submit a request. Your admin will be notified and can arrange coverage.' },
      { route: '/my-account', element: '', isAction: false, title: 'Keep documents current', description: 'Keep your documents up to date — you\'ll receive an alert before anything expires so you\'re never caught off guard.' },
    ],
  },

  // 6
  'facility-staff-scheduling': {
    id: 'facility-staff-scheduling',
    title: 'Scheduling',
    steps: [
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'Welcome', description: 'As facility staff, you can schedule appointments for residents directly from the calendar.' },
      { route: '/dashboard', element: '.fc-timegrid-cols', isAction: true, title: 'Pick a time slot', description: 'Tap any empty area on the calendar to start a booking for a resident.', actionHint: 'Tap any empty slot to continue.' },
      { route: '/dashboard', element: '[data-tour="calendar-booking-modal"]', isAction: false, title: 'Booking form', description: 'Search for the resident by name, choose the service, and confirm the stylist and time. Then tap Save.' },
      { route: '/dashboard', element: NAV_RESIDENTS, isAction: true, title: 'Go to Residents', description: 'You can also manage residents directly.', actionHint: 'Tap Residents to continue.' },
      { route: '/residents', element: '[data-tour="residents-table"]', isAction: false, title: 'Resident list', description: 'From here you can search for residents, view their profile, and see their booking history.' },
      { route: '/residents', element: '[data-tour="residents-new-button"]', isAction: true, title: 'Add a resident', description: 'Need to add someone new? Tap + to add a new resident.', actionHint: 'Tap "+" to continue.' },
      { route: '/residents', element: '', isAction: false, title: 'You\'re set', description: 'That covers the main scheduling and resident workflows for facility staff.' },
    ],
  },

  // 7
  'facility-staff-residents': {
    id: 'facility-staff-residents',
    title: 'Resident List',
    steps: [
      { route: '/residents', element: '[data-tour="residents-table"]', isAction: false, title: 'Resident list', description: 'This is the full resident list for your facility.' },
      { route: '/residents', element: '[data-tour="residents-search"]', isAction: true, title: 'Search', description: 'Type a name or room number to find someone quickly.', actionHint: 'Tap the search bar to continue.' },
      { route: '/residents', element: '[data-tour="residents-table"]', isAction: false, title: 'Resident profile', description: 'Tap any resident to open their profile, see their POA contact, and view or edit their information.' },
      { route: '/residents', element: '[data-tour="residents-new-button"]', isAction: true, title: 'Add new resident', description: 'Tap + to add a resident who isn\'t in the system yet.', actionHint: 'Tap "+" to continue.' },
      { route: '/residents', element: '[data-tour="residents-add-form"]', isAction: false, title: 'New resident form', description: 'Enter their name, room number, and POA contact. The POA is the family member or contact responsible for payments.' },
    ],
  },

  // 8
  'admin-facility-setup': {
    id: 'admin-facility-setup',
    title: 'Facility Setup',
    steps: [
      { route: '/dashboard', element: NAV_SETTINGS, isAction: true, title: 'Go to Settings', description: 'Let\'s set up your facility.', actionHint: 'Tap Settings to continue.' },
      { route: '/settings', element: '[data-tour="settings-facility-form"]', isAction: false, title: 'Facility name & contact', description: 'Start with your facility name, address, phone, and contact email. This information appears on statements sent to families.' },
      { route: '/settings', element: '[data-tour="settings-working-hours"]', isAction: false, title: 'Working hours', description: 'Set the days and hours your facility is open. Bookings can only be scheduled within these times.' },
      { route: '/settings', element: '[data-tour="settings-payment-type"]', isAction: false, title: 'Payment type', description: 'Choose how your facility handles payments — facility-billed (invoiced to the facility) or resident-billed (invoiced per resident).' },
      { route: '/settings', element: '[data-tour="settings-save-button"]', isAction: false, title: 'Save', description: 'Tap Save when you\'re done. Your changes take effect immediately.' },
    ],
  },

  // 9
  'admin-inviting-staff': {
    id: 'admin-inviting-staff',
    title: 'Inviting Staff',
    steps: [
      { route: '/dashboard', element: NAV_SETTINGS, isAction: true, title: 'Go to Settings', description: 'Let\'s invite a staff member.', actionHint: 'Tap Settings to continue.' },
      { route: '/settings?section=team', element: '[data-tour="settings-team-section"]', isAction: false, title: 'Team & Roles', description: 'The Team & Roles section shows everyone who has access to your facility and lets you invite new members.' },
      { route: '/settings?section=team', element: '[data-tour="settings-invite-form"]', isAction: false, title: 'Invite form', description: 'Enter the person\'s email address and choose their role. Facility Staff can manage residents and scheduling. Stylists can access the calendar and daily log.' },
      { route: '/settings?section=team', element: '[data-tour="settings-invite-role-select"]', isAction: false, title: 'Roles explained', description: 'Facility Staff: scheduling and resident management. Stylist: calendar and daily log only. Bookkeeper: billing and payroll only.' },
      { route: '/settings?section=team', element: '[data-tour="settings-invite-submit"]', isAction: false, title: 'Send invite', description: 'Tap "Send Invite" to email them an invitation. They\'ll receive a link to set up their account.' },
      { route: '/settings?section=team', element: '[data-tour="settings-pending-invites"]', isAction: false, title: 'Pending invites', description: 'Sent invites appear here until they\'re accepted. You can resend or cancel them from this list.' },
    ],
  },

  // 10
  'admin-residents': {
    id: 'admin-residents',
    title: 'Residents',
    steps: [
      { route: '/residents', element: '[data-tour="residents-table"]', isAction: false, title: 'Resident list', description: 'Every resident who receives services at your facility is listed here.' },
      { route: '/residents', element: '[data-tour="residents-new-button"]', isAction: true, title: 'Add a resident', description: 'Tap + to add a new resident to the system.', actionHint: 'Tap "+" to continue.' },
      { route: '/residents', element: '[data-tour="residents-add-form"]', isAction: false, title: 'Resident form', description: 'Fill in their name, room, and POA contact. The POA receives billing statements and can access the family portal.' },
      { route: '/residents', element: '[data-tour="residents-search"]', isAction: true, title: 'Search', description: 'Use the search bar to find any resident by name or room.', actionHint: 'Tap the search bar to continue.' },
      { route: '/residents', element: '[data-tour="residents-table"]', isAction: false, title: 'Resident profile', description: 'Tap a resident\'s name to open their full profile — booking history, payment status, and portal access.' },
      { route: '/residents', element: '[data-tour="residents-import-button"]', isAction: false, title: 'Import', description: 'Have a large list? Use the Import button to upload a CSV of residents all at once.' },
    ],
  },

  // 11
  'admin-reports': {
    id: 'admin-reports',
    title: 'Reports & Analytics',
    steps: [
      { route: '/dashboard', element: NAV_ANALYTICS, isAction: true, title: 'Go to Analytics', description: 'Tap Analytics to see your facility\'s performance.', actionHint: 'Tap Analytics to continue.' },
      { route: '/analytics', element: '[data-tour="analytics-revenue-summary"]', isAction: false, title: 'Revenue summary', description: 'This shows your total revenue for the selected period, broken down by service type.' },
      { route: '/analytics', element: '[data-tour="analytics-date-range"]', isAction: false, title: 'Date range', description: 'Change the date range to see weekly, monthly, or custom reports.' },
      { route: '/analytics', element: '[data-tour="analytics-by-stylist"]', isAction: false, title: 'By stylist', description: 'Scroll down to see a breakdown of revenue and appointments per stylist.' },
    ],
  },

  // 12
  'admin-family-portal': {
    id: 'admin-family-portal',
    title: 'Family Portal',
    steps: [
      { route: '/residents', element: '', isAction: false, title: 'What is the Family Portal', description: 'The Family Portal lets residents\' family members view upcoming appointments and booking history online — no app needed.' },
      { route: '/residents', element: '[data-tour="residents-table"]', isAction: false, title: 'Open a resident', description: 'Tap any resident\'s name to open their profile, then scroll to the Family Portal section.' },
      { route: '/residents', element: '', isAction: false, title: 'Portal section', description: 'Open any resident\'s profile and scroll down to the "Family Portal" section. There you can generate a private portal link for that resident\'s family.' },
      { route: '/residents', element: '', isAction: false, title: 'Send the link', description: 'Tap "Send Link" to email the portal link to the POA contact on file. The family receives a private link — no app or password required.' },
      { route: '/residents', element: '', isAction: false, title: 'What the family sees', description: 'The family can view upcoming appointments, past services, and request new bookings. They cannot see billing amounts.' },
    ],
  },

  // 13
  'admin-compliance': {
    id: 'admin-compliance',
    title: 'Compliance Documents',
    desktopOnly: true,
    steps: [
      { route: '/dashboard', element: NAV_STYLISTS, isAction: true, title: 'Go to Stylists', description: 'Compliance documents are managed per stylist.', actionHint: 'Tap Stylists to continue.' },
      { route: '/stylists', element: '[data-tour="stylists-table"]', isAction: false, title: 'Stylist list', description: 'Each stylist has a profile where you can track their license, insurance, and contract documents.' },
      { route: '/stylists', element: '[data-tour="stylists-table"]', isAction: false, title: 'Open a stylist', description: 'Tap a stylist\'s name to open their profile.' },
      { route: '/stylists', element: '', isAction: false, title: 'Compliance section', description: 'Open any stylist\'s profile and scroll to the Compliance section. You\'ll see their license, liability insurance, and contract documents — each with its expiry status.' },
      { route: '/stylists', element: '', isAction: false, title: 'Verify documents', description: 'Stylists upload their own documents from My Account. As an admin, click any uploaded document to verify it and set the official expiry date.' },
      { route: '/stylists', element: '', isAction: false, title: 'Expiry alerts', description: 'Senior Stylist automatically alerts you before a document expires so you\'re never caught out of compliance.' },
    ],
  },

  // 14
  'bookkeeper-billing-dashboard': {
    id: 'bookkeeper-billing-dashboard',
    title: 'Billing Dashboard',
    steps: [
      { route: '/dashboard', element: NAV_BILLING, isAction: true, title: 'Go to Billing', description: 'Tap Billing to open the AR dashboard.', actionHint: 'Tap Billing to continue.' },
      { route: '/billing', element: '[data-tour="billing-outstanding"]', isAction: false, title: 'Outstanding balance', description: 'This shows the total unpaid balance for this facility. Green means all caught up; amber means there are outstanding invoices.' },
      { route: '/billing', element: '', isAction: false, title: 'Invoice list', description: 'The main area shows all invoices or resident balances for this facility — amount, date, and payment status at a glance. Tap any row to expand the full detail.' },
      { route: '/billing', element: '[data-tour="billing-filters"]', isAction: false, title: 'Filters', description: 'Use the filters to show only unpaid invoices, or limit to a specific date range.' },
      { route: '/billing', element: '[data-tour="billing-send-statement"]', isAction: false, title: 'Send a statement', description: 'Tap "Send Statement" to email a PDF statement to the facility contact or POA.' },
      { route: '/billing', element: '', isAction: false, title: 'Facility switcher', description: 'If you manage multiple facilities, a facility switcher at the top of the page lets you view billing for each one individually.' },
    ],
  },

  // 15
  'bookkeeper-scan-logs': {
    id: 'bookkeeper-scan-logs',
    title: 'Scanning Daily Logs',
    steps: [
      { route: '/dashboard', element: NAV_DAILY_LOG, isAction: true, title: 'Go to Daily Log', description: 'Tap Daily Log to get started.', actionHint: 'Tap Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: 'What is OCR scanning', description: 'Senior Stylist can read handwritten or printed daily log sheets using AI. You upload the sheet and it fills in the entries automatically.' },
      { route: '/log', element: '[data-tour="daily-log-scan-sheet"]', isAction: true, title: 'Open the scan tool', description: 'Tap the Scan Sheet button to upload a log image or PDF.', actionHint: 'Tap "Scan log sheet" to continue.' },
      { route: '/log', element: '[data-tour="ocr-upload-area"]', isAction: false, title: 'Upload your log', description: 'Take a clear photo of the handwritten log sheet or upload a scanned PDF. The AI reads resident names, services, and prices automatically.' },
      { route: '/log', element: '', isAction: false, title: 'Review results', description: 'After scanning, each extracted entry appears in a table. Highlighted rows need your attention — check that the resident name and service match correctly.' },
      { route: '/log', element: '', isAction: false, title: 'Edit before importing', description: 'Tap any row to correct a misread name, service, or price. Changes are easy here — much harder to fix after you\'ve imported.' },
      { route: '/log', element: '', isAction: false, title: 'Import', description: 'When everything looks correct, tap Import to create the bookings. Review carefully first — this action cannot be undone.' },
    ],
  },

  // 16
  'bookkeeper-duplicates': {
    id: 'bookkeeper-duplicates',
    title: 'Duplicate Resolution',
    steps: [
      { route: '/residents', element: '', isAction: false, title: 'What are duplicates', description: 'Sometimes the same resident gets added twice with slightly different names or room numbers. The Duplicates tool finds and merges these.' },
      { route: '/residents', element: '[data-tour="residents-duplicates-button"]', isAction: true, title: 'Open duplicates', description: 'Tap the Duplicates button to see any potential duplicate residents.', actionHint: 'Tap "Duplicates" to continue.' },
      { route: '/residents', element: '', isAction: false, title: 'Duplicate pairs', description: 'Each card shows two residents that might be the same person. A confidence score tells you how likely they are to be the same person.' },
      { route: '/residents', element: '', isAction: false, title: 'Review carefully', description: 'Check names, room numbers, and booking counts. The resident on the right merges into the left — the right record is removed after merging.' },
      { route: '/residents', element: '', isAction: false, title: 'Merge', description: 'Tap Merge to combine the two records. All bookings and history from the merged resident transfer to the primary one. This cannot be undone.' },
      { route: '/residents', element: '', isAction: false, title: 'After merging', description: 'The merged resident\'s history is preserved. This cannot be undone, so always review the pair carefully first.' },
    ],
  },

  // 17
  'bookkeeper-payroll': {
    id: 'bookkeeper-payroll',
    title: 'Payroll & Pay Periods',
    steps: [
      { route: '/dashboard', element: NAV_PAYROLL, isAction: true, title: 'Go to Payroll', description: 'Tap Payroll to see pay periods.', actionHint: 'Tap Payroll to continue.' },
      { route: '/payroll', element: '[data-tour="payroll-period-list"]', isAction: false, title: 'Pay periods', description: 'Each row is a pay period. Open one to see a detailed breakdown of what each stylist earned.' },
      { route: '/payroll', element: '[data-tour="payroll-period-list"]', isAction: false, title: 'Open a period', description: 'Tap any pay period to open it.' },
      { route: '/payroll', element: '', isAction: false, title: 'Per-stylist breakdown', description: 'Tap any pay period to open it. Inside you\'ll see each stylist\'s earnings — base commission, tips, and any deductions applied.' },
      { route: '/payroll', element: '', isAction: false, title: 'Mark as paid', description: 'Once you\'ve processed payment, tap "Mark as Paid" to lock the period and record the payment date in your history.' },
      { route: '/payroll', element: '', isAction: false, title: 'Export', description: 'Use Export to download a CSV of the pay period for your records or to import into an external payroll system.' },
    ],
  },

  // 18
  'master-add-facility': {
    id: 'master-add-facility',
    title: 'Adding a Facility',
    desktopOnly: true,
    steps: [
      { route: '/dashboard', element: NAV_MASTER_ADMIN, isAction: true, title: 'Go to Master Admin', description: 'The Master Admin section is where you manage all facilities.', actionHint: 'Tap Master Admin to continue.' },
      { route: '/master-admin', element: '[data-tour="master-facility-list"]', isAction: false, title: 'Facility list', description: 'Every facility in the system is listed here with its status and code.' },
      { route: '/master-admin', element: '[data-tour="master-add-facility-btn"]', isAction: true, title: 'Add facility', description: 'Tap "Add Facility" to create a new one.', actionHint: 'Tap "Add Facility" to continue.' },
      { route: '/master-admin', element: '[data-tour="master-facility-form"]', isAction: false, title: 'Facility form', description: 'Fill in the facility name, address, and contact information. The facility code is auto-generated.' },
      { route: '/master-admin', element: '', isAction: false, title: 'After creating', description: 'After creating the facility, go to Settings to finish setup — working hours, payment type, and invite the admin.' },
    ],
  },

  // 19
  'master-quickbooks-setup': {
    id: 'master-quickbooks-setup',
    title: 'QuickBooks Setup',
    steps: [
      { route: '/dashboard', element: NAV_SETTINGS, isAction: true, title: 'Go to Settings → Billing', description: 'QuickBooks is set up per facility in Settings.', actionHint: 'Tap Settings to continue.' },
      { route: '/settings?section=billing', element: '[data-tour="settings-quickbooks"]', isAction: false, title: 'Billing section', description: 'Scroll to the QuickBooks section. This connects this facility\'s invoices and payroll to QuickBooks Online.' },
      { route: '/settings?section=billing', element: '[data-tour="settings-qb-connect-btn"]', isAction: false, title: 'Connect', description: 'Tap "Connect QuickBooks" to begin the OAuth login flow. You\'ll be taken to Intuit to authorize the connection.' },
      { route: '/settings?section=billing', element: '', isAction: false, title: 'After connecting', description: 'Once connected, payroll sync and invoice sync are available. You can trigger a sync manually or it runs automatically on a schedule.' },
    ],
  },
}

// ────────────────────────────────────────────────────────────────────────────
// ENGINE — runTour
// ────────────────────────────────────────────────────────────────────────────

const driverConfig = {
  animate: true,
  smoothScroll: true,
  allowClose: true,
  overlayClickBehavior: 'nextStep' as const,
  stagePadding: 8,
  stageRadius: 12,
  popoverClass: 'senior-stylist-tour',
  nextBtnText: 'Next →',
  prevBtnText: '← Back',
  doneBtnText: '✓ Done',
  showProgress: true,
  progressText: 'Step {{current}} of {{total}}',
}

let activeDriver: Driver | null = null
let activeListenerCleanup: (() => void) | null = null

function destroyActiveTour() {
  if (activeListenerCleanup) {
    activeListenerCleanup()
    activeListenerCleanup = null
  }
  if (activeDriver) {
    try {
      activeDriver.destroy()
    } catch {
      // best-effort
    }
    activeDriver = null
  }
}

/** Compare a step's stored route to the current path and, when the step includes
 *  query params, the current search string must also match exactly. This ensures
 *  settings section tours (e.g. route '/settings?section=team') hard-nav to the
 *  correct section rather than accepting any URL with pathname '/settings'. */
export function isOnRoute(stepRoute: string): boolean {
  if (typeof window === 'undefined') return false
  const [stepPath, stepSearch] = stepRoute.split('?')
  if (stepSearch) {
    const currentSearch = window.location.search.replace(/^\?/, '')
    return window.location.pathname === stepPath && currentSearch === stepSearch
  }
  return window.location.pathname === stepPath
}

/**
 * Public entry point — fires a tour by id. Resumes mid-tour if `resumeFromStep`
 * is provided (used by <TourResumer /> after hard-nav).
 *
 * Phase 12J: branches on `isMobile()` — mobile uses the spotlight + bottom sheet
 * renderer (`startMobileTour`), desktop uses Driver.js.
 */
export async function startTour(
  tourId: string,
  opts: { resumeFromStep?: number } = {},
): Promise<void> {
  if (typeof window === 'undefined') return
  const def = TOUR_DEFINITIONS[tourId]
  if (!def) {
    console.warn(`[help] No tour definition for "${tourId}"`)
    return
  }

  // Block desktop-only tours on mobile
  if (def.desktopOnly && isMobile()) {
    toastInfo('This tour is best viewed on a larger screen.')
    return
  }

  // Mobile branch — spotlight + bottom sheet renderer
  if (isMobile()) {
    const { startMobileTour } = await import('./mobile-tour')
    await startMobileTour(tourId, opts)
    return
  }

  // Tear down any existing tour
  destroyActiveTour()
  const startIndex = Math.max(0, opts.resumeFromStep ?? 0)
  await runStep(def, startIndex)
}

async function runStep(def: TourDefinition, index: number): Promise<void> {
  if (index >= def.steps.length) {
    destroyActiveTour()
    clearSessionState()
    return
  }
  const step = def.steps[index]
  const totalSteps = def.steps.length

  // Cross-route hop: persist state and hard-nav
  if (!isOnRoute(step.route)) {
    saveSessionState({
      tourId: def.id,
      stepIndex: index,
      expiresAt: Date.now() + SESSION_TTL_MS,
    })
    destroyActiveTour()
    window.location.href = step.route
    return // Page will reload; <TourResumer /> picks up.
  }

  // Same route — find the element (or no element for terminal info steps)
  let target: HTMLElement | null = null
  if (step.element) {
    target = await waitForElement(resolveQuery(step.element), ELEMENT_WAIT_MS)
    if (!target) {
      toastWarning('Couldn\'t find that element — the app may have changed.')
      // Skip to next step
      return runStep(def, index + 1)
    }
  }

  // Lazy-load Driver.js
  const { driver } = await import('driver.js')

  // Compose description (with action hint as a separate paragraph)
  const description = step.actionHint
    ? `${step.description}\n\n${step.actionHint}`
    : step.description

  // For action steps: hide the Next button so the user must click the highlighted element
  const showButtons = step.isAction
    ? (['previous', 'close'] as const)
    : (['previous', 'next', 'close'] as const)

  // (Re)create a single-step Driver instance that we control manually.
  // We do NOT pass all steps at once — this keeps each step's lifecycle isolated.
  destroyActiveTour()
  activeDriver = driver({
    ...driverConfig,
    progressText: `Step ${index + 1} of ${totalSteps}`,
    onCloseClick: () => {
      destroyActiveTour()
      clearSessionState()
    },
  })

  if (target) {
    activeDriver.highlight({
      element: target,
      popover: {
        title: step.title,
        description,
        showButtons: [...showButtons],
        // For info steps, advance via Next
        onNextClick: () => {
          destroyActiveTour()
          void runStep(def, index + 1)
        },
        onPrevClick: () => {
          if (index === 0) return
          destroyActiveTour()
          void runStep(def, index - 1)
        },
      },
    })

    // For action steps: attach a one-time click listener that auto-advances
    if (step.isAction) {
      const onClick = () => {
        target!.removeEventListener('click', onClick, true)
        activeListenerCleanup = null
        // Small delay so React handles the click first (e.g. modal opens / nav fires)
        setTimeout(() => {
          // If the click changed the route, save state for resume; otherwise advance in place.
          // runStep itself handles the cross-route case via isOnRoute().
          destroyActiveTour()
          void runStep(def, index + 1)
        }, 50)
      }
      target.addEventListener('click', onClick, true)
      activeListenerCleanup = () => target!.removeEventListener('click', onClick, true)
    }
  } else {
    // No element — render an info popover anchored to the body
    activeDriver.highlight({
      element: 'body',
      popover: {
        title: step.title,
        description,
        showButtons: ['previous', 'next', 'close'],
        onNextClick: () => {
          destroyActiveTour()
          void runStep(def, index + 1)
        },
        onPrevClick: () => {
          if (index === 0) return
          destroyActiveTour()
          void runStep(def, index - 1)
        },
      },
    })
  }
}

/**
 * Called by <TourResumer /> after hard-nav. Picks up the saved tour state
 * and resumes from the saved step index.
 *
 * Phase 12J: when `state.mobile === true`, route directly to `startMobileTour`
 * to keep the renderer sticky to the device the tour started on (avoids
 * flicker if breakpoint detection wobbles across reload).
 *
 * Phase 12J bug-fix: this is a ONE-SHOT — read, clear, then start. Without
 * the immediate clear, an abandoned tour (user navigates away, force-quits,
 * etc.) leaves state in sessionStorage and every subsequent layout mount
 * re-launches the tour at the saved step, causing an infinite reload loop
 * for tours that include cross-route hops. Cross-route hops save fresh state
 * inside their own engine, so resume still works.
 */
export async function resumePendingTour(): Promise<void> {
  const state = loadSessionState()
  if (!state) return
  // Defense in depth: loadSessionState already removes expired state, but
  // explicitly bail here too so a stale entry never reaches startTour.
  if (state.expiresAt < Date.now()) {
    clearSessionState()
    return
  }
  // One-shot: clear the saved state BEFORE starting. The tour run will re-save
  // for cross-route hops as needed.
  clearSessionState()
  if (state.mobile) {
    const { startMobileTour } = await import('./mobile-tour')
    await startMobileTour(state.tourId, { resumeFromStep: state.stepIndex })
    return
  }
  await startTour(state.tourId, { resumeFromStep: state.stepIndex })
}
