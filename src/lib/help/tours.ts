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
  | 'Network' | 'BookOpen' | 'CircleHelp' | 'ClipboardList'

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
  { id: 'stylist-signup-sheet', category: 'Scheduling', title: 'Sign-Up Sheet Queue', blurb: 'Pick up pending requests from facility staff and place them on your calendar.', estMinutes: 2, icon: 'ClipboardList', roles: ['stylist'], tourId: 'stylist-signup-sheet' },

  // FACILITY STAFF
  { id: 'staff-getting-started', category: 'Getting Started', title: 'Getting Started', blurb: 'A quick orientation to your calendar, residents, and daily log.', estMinutes: 2, icon: 'KeyRound', roles: ['facility_staff'], tourId: 'staff-getting-started' },
  { id: 'facility-staff-scheduling', category: 'Scheduling', title: 'Scheduling', blurb: 'Book appointments for residents from the calendar.', estMinutes: 3, icon: 'Calendar', roles: ['facility_staff'], tourId: 'facility-staff-scheduling' },
  { id: 'facility-staff-residents', category: 'Residents', title: 'Resident List', blurb: 'Find, add, and update resident profiles.', estMinutes: 3, icon: 'Users', roles: ['facility_staff'], tourId: 'facility-staff-residents' },
  { id: 'staff-daily-log-readonly', category: 'Daily Log', title: 'Daily Log (Read-Only)', blurb: 'See what was done today. View-only.', estMinutes: 2, icon: 'FileText', roles: ['facility_staff'], tourId: null },
  { id: 'staff-daily-log', category: 'Daily Log', title: 'The Daily Log', blurb: 'Understand what the daily log is and how to read it.', estMinutes: 2, icon: 'FileText', roles: ['facility_staff'], tourId: 'staff-daily-log' },
  { id: 'facility-staff-signup-sheet', category: 'Scheduling', title: 'Sign-Up Sheet', blurb: 'Quickly log residents who want appointments without picking a time.', estMinutes: 2, icon: 'ClipboardList', roles: ['facility_staff'], tourId: 'facility-staff-signup-sheet' },

  // ADMIN
  { id: 'admin-getting-started', category: 'Getting Started', title: 'Getting Started', blurb: 'Set up your facility, invite your team, and make your first booking.', estMinutes: 4, icon: 'KeyRound', roles: ['admin', 'super_admin'], tourId: 'admin-getting-started' },
  { id: 'admin-facility-setup', category: 'Facility', title: 'Facility Setup', blurb: 'Configure your facility\'s name, hours, time zone, and payment settings.', estMinutes: 3, icon: 'Building2', roles: ['admin', 'super_admin'], tourId: 'admin-facility-setup' },
  { id: 'admin-inviting-staff', category: 'Team', title: 'Inviting Staff', blurb: 'Send invite links to facility staff and bookkeepers.', estMinutes: 2, icon: 'Mail', roles: ['admin', 'super_admin'], tourId: 'admin-inviting-staff' },
  { id: 'admin-residents', category: 'Residents', title: 'Managing Residents', blurb: 'Add residents, set up family portal access, and track service history.', estMinutes: 3, icon: 'Users', roles: ['admin', 'super_admin'], tourId: 'admin-residents' },
  { id: 'admin-reports', category: 'Reports', title: 'Reports & Analytics', blurb: 'Track revenue, bookings, and stylist performance over time.', estMinutes: 2, icon: 'BarChart3', roles: ['admin', 'super_admin'], tourId: 'admin-reports' },
  { id: 'admin-family-portal', category: 'Family Portal', title: 'Family Portal', blurb: 'Give families a way to request bookings and pay bills online.', estMinutes: 3, icon: 'HeartHandshake', roles: ['admin', 'super_admin'], tourId: 'admin-family-portal' },
  { id: 'admin-compliance', category: 'Compliance', title: 'Compliance Docs', blurb: 'Monitor stylist license and insurance expiry for your facility.', estMinutes: 2, icon: 'ShieldCheck', roles: ['admin', 'super_admin'], tourId: 'admin-compliance' },

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
// TOUR DEFINITIONS — 25 fully implemented tours.
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
  'staff-getting-started': {
    id: 'staff-getting-started',
    title: 'Getting Started',
    steps: [
      { route: '/help', element: '', isAction: false, title: 'Welcome', description: 'Welcome to Senior Stylist! As facility staff, your main jobs are booking appointments for residents and keeping the resident list up to date.', mobileDescription: 'Quick orientation to your Calendar, Residents, and Daily Log.' },
      { route: '/help', element: NAV_CALENDAR, isAction: true, title: 'Your Calendar', description: 'The Calendar shows every stylist\'s schedule and all available time slots. You\'ll use it to book appointments for residents.', actionHint: 'Tap Calendar to take a look.' },
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'All stylists, all slots', description: 'You can see every stylist\'s availability here. Colored blocks are booked appointments. Empty areas are open slots.', mobileDescription: 'Empty slots are open for booking. Use the arrows to switch days.' },
      { route: '/dashboard', element: NAV_RESIDENTS, isAction: true, title: 'Residents', description: 'The Residents section is where you manage resident profiles — names, room numbers, and contact info.', actionHint: 'Tap Residents to continue.' },
      { route: '/residents', element: '[data-tour="residents-table"]', isAction: false, title: 'Resident list', description: 'Every resident at your facility is listed here. Tap any name to open their profile and make updates.', mobileDescription: 'Tap any resident\'s name to open their profile and make updates.' },
      { route: '/residents', element: NAV_DAILY_LOG, isAction: true, title: 'Daily Log', description: 'The Daily Log shows the services recorded each day by the stylists. You have read-only access — great for checking what was done.', actionHint: 'Tap Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: 'You\'re all set', description: 'That covers the basics! Use the Help section anytime to revisit these tours in more detail.' },
    ],
  },

  // 7
  'facility-staff-scheduling': {
    id: 'facility-staff-scheduling',
    title: 'Scheduling',
    steps: [
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'The Schedule', description: 'This is the facility calendar. Each column is a stylist and each row is a time slot. Colored blocks are existing bookings — empty areas are open.', mobileDescription: 'See every stylist and every time slot. Tap an empty area to book.' },
      { route: '/dashboard', element: '[data-tour="calendar-today-btn"]', isAction: false, title: 'Navigate dates', description: 'Use the arrows to move between days or weeks. Tap Today to jump back to the current date.' },
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'Finding an open slot', description: 'Look for an empty area in the column for the stylist you want. The time axis on the left shows the hour.', mobileDescription: 'Empty areas are open. Tap any empty area to book for a resident.' },
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'Create a booking', description: 'Tap any empty area on the calendar. A form will appear — search for the resident by name, choose the service and time, then tap Book Appointment.', mobileDescription: 'Search the resident, pick the service and time, then tap Book Appointment.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Editing a booking', description: 'To edit an existing booking, tap the colored block on the calendar. You can update the service, time, or notes. Admins can also cancel bookings from this view.' },
      { route: '/dashboard', element: '', isAction: false, title: 'When a resident calls', description: 'When a resident or their family calls to book an appointment, find an open slot on the calendar, tap it, search for the resident\'s name, and save. That\'s it.' },
    ],
  },

  // 8
  'facility-staff-residents': {
    id: 'facility-staff-residents',
    title: 'Resident List',
    steps: [
      { route: '/help', element: NAV_RESIDENTS, isAction: true, title: 'Go to Residents', description: 'Let\'s go to the Residents section.', actionHint: 'Tap Residents to continue.' },
      { route: '/residents', element: '[data-tour="residents-table"]', isAction: false, title: 'Resident list', description: 'Every resident at your facility is listed here. You can see their name, room number, and last service date.', mobileDescription: 'Every resident is listed here. Tap any name to open their profile.' },
      { route: '/residents', element: '[data-tour="residents-search"]', isAction: true, title: 'Find a resident', description: 'Type a name or room number to find someone quickly.', actionHint: 'Tap the search bar to continue.' },
      { route: '/residents', element: '', isAction: false, title: 'View a resident profile', description: 'Tap any resident\'s name to open their profile. You\'ll see their room number, POA contact, and booking history.' },
      { route: '/residents', element: '', isAction: false, title: 'Update resident info', description: 'Inside the profile, you can update room number, POA name, phone, and email. Tap Save when done.', mobileDescription: 'Update room number, POA name, phone, and email inside the profile.' },
      { route: '/residents', element: '[data-tour="residents-new-button"]', isAction: true, title: 'Add a new resident', description: 'Tap + to add a resident who isn\'t in the system yet.', actionHint: 'Tap + to continue.' },
      { route: '/residents', element: '[data-tour="residents-add-form"]', isAction: false, title: 'New resident form', description: 'Enter their name and room number. Add the POA contact info if you have it — they\'ll receive billing notices.', mobileDescription: 'Enter name and room number. Add POA contact info if you have it.' },
    ],
  },

  // 9
  'staff-daily-log': {
    id: 'staff-daily-log',
    title: 'The Daily Log',
    steps: [
      { route: '/help', element: NAV_DAILY_LOG, isAction: true, title: 'Daily Log', description: 'Let\'s take a look at the Daily Log.', actionHint: 'Tap Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: 'What is the Daily Log', description: 'The Daily Log shows every service performed at your facility each day, recorded by the stylists. You have read-only access — you can see everything but can\'t edit entries.' },
      { route: '/log', element: '', isAction: false, title: 'Reading the log', description: 'Each row is one appointment — the resident\'s name, the service provided, and the price. Entries are organized by date.', mobileDescription: 'Each row is one appointment — resident, service, and price. Read-only for you.' },
      { route: '/log', element: '', isAction: false, title: 'That\'s it', description: 'The Daily Log is reference only for facility staff. If you notice an error, let your admin know and they can make corrections.' },
    ],
  },

  // 9b — Sign-Up Sheet (facility staff)
  'facility-staff-signup-sheet': {
    id: 'facility-staff-signup-sheet',
    title: 'Sign-Up Sheet',
    steps: [
      { route: '/dashboard', element: '', isAction: false, title: 'What it is', description: 'The sign-up sheet is a quick intake queue. Log residents who want appointments without picking an exact time — the stylist takes care of scheduling.', mobileDescription: 'A quick intake queue — log residents, the stylist schedules.' },
      { route: '/dashboard', element: '[data-tour="signup-sheet-button"]', isAction: true, title: 'Open the sheet', description: 'Tap Sign-Up Sheet to open the panel.', actionHint: 'Tap Sign-Up Sheet to continue.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Add a resident', description: 'Type the resident\'s name. If they\'re not in the system, you can add them right here.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Pick a service', description: 'Choose the service they want from the list. New services need to be added by your admin first.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Submit', description: 'Tap Add to Sheet and you\'re done. The entry shows up in the queue below.' },
      { route: '/dashboard', element: '', isAction: false, title: 'What happens next', description: 'The stylist sees the entry on their calendar page. They\'ll schedule it for an actual time slot when they\'re ready.' },
    ],
  },

  // 9c — Sign-Up Sheet Queue (stylist side)
  'stylist-signup-sheet': {
    id: 'stylist-signup-sheet',
    title: 'Sign-Up Sheet Queue',
    steps: [
      { route: '/dashboard', element: '', isAction: false, title: 'Pending sign-ups', description: 'When facility staff add residents to the sign-up sheet, you\'ll see an amber panel above your calendar showing pending requests.', mobileDescription: 'Amber panel above your calendar shows pending requests.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Open the queue', description: 'Tap the panel to expand it. Each card shows the resident, service, and any preferred time.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Schedule one', description: 'Tap Schedule on a pending entry. The booking form opens pre-filled — you just pick the exact time and save.' },
      { route: '/dashboard', element: '', isAction: false, title: 'It\'s done', description: 'Once you save, the entry moves off the sign-up sheet and onto the calendar as a real booking.' },
    ],
  },

  // 10a
  'admin-getting-started': {
    id: 'admin-getting-started',
    title: 'Getting Started as a Facility Admin',
    steps: [
      { route: '/dashboard', element: '', isAction: false, title: 'Welcome, Facility Admin', description: 'As a Facility Admin you manage one facility — residents, bookings, billing, and your team. This tour walks you through the first things to set up.', mobileDescription: 'As a Facility Admin you manage one facility — residents, bookings, billing, and your team.' },
      { route: '/settings', element: '', isAction: false, title: 'Step 1: Facility Settings', description: 'Head to Settings to confirm your facility name, time zone, and working hours. These affect how bookings are displayed and when slots are available.', mobileDescription: 'Go to Settings to confirm your facility name, time zone, and working hours.' },
      { route: '/residents', element: '[data-tour="residents-new-button"]', isAction: false, title: 'Step 2: Add Residents', description: 'Add your residents from the Residents page. Each resident needs a name and room number. You can add family contact info later for portal access.', mobileDescription: 'Add residents from the Residents page. Each needs a name and room number.' },
      { route: '/dashboard', element: NAV_CALENDAR, isAction: false, title: 'Step 3: Your Calendar', description: 'The Calendar is your scheduling hub. Bookings are created here and assigned to stylists automatically based on their availability.', mobileDescription: 'The Calendar is your scheduling hub for all bookings.' },
      { route: '/log', element: NAV_DAILY_LOG, isAction: false, title: 'Step 4: The Daily Log', description: 'The Daily Log shows every appointment for the day. Use it to track completions, cancellations, and notes. It\'s also where bookkeepers scan checks.', mobileDescription: 'The Daily Log shows all appointments. Use it to track completions and notes.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Step 5: Invite Your Team', description: 'Go to Settings → Team to send invites to facility staff and bookkeepers. Stylists are managed by your Franchise Admin — reach out to them to add or reassign stylists.', mobileDescription: 'Invite facility staff and bookkeepers from Settings → Team. Stylists are managed by your Franchise Admin.' },
      { route: '/dashboard', element: '', isAction: false, title: 'You\'re ready', description: 'That\'s the core workflow. Explore the Help Center for deeper dives into billing, analytics, and the family portal whenever you\'re ready.', mobileDescription: 'Explore the Help Center for deeper dives into billing, analytics, and more.' },
    ],
  },

  // 10
  'admin-facility-setup': {
    id: 'admin-facility-setup',
    title: 'Facility Setup',
    steps: [
      { route: '/settings', element: '', isAction: false, title: 'Settings overview', description: 'Settings is where you configure everything about your facility — name, hours, billing, integrations, and notifications. It\'s split into sections on the left.', mobileDescription: 'Settings is where you configure your facility — name, hours, billing, and more.' },
      { route: '/settings', element: '[data-tour="settings-nav-general"]', isAction: false, title: 'General', description: 'The General section holds your facility name, address, phone, time zone, and working hours. Time zone is critical — it controls when calendar slots appear for residents.', mobileDescription: 'General holds your facility name, time zone, and working hours. Time zone controls calendar slots.' },
      { route: '/settings', element: '[data-tour="settings-nav-billing"]', isAction: false, title: 'Billing & Payments', description: 'Set up your payment type (RFMS or IP), Stripe keys for online payments, and revenue share percentage if applicable. Bookkeepers use these settings for reconciliation.', mobileDescription: 'Set up payment type, Stripe, and revenue share in Billing & Payments.' },
      { route: '/settings', element: '[data-tour="settings-nav-team"]', isAction: false, title: 'Team', description: 'Send invite links to facility staff and bookkeepers from the Team section. Note: stylists are managed by your Franchise Admin, not from here.', mobileDescription: 'Invite facility staff and bookkeepers from the Team section.' },
      { route: '/settings', element: '', isAction: false, title: 'Done', description: 'Once General and Billing are filled in, your facility is ready for bookings. Come back to Settings any time you need to update hours, payment info, or team members.', mobileDescription: 'Once General and Billing are set, your facility is ready for bookings.' },
    ],
  },

  // 9
  'admin-inviting-staff': {
    id: 'admin-inviting-staff',
    title: 'Inviting Staff',
    steps: [
      { route: '/settings', element: '', isAction: false, title: 'Who you can invite', description: 'As a Facility Admin you can invite Facility Staff and Bookkeepers. Facility staff handle scheduling and residents. Bookkeepers access billing, payroll, and analytics. Stylists are added by your Franchise Admin.', mobileDescription: 'Facility Admins can invite Facility Staff and Bookkeepers. Stylists are added by your Franchise Admin.' },
      { route: '/settings', element: '[data-tour="settings-nav-team"]', isAction: false, title: 'Open Team Settings', description: 'Go to Settings → Team. You\'ll see a list of everyone who has access to this facility and an Invite button at the top.', mobileDescription: 'Go to Settings → Team to see your team and invite new members.' },
      { route: '/settings', element: '', isAction: false, title: 'Send an invite', description: 'Enter the person\'s email and choose their role. They\'ll receive an email with a link to create their account. The invite expires after 7 days.', mobileDescription: 'Enter email and role. They\'ll get an email link that expires in 7 days.' },
      { route: '/settings', element: '', isAction: false, title: 'Managing access', description: 'You can revoke access from the Team list at any time. If someone needs a different role, revoke their current access and send a new invite.', mobileDescription: 'Revoke access from the Team list at any time. Re-invite to change roles.' },
    ],
  },

  // 10
  'admin-residents': {
    id: 'admin-residents',
    title: 'Managing Residents',
    steps: [
      { route: '/residents', element: '', isAction: false, title: 'Residents overview', description: 'The Residents page lists everyone at your facility. You can search by name, filter by room, and click any resident to see their booking history and contact info.', mobileDescription: 'Residents lists everyone at your facility. Search, filter, and tap to view history.' },
      { route: '/residents', element: '[data-tour="residents-new-button"]', isAction: false, title: 'Adding a resident', description: 'Click the + button to add a new resident. Name and room number are required. You can also add a POA (Power of Attorney) contact email for family portal access.', mobileDescription: 'Tap + to add a resident. Name and room number required. Add a POA email for portal access.' },
      { route: '/residents', element: '', isAction: false, title: 'Resident detail', description: 'Click any resident row to open their detail page. You\'ll see their full booking history, outstanding balance, service preferences, and tip defaults.', mobileDescription: 'Tap a resident to see their booking history, balance, and preferences.' },
      { route: '/residents', element: '', isAction: false, title: 'Family portal access', description: 'From the resident detail page, use the Family Portal card to send a magic-link invite to the POA email. They can log in to request bookings and pay their balance online.', mobileDescription: 'Send a portal invite from the resident detail page so family can book and pay online.' },
      { route: '/residents', element: '', isAction: false, title: 'Bulk import', description: 'If you have a list of residents in a spreadsheet, use the Import button to upload them all at once. Download the CSV template first to match the expected format.', mobileDescription: 'Use Import to upload residents from a spreadsheet. Download the template first.' },
    ],
  },

  // 11
  'admin-reports': {
    id: 'admin-reports',
    title: 'Reports & Analytics',
    steps: [
      { route: '/analytics', element: NAV_ANALYTICS, isAction: false, title: 'Analytics overview', description: 'The Analytics page shows revenue, appointment counts, and stylist performance for any date range you choose. It\'s your facility\'s financial snapshot.', mobileDescription: 'Analytics shows revenue and appointment counts for any date range.' },
      { route: '/analytics', element: '', isAction: false, title: 'Revenue & bookings', description: 'The top tiles show total revenue, appointment count, and average ticket for the selected period. Use the date picker to zoom in on a specific week or month.', mobileDescription: 'Top tiles show revenue, appointments, and average ticket. Use the date picker to filter.' },
      { route: '/analytics', element: '', isAction: false, title: 'Stylist breakdown', description: 'Scroll down to see per-stylist totals — bookings completed, revenue generated, and commission owed. This feeds into payroll calculations.', mobileDescription: 'Scroll down for per-stylist totals — bookings, revenue, and commission.' },
      { route: '/analytics', element: '', isAction: false, title: 'Exporting data', description: 'Use the Export button to download a CSV of the current view. This is useful for sharing with your Franchise Admin or importing into your own spreadsheets.', mobileDescription: 'Use Export to download a CSV of the current view.' },
    ],
  },

  // 12
  'admin-family-portal': {
    id: 'admin-family-portal',
    title: 'Family Portal',
    steps: [
      { route: '/residents', element: '', isAction: false, title: 'What the portal does', description: 'The Family Portal lets a resident\'s POA (Power of Attorney) contact log in to request bookings, view appointment history, see their balance, and pay online via Stripe.', mobileDescription: 'The Family Portal lets POA contacts request bookings, view history, and pay online.' },
      { route: '/residents', element: '', isAction: false, title: 'Step 1: Add a POA email', description: 'Open the resident\'s detail page and add a POA email address. This is the email the portal invite will be sent to. One POA account can manage multiple residents.', mobileDescription: 'Add a POA email on the resident detail page. One account can manage multiple residents.' },
      { route: '/residents', element: '', isAction: false, title: 'Step 2: Send the invite', description: 'From the resident detail page, find the Family Portal card and click Send Link. The POA receives a magic link that logs them in automatically — no password required on first use.', mobileDescription: 'Tap Send Link on the Family Portal card. POA gets a magic link to log in.' },
      { route: '/residents', element: '', isAction: false, title: 'Booking requests', description: 'When a POA requests a booking through the portal, it appears on your calendar with a "Requested" status. Review and confirm it to move it to Scheduled.', mobileDescription: 'Portal booking requests appear on your calendar with "Requested" status for you to confirm.' },
      { route: '/residents', element: '', isAction: false, title: 'Online payments', description: 'If Stripe is configured in Settings → Billing, the POA can pay their resident\'s balance online. Payments appear in your Billing view automatically.', mobileDescription: 'With Stripe set up, families can pay online. Payments show in Billing automatically.' },
    ],
  },

  // 13
  'admin-compliance': {
    id: 'admin-compliance',
    title: 'Compliance Documents',
    steps: [
      { route: '/dashboard', element: '', isAction: false, title: 'What compliance tracking covers', description: 'Senior Stylist tracks stylist licenses and insurance documents for your facility. You\'ll get email alerts at 60 and 30 days before anything expires.', mobileDescription: 'Senior Stylist tracks stylist licenses and insurance. You\'ll get email alerts before expiry.' },
      { route: '/stylists', element: '', isAction: false, title: 'Stylist compliance status', description: 'Go to the Stylists page to see each stylist\'s compliance badge — green (verified), amber (expiring soon), or red (expired or missing). Click any stylist to view their documents.', mobileDescription: 'Go to Stylists to see each stylist\'s badge — green, amber, or red. Tap to view documents.' },
      { route: '/stylists', element: '', isAction: false, title: 'Uploading documents', description: 'Stylists upload their own documents from My Account. Once uploaded, you can verify them from the stylist\'s detail page. Verification marks the document as compliant.', mobileDescription: 'Stylists upload from My Account. You verify from their detail page.' },
      { route: '/stylists', element: '', isAction: false, title: 'Expiry alerts', description: 'Alerts go to all facility admins at 60 and 30 days before expiry. If a document is not renewed, the badge turns red — a visual flag that compliance action is needed.', mobileDescription: 'Alerts at 60 and 30 days before expiry. Red badge means action is needed.' },
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
        ...(step.isAction ? { popoverClass: 'senior-stylist-tour action-step' } : {}),
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
