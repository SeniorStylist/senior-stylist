// Help Center: tutorial catalog + navigation-aware Driver.js tour engine.
//
// Phase 12H rewrite: tours iterate one step at a time, hard-nav across routes
// (with sessionStorage resume), wait for elements to appear, and auto-advance
// on user click for action steps. Driver.js is dynamic-imported on first use.

import type { Driver } from 'driver.js'
import { installTourFetchInterceptor } from './tour-fetch-interceptor'
import { setTourModeActive } from './tour-mode'
import { getTourRouter } from './tour-router'

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
  | 'Network' | 'BookOpen' | 'CircleHelp' | 'ClipboardList' | 'PenLine'
  | 'Clock' | 'Search' | 'PanelRight'

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
  /** Phase 12Y — viewport gate. Defaults to 'both' when omitted. */
  platform?: 'mobile' | 'desktop' | 'both'
  /** Phase 13 — scenario summary shown on help cards, e.g. "Book Mrs. Smith for a wash and set". */
  scenarioSummary?: string
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
  steps: TourStep[]
}

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

export const SESSION_KEY = 'helpTour'
export const SESSION_TTL_MS = 5 * 60 * 1000 // 5 minutes
export const ELEMENT_WAIT_MS = 5000
const DESKTOP_ELEMENT_WAIT_MS = 2000   // fast client-rendered elements
const SLOW_PAGE_WAIT_MS = 3000         // server-rendered pages with data fetching (Phase 12Y followups: 5000 → 3000)

function isSlowRoute(route: string): boolean {
  return (
    route.startsWith('/master-admin') ||
    route.startsWith('/stylists/directory') ||
    route.startsWith('/billing') ||
    route.startsWith('/analytics') ||
    route.startsWith('/payroll')
  )
}

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

/**
 * Phase 12P — MutationObserver-based element wait. Resolves the instant the
 * selector matches a visible element, or null after `timeoutMs`. Returns
 * immediately when the element is already in the DOM (no requestAnimationFrame
 * delay). Always disconnects the observer on resolve OR timeout.
 */
export function waitForElement(selector: string, timeoutMs: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLElement>(selector)
    if (existing && existing.offsetParent !== null) {
      resolve(existing)
      return
    }

    let settled = false
    const observer = new MutationObserver(() => {
      if (settled) return
      const el = document.querySelector<HTMLElement>(selector)
      if (el && el.offsetParent !== null) {
        settled = true
        clearTimeout(timer)
        observer.disconnect()
        resolve(el)
      }
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      observer.disconnect()
      resolve(null)
    }, timeoutMs)

    observer.observe(document.body, { childList: true, subtree: true })
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
  // Phase 12Y — Getting Started and Calendar are split into mobile/desktop pairs
  // because the calendar UI differs entirely (FullCalendar grid on desktop vs
  // today's-bookings list on mobile). The catalog filter hides the wrong-platform
  // variant. All other stylist tours share UI across platforms.
  { id: 'stylist-getting-started-mobile', category: 'Getting Started', title: 'Getting Started', blurb: 'A quick orientation: your daily appointment list, log, and My Account page.', estMinutes: 2, icon: 'KeyRound', roles: ['stylist'], tourId: 'stylist-getting-started-mobile', platform: 'mobile' },
  { id: 'stylist-getting-started-desktop', category: 'Getting Started', title: 'Getting Started', blurb: 'A quick orientation: your calendar, daily log, and My Account page.', estMinutes: 2, icon: 'KeyRound', roles: ['stylist'], tourId: 'stylist-getting-started-desktop', platform: 'desktop' },
  { id: 'stylist-calendar-mobile', category: 'Scheduling', title: 'Your Schedule', blurb: 'Read your daily list, tap appointments to mark them done, and book new ones.', estMinutes: 3, icon: 'Calendar', roles: ['stylist'], tourId: 'stylist-calendar-mobile', platform: 'mobile' },
  { id: 'stylist-calendar-desktop', category: 'Scheduling', title: 'Your Calendar', blurb: 'Read the weekly grid, click appointments to edit, and create new bookings.', estMinutes: 3, icon: 'Calendar', roles: ['stylist'], tourId: 'stylist-calendar-desktop', platform: 'desktop' },
  { id: 'stylist-daily-log', category: 'Daily Log', title: 'Daily Log', blurb: 'Record services, add walk-ins, and finalize your log at end of shift.', estMinutes: 3, icon: 'FileText', roles: ['stylist'], tourId: 'stylist-daily-log' },
  { id: 'stylist-checkin', category: 'Scheduling', title: "I'm Here Check-In", blurb: "Tap when you arrive. If you're running late, your schedule adjusts automatically.", estMinutes: 2, icon: 'Clock', roles: ['stylist'], tourId: 'stylist-checkin' },
  { id: 'stylist-residents', category: 'Residents', title: 'Managing Residents', blurb: 'Find, edit, and add residents at your facility.', estMinutes: 3, icon: 'Users', roles: ['stylist'], tourId: 'stylist-residents' },
  { id: 'stylist-finalize-day', category: 'Daily Log', title: 'Finalizing the Day', blurb: 'Step-by-step guide to reviewing and locking the daily log.', estMinutes: 2, icon: 'CheckCircle2', roles: ['stylist'], tourId: 'stylist-finalize-day' },
  { id: 'stylist-my-account', category: 'Account', title: 'My Account', blurb: 'Manage your schedule, upload compliance documents, and request time off.', estMinutes: 3, icon: 'UserCog', roles: ['stylist'], tourId: 'stylist-my-account' },
  { id: 'stylist-signup-sheet', category: 'Scheduling', title: 'Sign-Up Sheet Queue', blurb: 'Pick up auto-assigned requests, pick a time, or drag them onto the calendar.', estMinutes: 2, icon: 'ClipboardList', roles: ['stylist'], tourId: 'stylist-signup-sheet' },

  // FACILITY STAFF
  { id: 'staff-getting-started', category: 'Getting Started', title: 'Getting Started', blurb: 'A quick orientation to your calendar, residents, and daily log.', estMinutes: 2, icon: 'KeyRound', roles: ['facility_staff'], tourId: 'staff-getting-started' },
  { id: 'facility-staff-scheduling', category: 'Scheduling', title: 'Scheduling', blurb: 'Book appointments for residents from the calendar.', estMinutes: 3, icon: 'Calendar', roles: ['facility_staff'], tourId: 'facility-staff-scheduling' },
  { id: 'facility-staff-residents', category: 'Residents', title: 'Resident List', blurb: 'Find, add, and update resident profiles.', estMinutes: 3, icon: 'Users', roles: ['facility_staff'], tourId: 'facility-staff-residents' },
  { id: 'staff-daily-log-readonly', category: 'Daily Log', title: 'Daily Log (Read-Only)', blurb: 'See what was done today. View-only.', estMinutes: 2, icon: 'FileText', roles: ['facility_staff'], tourId: null },
  { id: 'staff-daily-log', category: 'Daily Log', title: 'The Daily Log', blurb: 'Understand what the daily log is and how to read it.', estMinutes: 2, icon: 'FileText', roles: ['facility_staff'], tourId: 'staff-daily-log' },
  { id: 'facility-staff-signup-sheet', category: 'Scheduling', title: 'Sign-Up Sheet', blurb: 'Log resident requests — the right stylist gets auto-assigned based on the preferred date.', estMinutes: 2, icon: 'ClipboardList', roles: ['facility_staff'], tourId: 'facility-staff-signup-sheet' },

  // ADMIN
  { id: 'admin-getting-started', category: 'Getting Started', title: 'Getting Started', blurb: 'Set up your facility, invite your team, and make your first booking.', estMinutes: 4, icon: 'KeyRound', roles: ['admin', 'super_admin'], tourId: 'admin-getting-started' },
  { id: 'admin-facility-setup', category: 'Facility', title: 'Facility Setup', blurb: 'Configure your facility\'s name, hours, time zone, and payment settings.', estMinutes: 3, icon: 'Building2', roles: ['admin', 'super_admin'], tourId: 'admin-facility-setup' },
  { id: 'admin-inviting-staff', category: 'Team', title: 'Inviting Staff', blurb: 'Send invite links to facility staff and bookkeepers.', estMinutes: 2, icon: 'Mail', roles: ['admin', 'super_admin'], tourId: 'admin-inviting-staff' },
  { id: 'admin-residents', category: 'Residents', title: 'Managing Residents', blurb: 'Add residents, set up family portal access, and track service history.', estMinutes: 3, icon: 'Users', roles: ['admin', 'super_admin'], tourId: 'admin-residents' },
  { id: 'admin-reports', category: 'Reports', title: 'Reports & Analytics', blurb: 'Track revenue, bookings, and stylist performance over time.', estMinutes: 2, icon: 'BarChart3', roles: ['admin', 'super_admin'], tourId: 'admin-reports', platform: 'desktop' },
  { id: 'admin-family-portal', category: 'Family Portal', title: 'Family Portal', blurb: 'Give families a way to request bookings and pay bills online.', estMinutes: 3, icon: 'HeartHandshake', roles: ['admin', 'super_admin'], tourId: 'admin-family-portal' },
  { id: 'admin-compliance', category: 'Compliance', title: 'Compliance Docs', blurb: 'Monitor stylist license and insurance expiry for your facility.', estMinutes: 2, icon: 'ShieldCheck', roles: ['admin', 'super_admin'], tourId: 'admin-compliance', platform: 'desktop' },
  { id: 'admin-command-palette', category: 'Navigation', title: 'Command Palette', blurb: 'Press CMD+K to instantly search residents, stylists, and pages.', estMinutes: 1, icon: 'Search', roles: ['admin', 'super_admin', 'bookkeeper'], tourId: 'admin-command-palette', platform: 'desktop' },
  { id: 'admin-peek-drawer', category: 'Navigation', title: 'Quick Profile Peek', blurb: 'Click any resident or stylist name to see their profile without leaving the page.', estMinutes: 1, icon: 'PanelRight', roles: ['admin', 'super_admin', 'bookkeeper'], tourId: 'admin-peek-drawer' },

  // BOOKKEEPER
  { id: 'bookkeeper-getting-started', category: 'Getting Started', title: 'Getting Started', blurb: 'Overview of the Daily Log, Billing, and Payroll — your three main areas.', estMinutes: 3, icon: 'KeyRound', roles: ['bookkeeper'], tourId: 'bookkeeper-getting-started', platform: 'desktop' },
  { id: 'bookkeeper-scan-logs', category: 'Daily Log', title: 'Scanning Daily Logs', blurb: 'Scan paper log sheets with OCR, review extracted entries, and import.', estMinutes: 5, icon: 'ScanLine', roles: ['bookkeeper'], tourId: 'bookkeeper-scan-logs' },
  { id: 'bookkeeper-manual-entry', category: 'Daily Log', title: 'Manual Entry', blurb: 'Enter paper log sheet services manually when scanning isn\'t an option.', estMinutes: 4, icon: 'PenLine', roles: ['bookkeeper'], tourId: 'bookkeeper-manual-entry' },
  { id: 'bookkeeper-duplicates', category: 'Residents', title: 'Duplicate Resolution', blurb: 'Find and merge duplicate residents created by scanning errors.', estMinutes: 3, icon: 'GitMerge', roles: ['bookkeeper'], tourId: 'bookkeeper-duplicates' },
  { id: 'bookkeeper-billing-dashboard', category: 'Billing', title: 'Billing Dashboard', blurb: 'Review outstanding balances, filter invoices, and send monthly statements.', estMinutes: 4, icon: 'CreditCard', roles: ['bookkeeper'], tourId: 'bookkeeper-billing-dashboard', platform: 'desktop' },
  { id: 'bookkeeper-payroll', category: 'Payroll', title: 'Payroll & Pay Periods', blurb: 'Review pay periods, check stylist earnings, and mark periods as paid.', estMinutes: 3, icon: 'Wallet', roles: ['bookkeeper'], tourId: 'bookkeeper-payroll', platform: 'desktop' },
  { id: 'bookkeeper-export-logs', category: 'Reports', title: 'Export Daily Logs to Excel', blurb: 'Download a styled spreadsheet matching your accounting format.', estMinutes: 1, icon: 'FileSpreadsheet', roles: ['bookkeeper', 'admin', 'super_admin'], tourId: 'bookkeeper-export-logs' },
  { id: 'bookkeeper-quickbooks', category: 'Billing', title: 'QuickBooks Data', blurb: 'Import QB data and read balances.', estMinutes: 4, icon: 'Database', roles: ['bookkeeper'], tourId: null },
  { id: 'bookkeeper-financial-reports', category: 'Reports', title: 'Financial Reports', blurb: 'Run and export reports for accounting.', estMinutes: 3, icon: 'FileSpreadsheet', roles: ['bookkeeper'], tourId: null },

  // MASTER ADMIN (master-only)
  { id: 'master-getting-started', category: 'Getting Started', title: 'Getting Started', blurb: 'Overview of Master Admin — facilities, stylists, analytics, and platform tools.', estMinutes: 3, icon: 'KeyRound', roles: ['admin', 'super_admin'], tourId: 'master-getting-started', masterOnly: true, platform: 'desktop' },
  { id: 'master-add-facility', category: 'Facilities', title: 'Adding a Facility', blurb: 'Create a new facility, configure it, and assign stylists.', estMinutes: 3, icon: 'PlusSquare', roles: ['admin', 'super_admin'], tourId: 'master-add-facility', masterOnly: true, platform: 'desktop' },
  { id: 'master-stylist-directory', category: 'Stylists', title: 'Stylist Directory', blurb: 'Manage stylist status, facility assignments, and the franchise pool.', estMinutes: 4, icon: 'Users', roles: ['admin', 'super_admin'], tourId: 'master-stylist-directory', masterOnly: true, platform: 'desktop' },
  { id: 'master-applicant-pipeline', category: 'Stylists', title: 'Applicant Pipeline', blurb: 'Import Indeed applicants, review them, and promote the best ones to active stylists.', estMinutes: 4, icon: 'UserPlus', roles: ['admin', 'super_admin'], tourId: 'master-applicant-pipeline', masterOnly: true, platform: 'desktop' },
  { id: 'master-quickbooks-setup', category: 'Billing', title: 'QuickBooks Setup', blurb: 'Connect each facility\'s QuickBooks account and understand what syncs.', estMinutes: 3, icon: 'Database', roles: ['admin', 'super_admin'], tourId: 'master-quickbooks-setup', masterOnly: true, platform: 'desktop' },
  { id: 'master-analytics', category: 'Analytics', title: 'Cross-Facility Analytics', blurb: 'View revenue, stylist performance, and trends across all your facilities.', estMinutes: 3, icon: 'BarChart3', roles: ['admin', 'super_admin'], tourId: 'master-analytics', masterOnly: true, platform: 'desktop' },
  { id: 'master-franchise', category: 'Franchise', title: 'Franchise Management', blurb: 'Manage franchises and super admin assignments.', estMinutes: 4, icon: 'Network', roles: ['admin', 'super_admin'], tourId: null, masterOnly: true },
  { id: 'master-cross-facility-analytics', category: 'Reports', title: 'Cross-Facility Analytics', blurb: 'View revenue and KPIs across facilities.', estMinutes: 3, icon: 'BarChart3', roles: ['admin', 'super_admin'], tourId: null, masterOnly: true },
  { id: 'master-merge-duplicates', category: 'Residents', title: 'Merging Duplicates', blurb: 'Merge duplicate facilities and residents.', estMinutes: 4, icon: 'GitMerge', roles: ['admin', 'super_admin'], tourId: null, masterOnly: true },
  { id: 'master-team-roster', category: 'Team', title: 'Global Team Roster', blurb: 'See every user across every facility.', estMinutes: 3, icon: 'Users', roles: ['admin', 'super_admin'], tourId: null, masterOnly: true },
]

// ────────────────────────────────────────────────────────────────────────────
// ONBOARDING CHECKLIST — role-specific first-run tour sequence shown on /dashboard
// super_admin maps to admin; master admin and unlisted roles skip the checklist
// ────────────────────────────────────────────────────────────────────────────

export const ONBOARDING_CHECKLIST: Record<string, { tourId: string; label: string }[]> = {
  stylist: [
    { tourId: 'stylist-getting-started', label: 'Learn the basics' },
    { tourId: 'stylist-calendar', label: 'Understand your calendar' },
    { tourId: 'stylist-daily-log', label: 'Complete your first daily log' },
    { tourId: 'stylist-checkin', label: "Try the I'm Here check-in" },
    { tourId: 'stylist-my-account', label: 'Set up your account' },
  ],
  facility_staff: [
    { tourId: 'staff-getting-started', label: 'Learn the basics' },
    { tourId: 'facility-staff-signup-sheet', label: 'Log your first sign-up' },
    { tourId: 'facility-staff-scheduling', label: 'Book your first appointment' },
    { tourId: 'facility-staff-residents', label: 'Manage residents' },
  ],
  admin: [
    { tourId: 'admin-getting-started', label: 'Learn the basics' },
    { tourId: 'admin-facility-setup', label: 'Configure your facility' },
    { tourId: 'admin-inviting-staff', label: 'Invite your team' },
    { tourId: 'admin-residents', label: 'Add your first residents' },
  ],
  bookkeeper: [
    { tourId: 'bookkeeper-getting-started', label: 'Learn the basics' },
    { tourId: 'bookkeeper-scan-logs', label: 'Scan your first log sheet' },
    { tourId: 'bookkeeper-billing-dashboard', label: 'Review the billing dashboard' },
  ],
}

// ────────────────────────────────────────────────────────────────────────────
// TOUR DEFINITIONS — 31 fully implemented tours.
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
  // Phase 12Y — Stylist Getting Started: mobile + desktop variants. The mobile
  // version targets the today's-bookings list; the desktop version targets the
  // FullCalendar grid. Both share the same Daily Log + My Account flow.
  'stylist-getting-started-mobile': {
    id: 'stylist-getting-started-mobile',
    title: 'Getting Started',
    steps: [
      { route: '/help', element: '', isAction: false, title: 'Welcome', description: 'A quick tour of your daily list, Daily Log, and My Account.' },
      { route: '/help', element: NAV_CALENDAR, isAction: true, title: 'Open your schedule', description: 'The Calendar tab shows today\'s appointments.', actionHint: 'Tap Calendar to continue.' },
      { route: '/dashboard', element: '[data-tour="stylist-mobile-booking-list"]', isAction: false, title: "Today's appointments", description: 'Your bookings for today. Each card shows the time, resident, and service.' },
      { route: '/dashboard', element: NAV_DAILY_LOG, isAction: true, title: 'Open the Daily Log', description: 'Record and finalize your work here at the end of each day.', actionHint: 'Tap Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: 'Daily Log', description: 'Each row is an appointment. Review them at day\'s end and tap Finalize Day.' },
      { route: '/log', element: NAV_MY_ACCOUNT, isAction: true, title: 'Open My Account', description: 'Manage your schedule, upload documents, and request time off here.', actionHint: 'Tap My Account to continue.' },
      { route: '/my-account', element: '', isAction: false, title: "You're ready", description: 'That\'s the overview. Revisit any tour from the Help section anytime.' },
    ],
  },
  'stylist-getting-started-desktop': {
    id: 'stylist-getting-started-desktop',
    title: 'Getting Started',
    steps: [
      { route: '/help', element: '', isAction: false, title: 'Welcome', description: 'The three things you\'ll use every day: Calendar, Daily Log, and My Account.' },
      { route: '/help', element: NAV_CALENDAR, isAction: true, title: 'Open your Calendar', description: 'Your home base for seeing your schedule and managing appointments.', actionHint: 'Click Calendar to continue.' },
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'Your weekly grid', description: 'Your week at a glance. Each colored block is a booked appointment.' },
      { route: '/dashboard', element: NAV_DAILY_LOG, isAction: true, title: 'Open the Daily Log', description: 'Record and finalize your work here at the end of each day.', actionHint: 'Click Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: 'Daily Log', description: 'Each row is an appointment. Review them at day\'s end and click Finalize Day.' },
      { route: '/log', element: NAV_MY_ACCOUNT, isAction: true, title: 'Open My Account', description: 'Manage your schedule, upload documents, and request time off here.', actionHint: 'Click My Account to continue.' },
      { route: '/my-account', element: '', isAction: false, title: "You're ready", description: 'That\'s the overview. Revisit any tour from the Help section anytime.' },
    ],
  },

  // Phase 12Y — Stylist Calendar: mobile + desktop variants. Mobile = list of
  // today's bookings; desktop = FullCalendar grid + toolbar.
  'stylist-calendar-mobile': {
    id: 'stylist-calendar-mobile',
    title: 'Your Schedule',
    steps: [
      { route: '/dashboard', element: '[data-tour="stylist-mobile-booking-list"]', isAction: false, title: "Today's appointments", description: 'Your schedule for today, sorted by time.' },
      { route: '/dashboard', element: '[data-tour="stylist-mobile-booking-card"]', isAction: false, title: 'Each card', description: 'Shows the time, resident, and service. Tap the green check to mark it done.' },
      { route: '/dashboard', element: '', isAction: false, title: 'New bookings', description: 'Tap the burgundy + button at the bottom-right to pick a resident, service, and time.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Walk-ins', description: 'For a resident who arrives without a booking, use Add Walk-in in the Daily Log.' },
    ],
  },
  'stylist-calendar-desktop': {
    id: 'stylist-calendar-desktop',
    title: 'Your Calendar',
    steps: [
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'Your calendar', description: 'The weekly view. Use the toolbar arrows to switch weeks.' },
      { route: '/dashboard', element: '[data-tour="calendar-today-btn"]', isAction: false, title: 'Today button', description: 'Jump back to the current date anytime.' },
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'Existing appointments', description: 'Each colored block is a booking. Click one to change the service, time, or notes.' },
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'Create a booking', description: 'Click any empty area to pick the resident, service, date, and time, then save.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Walk-ins', description: 'A resident arrives without a booking? Add a walk-in from the Daily Log.' },
    ],
  },

  // 3
  'stylist-daily-log': {
    id: 'stylist-daily-log',
    title: 'Daily Log',
    steps: [
      { route: '/dashboard', element: NAV_DAILY_LOG, isAction: true, title: 'Open the Daily Log', description: 'Head to your Daily Log.', actionHint: 'Tap Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: 'What the Daily Log is', description: "Today's appointments from your calendar. Review and finalize them at the end of your shift." },
      { route: '/log', element: '', isAction: false, title: 'Each entry', description: 'Each row shows the resident, service, and price. Tap a row to edit the price or add a note.' },
      { route: '/log', element: '[data-tour="daily-log-add-walkin"]', isAction: true, title: 'Add a walk-in', description: 'Log a resident who arrived without a booking.', actionHint: 'Tap Add Walk-in — nothing is saved for real.' },
      { route: '/log', element: '', isAction: false, title: 'Walk-in form', description: 'Search the resident by name, add them if new, then choose the service and price.' },
      { route: '/log', element: '[data-tour="daily-log-finalize-button"]', isAction: true, title: 'Finalize the day', description: 'Locks your log and submits it to your admin. Double-check first — you can\'t edit after.', mobileDescription: 'Locks and submits your log. Double-check first — you can\'t edit after.', actionHint: 'Tap Finalize Day — this is a demo, your real log is safe.' },
      { route: '/log', element: '', isAction: false, title: 'After finalizing', description: 'Your admin sees the completed log. Need a fix? Ask your admin to make corrections.' },
    ],
  },

  // 4
  'stylist-residents': {
    id: 'stylist-residents',
    title: 'Managing Residents',
    steps: [
      { route: '/residents', element: '[data-tour="residents-table"]', isAction: false, title: 'Resident list', description: 'Every resident who receives services at your facility.' },
      { route: '/residents', element: '[data-tour="residents-search"]', isAction: true, title: 'Search', description: 'Find a resident by name or room number.', actionHint: 'Tap the search bar to continue.' },
      { route: '/residents', element: '[data-tour="residents-table"]', isAction: false, title: 'Resident profile', description: 'Tap any name to see their room, POA contact, and full booking history.' },
      { route: '/residents', element: '[data-tour="residents-new-button"]', isAction: true, title: 'Add a resident', description: 'Add someone not yet in the list.', actionHint: 'Tap + to continue.' },
      { route: '/residents', element: '[data-tour="residents-add-form"]', isAction: false, title: 'New resident form', description: 'Enter name and room number. POA info is optional but helps billing and portal access.' },
    ],
  },

  // 5
  'stylist-finalize-day': {
    id: 'stylist-finalize-day',
    title: 'Finalizing the Day',
    steps: [
      { route: '/dashboard', element: NAV_DAILY_LOG, isAction: true, title: 'Open the Daily Log', description: 'Walk through finalizing your day.', actionHint: 'Tap Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: 'Check entries', description: 'Confirm every entry has the right service and price. Tap a row to fix it.' },
      { route: '/log', element: '[data-tour="daily-log-add-walkin"]', isAction: false, title: 'Check for walk-ins', description: 'Anyone who came in without a booking must be added before you finalize.', mobileDescription: 'Add all walk-ins before finalizing.' },
      { route: '/log', element: '[data-tour="daily-log-finalize-button"]', isAction: true, title: 'Finalize the day', description: 'Locks and submits the log when everything looks right.', actionHint: 'Tap Finalize Day — this is a demo, your real log is safe.' },
      { route: '/log', element: '', isAction: false, title: 'Log submitted', description: 'Entries are locked. Need a correction? Reach out to your admin.' },
    ],
  },

  // 5b
  'stylist-my-account': {
    id: 'stylist-my-account',
    title: 'My Account',
    steps: [
      { route: '/dashboard', element: NAV_MY_ACCOUNT, isAction: true, title: 'Open My Account', description: 'Manage your personal info, schedule, and documents here.', actionHint: 'Tap My Account to continue.' },
      { route: '/my-account', element: '[data-tour="my-account-schedule"]', isAction: false, title: 'Your schedule', description: 'The days and hours you work at each facility. Admins use this to assign you bookings.' },
      { route: '/my-account', element: '', isAction: false, title: 'Edit your hours', description: 'Tap Edit hours next to a day to change your start and end time. Changes apply right away.', mobileDescription: 'Tap Edit hours next to a day to change your start and end time. Changes apply right away.' },
      { route: '/my-account', element: '[data-tour="my-account-compliance"]', isAction: false, title: 'Compliance documents', description: 'Upload your license, insurance, W-9, and any other required paperwork here.' },
      { route: '/my-account', element: '[data-tour="my-account-compliance-upload"]', isAction: false, title: 'Upload a document', description: 'Tap Upload, choose the type, and your admin is notified to verify it.' },
      { route: '/my-account', element: '[data-tour="my-account-timeoff"]', isAction: false, title: 'Time off requests', description: 'Submit a request here. Your admin is notified and can arrange coverage.' },
      { route: '/my-account', element: '', isAction: false, title: 'Keep documents current', description: 'You\'ll get an alert before anything expires, so you\'re never caught off guard.' },
    ],
  },

  // 6
  'staff-getting-started': {
    id: 'staff-getting-started',
    title: 'Getting Started',
    steps: [
      { route: '/help', element: '', isAction: false, title: 'Welcome', description: 'As facility staff, you book appointments for residents and keep the resident list current.', mobileDescription: 'A quick tour of your Calendar, Residents, and Daily Log.' },
      { route: '/help', element: NAV_CALENDAR, isAction: true, title: 'Open your Calendar', description: 'Shows every stylist\'s schedule and open time slots for booking.', actionHint: 'Tap Calendar to continue.' },
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'All stylists, all slots', description: 'Colored blocks are booked; empty areas are open slots.', mobileDescription: 'Empty slots are open for booking. Use the arrows to switch days.' },
      { route: '/dashboard', element: NAV_RESIDENTS, isAction: true, title: 'Open Residents', description: 'Manage resident profiles — names, room numbers, and contact info.', actionHint: 'Tap Residents to continue.' },
      { route: '/residents', element: '[data-tour="residents-table"]', isAction: false, title: 'Resident list', description: 'Every resident at your facility. Tap any name to open their profile.', mobileDescription: 'Tap any resident\'s name to open their profile and make updates.' },
      { route: '/residents', element: NAV_DAILY_LOG, isAction: true, title: 'Open the Daily Log', description: 'A read-only view of the services stylists recorded each day.', actionHint: 'Tap Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: "You're all set", description: 'That covers the basics. Revisit any tour from the Help section anytime.' },
    ],
  },

  // 7
  'facility-staff-scheduling': {
    id: 'facility-staff-scheduling',
    title: 'Scheduling',
    steps: [
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'The schedule', description: 'Each column is a stylist, each row a time slot. Colored blocks are bookings; empty areas are open.', mobileDescription: 'See every stylist and every time slot. Tap an empty area to book.' },
      { route: '/dashboard', element: '[data-tour="calendar-today-btn"]', isAction: false, title: 'Navigate dates', description: 'Use the arrows to move between days. Tap Today to jump back to now.' },
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'Find an open slot', description: 'Look for an empty area in the stylist\'s column. The left axis shows the hour.', mobileDescription: 'Empty areas are open. Tap one to book for a resident.' },
      { route: '/dashboard', element: '[data-tour="calendar-time-grid"]', isAction: false, title: 'Create a booking', description: 'Tap an empty area, search the resident, pick the service and time, then Book Appointment.', mobileDescription: 'Search the resident, pick the service and time, then tap Book Appointment.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Edit a booking', description: 'Tap a colored block to update its service, time, or notes. Admins can also cancel here.' },
      { route: '/dashboard', element: '', isAction: false, title: 'When a resident calls', description: 'Find an open slot, tap it, search the resident\'s name, and save. That\'s it.' },
    ],
  },

  // 8
  'facility-staff-residents': {
    id: 'facility-staff-residents',
    title: 'Resident List',
    steps: [
      { route: '/help', element: NAV_RESIDENTS, isAction: true, title: 'Open Residents', description: 'Head to the Residents section.', actionHint: 'Tap Residents to continue.' },
      { route: '/residents', element: '[data-tour="residents-table"]', isAction: false, title: 'Resident list', description: 'Every resident, with name, room number, and last service date.', mobileDescription: 'Every resident is listed here. Tap any name to open their profile.' },
      { route: '/residents', element: '[data-tour="residents-search"]', isAction: true, title: 'Find a resident', description: 'Search by name or room number.', actionHint: 'Tap the search bar to continue.' },
      { route: '/residents', element: '', isAction: false, title: 'View a profile', description: 'Tap any name to see their room, POA contact, and booking history.' },
      { route: '/residents', element: '', isAction: false, title: 'Update resident info', description: 'Edit room number, POA name, phone, and email in the profile, then save.', mobileDescription: 'Update room number, POA name, phone, and email inside the profile.' },
      { route: '/residents', element: '[data-tour="residents-new-button"]', isAction: true, title: 'Add a resident', description: 'Add someone not yet in the system.', actionHint: 'Tap + to continue.' },
      { route: '/residents', element: '[data-tour="residents-add-form"]', isAction: false, title: 'New resident form', description: 'Enter name and room number. Add POA contact info if you have it — they get billing notices.', mobileDescription: 'Enter name and room number. Add POA contact info if you have it.' },
    ],
  },

  // 9
  'staff-daily-log': {
    id: 'staff-daily-log',
    title: 'The Daily Log',
    steps: [
      { route: '/help', element: NAV_DAILY_LOG, isAction: true, title: 'Open the Daily Log', description: 'Take a look at the Daily Log.', actionHint: 'Tap Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: 'What the Daily Log is', description: 'Every service performed each day, recorded by stylists. Read-only for you.' },
      { route: '/log', element: '', isAction: false, title: 'Reading the log', description: 'Each row is one appointment — resident, service, and price — organized by date.', mobileDescription: 'Each row is one appointment — resident, service, and price. Read-only for you.' },
      { route: '/log', element: '', isAction: false, title: "That's it", description: 'Reference only for facility staff. Spot an error? Let your admin make corrections.' },
    ],
  },

  // 9b — Sign-Up Sheet (facility staff)
  'facility-staff-signup-sheet': {
    id: 'facility-staff-signup-sheet',
    title: 'Sign-Up Sheet',
    steps: [
      { route: '/dashboard', element: '', isAction: false, title: 'Where it lives', description: 'On your dashboard. A resident calls for an appointment? Log the request — no need to pick a time slot.', mobileDescription: 'The sign-up sheet lives on your dashboard.' },
      { route: '/dashboard', element: '[data-tour="signup-sheet-button"]', isAction: true, title: 'Open the sheet', description: 'Opens the sign-up panel.', actionHint: 'Tap Sign-Up Sheet to continue.' },
      { route: '/dashboard', element: '[data-tour="signup-sheet-form"]', isAction: false, title: 'Add resident and service', description: 'Pick the resident and the service they want. Add a new resident right from this form.', mobileDescription: 'Pick the resident and the service they want.' },
      { route: '/dashboard', element: '[data-tour="signup-sheet-preferred-date"]', isAction: false, title: 'Preferred date', description: 'Add a preferred date — it auto-assigns the right stylist based on who works that day.', mobileDescription: 'Add a preferred date — it helps auto-assign the right stylist.' },
      { route: '/dashboard', element: '[data-tour="signup-sheet-notes"]', isAction: false, title: 'Notes for the stylist', description: 'Add anything useful — "prefers morning", "needs extra time", "wheelchair access".', mobileDescription: 'Add notes the stylist should know.' },
      { route: '/dashboard', element: '[data-tour="signup-sheet-submit"]', isAction: true, title: 'Add to the queue', description: 'Auto-assigns the right stylist, who picks it up at login.', actionHint: 'Tap Add to Sheet to continue.' },
      { route: '/dashboard', element: '', isAction: false, title: 'What happens next', description: 'The stylist sees a badge on their Calendar, schedules a time, and it leaves this queue.' },
    ],
  },

  // 9c — Sign-Up Sheet Queue (stylist side)
  'stylist-signup-sheet': {
    id: 'stylist-signup-sheet',
    title: 'Sign-Up Sheet Queue',
    steps: [
      { route: '/dashboard', element: '', isAction: false, title: 'How it works', description: 'Staff requests get auto-assigned to you by schedule. A badge on Calendar shows how many wait.', mobileDescription: 'Requests get auto-assigned to you. Badge on Calendar shows count.' },
      { route: '/dashboard', element: '[data-tour="stylist-pending-panel"]', isAction: false, title: 'Your pending requests', description: 'The amber panel above your calendar. Each card shows resident, service, preferred date, and notes.', mobileDescription: 'Pending requests appear in the amber panel above your calendar.' },
      { route: '/dashboard', element: '[data-tour="stylist-pending-entry"]', isAction: false, title: 'Read the request', description: 'If there\'s a preferred-date chip, try to fit them in around that day.' },
      { route: '/dashboard', element: '[data-tour="stylist-pending-convert"]', isAction: true, title: 'Pick a time', description: 'Opens the booking form pre-filled with this resident and service — just choose a time and save.', actionHint: 'Tap Pick time → to continue.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Drag onto the calendar', description: 'On desktop, drag a card onto a slot to open the form pre-filled at that exact time.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Done', description: 'Save the booking and the request leaves this list, dropping the badge count.' },
    ],
  },

  // Phase 12T
  'stylist-checkin': {
    id: 'stylist-checkin',
    title: "I'm Here Check-In",
    steps: [
      { route: '/dashboard', element: '', isAction: false, title: 'Check in when you arrive', description: "This banner appears atop your calendar on days you have appointments.", mobileDescription: "The banner appears atop your calendar when you have appointments." },
      { route: '/dashboard', element: '[data-tour="checkin-banner"]', isAction: false, title: 'Your daily summary', description: 'Shows how many appointments you have and when the first one starts.', mobileDescription: 'Shows your appointment count and first start time.' },
      { route: '/dashboard', element: '[data-tour="checkin-button"]', isAction: true, title: "Tap I'm Here", description: "Records your arrival time.", actionHint: "Tap I'm Here to continue.", mobileDescription: "Tap I'm Here to record your arrival." },
      { route: '/dashboard', element: '', isAction: false, title: 'On time?', description: "On time or early, you'll see a confirmation and the banner disappears.", mobileDescription: "On time? You'll see a confirmation and the banner disappears." },
      { route: '/dashboard', element: '', isAction: false, title: 'Running late?', description: "A sheet shows your remaining appointments shifted forward by how late you are.", mobileDescription: "Running late? A sheet shows your remaining appointments shifted forward." },
      { route: '/dashboard', element: '', isAction: false, title: 'Confirm or keep', description: "Tap Confirm new times to shift, or keep the originals. Either way, your check-in is saved.", mobileDescription: "Tap Confirm new times to shift, or Keep original times. Either way your check-in is saved." },
    ],
  },

  // 10a
  'admin-getting-started': {
    id: 'admin-getting-started',
    title: 'Getting Started as a Facility Admin',
    steps: [
      { route: '/dashboard', element: '', isAction: false, title: 'Welcome, Facility Admin', description: 'You manage one facility — residents, bookings, billing, and your team. Here\'s what to set up first.', mobileDescription: 'You manage one facility — residents, bookings, billing, and your team.' },
      { route: '/settings', element: '', isAction: false, title: 'Step 1 — Facility Settings', description: 'Confirm your facility name, time zone, and working hours. These drive how bookings display and when slots open.', mobileDescription: 'Confirm your facility name, time zone, and working hours in Settings.' },
      { route: '/residents', element: '[data-tour="residents-new-button"]', isAction: false, title: 'Step 2 — Add Residents', description: 'Add residents with a name and room number. Family contact info comes later for portal access.', mobileDescription: 'Add residents from the Residents page. Each needs a name and room number.' },
      { route: '/dashboard', element: NAV_CALENDAR, isAction: false, title: 'Step 3 — Your Calendar', description: 'Your scheduling hub. Bookings are created here and auto-assigned to stylists by availability.', mobileDescription: 'The Calendar is your scheduling hub for all bookings.' },
      { route: '/log', element: NAV_DAILY_LOG, isAction: false, title: 'Step 4 — The Daily Log', description: 'Tracks every appointment, completion, and note. It\'s also where bookkeepers scan checks.', mobileDescription: 'The Daily Log tracks appointments, completions, and notes.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Step 5 — Invite Your Team', description: 'Invite facility staff and bookkeepers from Settings → Team. Your Franchise Admin manages stylists.', mobileDescription: 'Invite staff and bookkeepers from Settings → Team. Franchise Admin manages stylists.' },
      { route: '/dashboard', element: '', isAction: false, title: "You're ready", description: 'That\'s the core workflow. The Help Center covers billing, analytics, and the family portal.', mobileDescription: 'The Help Center covers billing, analytics, and the family portal.' },
    ],
  },

  // 10
  'admin-facility-setup': {
    id: 'admin-facility-setup',
    title: 'Facility Setup',
    steps: [
      { route: '/settings', element: '', isAction: false, title: 'Settings overview', description: 'Configure your facility here — name, hours, billing, integrations, notifications. Sections are on the left.', mobileDescription: 'Configure your facility here — name, hours, billing, and more.' },
      { route: '/settings', element: '[data-tour="settings-nav-general"]', isAction: false, title: 'General', description: 'Name, address, phone, time zone, and working hours. Time zone controls when slots appear for residents.', mobileDescription: 'Name, time zone, and working hours. Time zone controls calendar slots.' },
      { route: '/settings', element: '[data-tour="settings-nav-billing"]', isAction: false, title: 'Billing & Payments', description: 'Set payment type, Stripe keys, and revenue share. Bookkeepers use these for reconciliation.', mobileDescription: 'Set payment type, Stripe, and revenue share here.' },
      { route: '/settings', element: '[data-tour="settings-nav-team"]', isAction: false, title: 'Team', description: 'Invite facility staff and bookkeepers. Your Franchise Admin manages stylists.', mobileDescription: 'Invite facility staff and bookkeepers from the Team section.' },
      { route: '/settings', element: '', isAction: false, title: 'Done', description: 'With General and Billing filled in, your facility is ready for bookings.', mobileDescription: 'Once General and Billing are set, your facility is ready for bookings.' },
    ],
  },

  // 9
  'admin-inviting-staff': {
    id: 'admin-inviting-staff',
    title: 'Inviting Staff',
    steps: [
      { route: '/settings', element: '', isAction: false, title: 'Who you can invite', description: 'Facility staff (scheduling, residents) and bookkeepers (billing, payroll, analytics). Franchise Admin adds stylists.', mobileDescription: 'Invite facility staff and bookkeepers. Franchise Admin adds stylists.' },
      { route: '/settings', element: '[data-tour="settings-nav-team"]', isAction: false, title: 'Open Team settings', description: 'Settings → Team lists everyone with access, plus an Invite button at the top.', mobileDescription: 'Settings → Team shows your team and an Invite button.' },
      { route: '/settings', element: '', isAction: false, title: 'Send an invite', description: 'Enter an email, choose a role, and they get a link to create their account. Expires in 7 days.', mobileDescription: 'Enter email and role. They get a link that expires in 7 days.' },
      { route: '/settings', element: '', isAction: false, title: 'Manage access', description: 'Revoke access from the Team list anytime. To change a role, revoke and re-invite.', mobileDescription: 'Revoke access from the Team list anytime. Re-invite to change roles.' },
    ],
  },

  // 10
  'admin-residents': {
    id: 'admin-residents',
    title: 'Managing Residents',
    steps: [
      { route: '/residents', element: '', isAction: false, title: 'Residents overview', description: 'Everyone at your facility. Search by name, filter by room, click to see history and contact info.', mobileDescription: 'Search, filter, and tap any resident to view their history.' },
      { route: '/residents', element: '[data-tour="residents-new-button"]', isAction: false, title: 'Add a resident', description: 'Click + to add one. Name and room required; add a POA email for family portal access.', mobileDescription: 'Tap + to add. Name and room required. Add a POA email for portal access.' },
      { route: '/residents', element: '', isAction: false, title: 'Resident detail', description: 'Click a row for full booking history, balance, service preferences, and tip defaults.', mobileDescription: 'Tap a resident to see booking history, balance, and preferences.' },
      { route: '/residents', element: '', isAction: false, title: 'Family portal access', description: 'The Family Portal card sends a magic-link invite to the POA to book and pay online.', mobileDescription: 'Send a portal invite so family can book and pay online.' },
      { route: '/residents', element: '', isAction: false, title: 'Bulk import', description: 'Use Import to upload residents from a spreadsheet. Download the CSV template first.', mobileDescription: 'Use Import to upload residents from a spreadsheet. Get the template first.' },
    ],
  },

  // 11
  'admin-reports': {
    id: 'admin-reports',
    title: 'Reports & Analytics',
    steps: [
      { route: '/analytics', element: NAV_ANALYTICS, isAction: false, title: 'Analytics overview', description: 'Revenue, appointment counts, and stylist performance for any date range — your financial snapshot.', mobileDescription: 'Revenue and appointment counts for any date range.' },
      { route: '/analytics', element: '', isAction: false, title: 'Revenue & bookings', description: 'Top tiles show revenue, appointment count, and average ticket. Use the date picker to filter.', mobileDescription: 'Top tiles show revenue, appointments, and average ticket. Date picker to filter.' },
      { route: '/analytics', element: '', isAction: false, title: 'Stylist breakdown', description: 'Scroll for per-stylist bookings, revenue, and commission — this feeds payroll.', mobileDescription: 'Scroll for per-stylist bookings, revenue, and commission.' },
      { route: '/analytics', element: '', isAction: false, title: 'Export data', description: 'Export a CSV of the current view to share or use in your own spreadsheets.', mobileDescription: 'Export a CSV of the current view.' },
    ],
  },

  // 12
  'admin-family-portal': {
    id: 'admin-family-portal',
    title: 'Family Portal',
    steps: [
      { route: '/residents', element: '', isAction: false, title: 'What the portal does', description: 'Lets a resident\'s POA log in to request bookings, view history, see their balance, and pay online.', mobileDescription: 'POA contacts can request bookings, view history, and pay online.' },
      { route: '/residents', element: '', isAction: false, title: 'Step 1 — Add a POA email', description: 'Add a POA email on the resident\'s detail page. One POA account can manage multiple residents.', mobileDescription: 'Add a POA email on the resident detail page. One account, many residents.' },
      { route: '/residents', element: '', isAction: false, title: 'Step 2 — Send the invite', description: 'The Family Portal card\'s Send Link emails a magic link — no password needed on first use.', mobileDescription: 'Tap Send Link on the Family Portal card. POA gets a magic link.' },
      { route: '/residents', element: '', isAction: false, title: 'Booking requests', description: 'Portal requests land on your calendar as "Requested". Confirm to move them to Scheduled.', mobileDescription: 'Portal requests appear as "Requested" for you to confirm.' },
      { route: '/residents', element: '', isAction: false, title: 'Online payments', description: 'With Stripe set up in Settings → Billing, families pay online and it shows in Billing automatically.', mobileDescription: 'With Stripe set up, families pay online. It shows in Billing automatically.' },
    ],
  },

  // 13
  'admin-compliance': {
    id: 'admin-compliance',
    title: 'Compliance Documents',
    steps: [
      { route: '/dashboard', element: '', isAction: false, title: 'What compliance covers', description: 'Tracks stylist licenses and insurance. You\'re emailed 60 and 30 days before anything expires.', mobileDescription: 'Tracks licenses and insurance. Email alerts before expiry.' },
      { route: '/stylists', element: '', isAction: false, title: 'Compliance status', description: 'Each stylist has a badge — green (verified), amber (expiring), or red (expired). Click to view documents.', mobileDescription: 'Each badge is green, amber, or red. Tap to view documents.' },
      { route: '/stylists', element: '', isAction: false, title: 'Uploading documents', description: 'Stylists upload from My Account; you verify from their detail page to mark them compliant.', mobileDescription: 'Stylists upload from My Account. You verify from their detail page.' },
      { route: '/stylists', element: '', isAction: false, title: 'Expiry alerts', description: 'All admins get alerts at 60 and 30 days. An unrenewed document turns the badge red.', mobileDescription: 'Alerts at 60 and 30 days. Red badge means action is needed.' },
    ],
  },

  'admin-command-palette': {
    id: 'admin-command-palette',
    title: 'Command Palette',
    steps: [
      { route: '/dashboard', element: '[data-tour="cmd-k-trigger"]', isAction: false, title: 'Command palette', description: 'Click here or press CMD+K (CTRL+K on Windows) to open it from anywhere.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Search anything', description: 'Search residents, stylists, and pages. Pages match instantly; people appear after a short delay.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Keyboard navigation', description: 'Use ↑/↓ to move, Enter to jump to a result, and Esc to close.' },
      { route: '/dashboard', element: '', isAction: false, title: 'Works everywhere', description: 'Opens from any page — no need to navigate to search first.' },
    ],
  },

  'admin-peek-drawer': {
    id: 'admin-peek-drawer',
    title: 'Quick Profile Peek',
    steps: [
      { route: '/log', element: '[data-tour="peek-resident-trigger"]', isAction: true, title: 'Click any resident name', description: 'Names are clickable everywhere — log, billing, calendar. Peek at a profile without leaving the page.', actionHint: 'Click the resident name to continue.', mobileDescription: 'Names are tappable everywhere. Tap one to peek.' },
      { route: '/log', element: '', isAction: false, title: 'Profile at a glance', description: 'A panel shows the resident\'s room, POA contact, recent visits, and next appointment.' },
      { route: '/log', element: '', isAction: false, title: 'Same for stylists', description: 'Click a stylist name anywhere to see their schedule and availability.' },
      { route: '/log', element: '', isAction: false, title: 'Open or close', description: 'Click View Full Profile to go to the full page, or close and stay put.' },
    ],
  },

  // 14
  'bookkeeper-getting-started': {
    id: 'bookkeeper-getting-started',
    title: 'Getting Started as a Bookkeeper',
    steps: [
      { route: '/log', element: '', isAction: false, title: 'Welcome, Bookkeeper', description: 'Your job: get daily log sheets into the system and send invoices each month. Here\'s where it all lives.', mobileDescription: 'Your job: get log sheets in and send invoices monthly.' },
      { route: '/log', element: NAV_DAILY_LOG, isAction: true, title: 'Daily Log — home base', description: 'Where you scan or manually enter paper log sheets from stylists.', actionHint: 'Tap Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: 'Two ways to enter logs', description: 'Scan a sheet with OCR (fastest) or enter services manually. Both record bookings.', mobileDescription: 'Scan sheets with OCR or enter services manually. Both work.' },
      { route: '/log', element: NAV_BILLING, isAction: true, title: 'Open Billing', description: 'Review invoices, check balances, and send statements each month.', actionHint: 'Tap Billing to continue.' },
      { route: '/billing', element: '[data-tour="billing-outstanding"]', isAction: false, title: 'Outstanding balances', description: 'What\'s owed across facilities. Green is caught up; amber means unpaid invoices need attention.', mobileDescription: 'Amber means unpaid invoices need attention. Green is caught up.' },
      { route: '/billing', element: NAV_PAYROLL, isAction: true, title: 'Open Payroll', description: 'Review pay periods per stylist and mark them paid once processed.', actionHint: 'Tap Payroll to continue.' },
      { route: '/payroll', element: '', isAction: false, title: "You're all set", description: 'Daily Log, Billing, and Payroll are your three areas. The Help section covers each in depth.' },
    ],
  },

  // 15
  'bookkeeper-billing-dashboard': {
    id: 'bookkeeper-billing-dashboard',
    title: 'Billing Dashboard',
    steps: [
      { route: '/billing', element: NAV_BILLING, isAction: true, title: 'Open Billing', description: 'Manage invoices and send statements. You\'ll use this monthly.', actionHint: 'Tap Billing to continue.' },
      { route: '/billing', element: '[data-tour="billing-outstanding"]', isAction: false, title: 'Outstanding balance', description: 'Total unpaid for this facility. Drive it toward zero each month with payments or reminders.', mobileDescription: 'Total unpaid for this facility. Get it to zero each month.' },
      { route: '/billing', element: '', isAction: false, title: 'Invoice list', description: 'Every invoice with amount, date, and paid status. Tap one for the full breakdown.' },
      { route: '/billing', element: '[data-tour="billing-filters"]', isAction: false, title: 'Filter invoices', description: 'Filter by date range or status — show only unpaid when chasing overdue payments.', mobileDescription: 'Filter by date range or status to focus on unpaid invoices.' },
      { route: '/billing', element: '[data-tour="billing-send-statement"]', isAction: false, title: 'Send statements', description: 'Send Statement emails a PDF to the facility or POA. Verify the recipient first.', mobileDescription: 'Send Statement emails a PDF. Check the recipient first.' },
      { route: '/billing', element: '', isAction: false, title: 'Monthly routine', description: 'Review last month\'s unpaid invoices, send statements for balances, then confirm payments received.', mobileDescription: 'Monthly: review unpaid → send statements → confirm payments.' },
    ],
  },

  // 16
  'bookkeeper-scan-logs': {
    id: 'bookkeeper-scan-logs',
    title: 'Scanning Daily Logs',
    steps: [
      { route: '/log', element: NAV_DAILY_LOG, isAction: true, title: 'Open the Daily Log', description: 'Start here when a paper log sheet arrives.', actionHint: 'Tap Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: "What you're scanning", description: 'A paper record of services a stylist performed. Getting it into the system drives correct invoices.' },
      { route: '/log', element: '[data-tour="daily-log-scan-sheet"]', isAction: true, title: 'Open the scanner', description: 'Opens the OCR tool to upload a photo or PDF of the sheet.', actionHint: 'Tap Scan log sheet — no real data changes.' },
      { route: '/log', element: '[data-tour="ocr-upload-area"]', isAction: false, title: 'Upload the sheet', description: 'Upload a flat, well-lit photo or PDF. The AI reads names, services, and prices automatically.', mobileDescription: 'Upload a clear photo or PDF. Flat, well-lit, no shadows.' },
      { route: '/log', element: '', isAction: false, title: 'Review the results', description: 'Every extracted entry appears in a table. Review each row — the AI struggles with handwriting.' },
      { route: '/log', element: '', isAction: false, title: 'What to check', description: 'Per row: the resident matches, the service is right, the price matches. Highlighted rows need attention.', mobileDescription: 'Check: resident matches, service is right, price is right.' },
      { route: '/log', element: '', isAction: false, title: 'Fix a misread entry', description: 'Tap a row to fix the name, service, or price. Fix errors before importing — it\'s harder after.', mobileDescription: 'Tap a row to fix name, service, or price. Fix before importing.' },
      { route: '/log', element: '', isAction: false, title: 'Resident not found?', description: 'A name that matches no resident shows a warning. Fix the spelling or add the resident before importing.', mobileDescription: 'Unresolved residents block import. Fix spelling or add first.' },
      { route: '/log', element: '', isAction: false, title: 'Import when ready', description: 'Import creates the bookings and they appear on invoices. Double-check first — it can\'t be undone.', mobileDescription: 'All rows correct? Tap Import — it can\'t be undone.' },
      { route: '/log', element: '', isAction: false, title: 'After importing', description: 'Confirm entries appear correctly in the daily log. Something off? Your admin can correct it.' },
    ],
  },

  // 16b
  'bookkeeper-manual-entry': {
    id: 'bookkeeper-manual-entry',
    title: 'Manual Log Entry',
    steps: [
      { route: '/log', element: NAV_DAILY_LOG, isAction: true, title: 'Open the Daily Log', description: 'When a sheet is too messy to scan, enter services by hand.', actionHint: 'Tap Daily Log to continue.' },
      { route: '/log', element: '', isAction: false, title: 'Manual entry', description: 'Add each service from the sheet as a walk-in. Slower than scanning, but full control.', mobileDescription: 'Add each service from the sheet one at a time as walk-ins.' },
      { route: '/log', element: '[data-tour="daily-log-add-walkin"]', isAction: true, title: 'Add a walk-in', description: 'Add one walk-in per service on the sheet.', actionHint: 'Tap Add Walk-in to continue.' },
      { route: '/log', element: '', isAction: false, title: 'Fill in the entry', description: 'Search the resident (add if new), pick the service, and enter the price as written.' },
      { route: '/log', element: '', isAction: false, title: 'Work through the sheet', description: 'One walk-in per service, row by row. Each becomes an invoice line — accuracy over speed.', mobileDescription: 'One walk-in per service. Accuracy over speed.' },
      { route: '/log', element: '', isAction: false, title: 'Check the date', description: 'Use the date navigation to enter services on the date they were performed, not today.', mobileDescription: 'Use date navigation to match the date services happened.' },
      { route: '/log', element: '[data-tour="daily-log-finalize-button"]', isAction: false, title: 'Finalize when done', description: 'Review the list and tap Finalize Day to lock entries and make them ready for invoicing.', mobileDescription: 'Entered everything? Review and tap Finalize Day.' },
      { route: '/log', element: '', isAction: false, title: 'Manual vs scan', description: 'Both create the same bookings. Scan for speed; enter manually when scan quality is poor.' },
    ],
  },

  // 17
  'bookkeeper-duplicates': {
    id: 'bookkeeper-duplicates',
    title: 'Duplicate Resolution',
    steps: [
      { route: '/residents', element: '', isAction: false, title: 'Why duplicates happen', description: 'Scanning can enter one resident twice — "Mary Smith" and "Mary S." Duplicates split billing and history.', mobileDescription: 'Scanning duplicates a resident when the name is spelled differently.' },
      { route: '/residents', element: NAV_RESIDENTS, isAction: true, title: 'Open Residents', description: 'Duplicate detection lives in the Residents section.', actionHint: 'Tap Residents to continue.' },
      { route: '/residents', element: '[data-tour="residents-duplicates-button"]', isAction: true, title: 'Find duplicates', description: 'Scans for likely matches by comparing names, rooms, and booking history.', actionHint: 'Tap Duplicates to see the result — this is a demo.' },
      { route: '/residents', element: '', isAction: false, title: 'Review pairs', description: 'Each card pairs two possible matches with a confidence score. Check names, rooms, and booking counts.' },
      { route: '/residents', element: '', isAction: false, title: 'Before you merge', description: 'The LEFT record is primary — bookings move to it and the right is removed. Confirm its name and room.', mobileDescription: 'The LEFT record becomes primary. Confirm its name and room.' },
      { route: '/residents', element: '', isAction: false, title: 'Merging', description: 'Merge combines the records onto the primary. It can\'t be undone — skip and ask your admin if unsure.', mobileDescription: 'Merge can\'t be undone — skip if unsure and ask your admin.' },
      { route: '/residents', element: '', isAction: false, title: 'After merging', description: 'Full history sits on one record and invoices total correctly. Check after every import batch.' },
    ],
  },

  // 18
  'bookkeeper-payroll': {
    id: 'bookkeeper-payroll',
    title: 'Payroll & Pay Periods',
    steps: [
      { route: '/payroll', element: NAV_PAYROLL, isAction: true, title: 'Open Payroll', description: 'Track stylist pay periods and mark them paid here.', actionHint: 'Tap Payroll to continue.' },
      { route: '/payroll', element: '[data-tour="payroll-period-list"]', isAction: false, title: 'Pay periods', description: 'Each row is a facility pay period — dates, total owed, and paid status. Open one for the breakdown.', mobileDescription: 'Each row is a pay period. Tap for per-stylist earnings and status.' },
      { route: '/payroll', element: '', isAction: false, title: 'Review a period', description: 'Open a period to see each stylist\'s commission, tips, and deductions. Review before paying.' },
      { route: '/payroll', element: '', isAction: false, title: 'Mark as paid', description: 'Mark as Paid locks the period and records the date. Coordinate with admins so it isn\'t done twice.', mobileDescription: 'Mark as Paid once sent. Coordinate with admins — don\'t double-mark.' },
      { route: '/payroll', element: '', isAction: false, title: 'Exporting', description: 'Export a CSV of any period for your records or an external payroll system.', mobileDescription: 'Export a CSV for your records or external payroll.' },
      { route: '/payroll', element: '', isAction: false, title: 'QuickBooks sync', description: 'Connected facilities sync payroll as Bills automatically. See a discrepancy? Contact your franchise admin.' },
    ],
  },

  // 18b — Phase 12Z
  'bookkeeper-export-logs': {
    id: 'bookkeeper-export-logs',
    title: 'Export Daily Logs to Excel',
    steps: [
      { route: '/log', element: '', isAction: false, title: 'Excel export for accounting', description: 'Download the daily log as a styled Excel file — facility code, stylist code, services, totals, tips, payment type.', mobileDescription: 'Download daily logs as Excel in the accounting format.' },
      { route: '/log', element: '[data-tour="log-export-excel"]', isAction: true, title: 'Open the exporter', description: 'Opens the date-range picker. The button sits by the date arrows in the header.', actionHint: 'Tap Export to continue.' },
      { route: '/log', element: '', isAction: false, title: 'Pick a range and download', description: 'Choose dates (defaults to month-to-date) and Export. Only completed bookings download. Reports exports across facilities.', mobileDescription: 'Pick a date range, tap Export. Only completed bookings.' },
    ],
  },

  // 18
  'master-getting-started': {
    id: 'master-getting-started',
    title: 'Getting Started as Master Admin',
    steps: [
      { route: '/master-admin', element: '', isAction: false, title: 'Welcome, Lisa', description: 'Full access to every facility, stylist, and financial report — plus platform tools only you have.', mobileDescription: 'Full access to every facility, stylist, and report.' },
      { route: '/master-admin', element: NAV_MASTER_ADMIN, isAction: true, title: 'Open Master Admin', description: 'Your control center — add facilities, view cross-facility data, oversee the platform.', actionHint: 'Tap Master Admin to continue.' },
      { route: '/master-admin', element: '', isAction: false, title: 'All facilities', description: 'Every facility with its status, code, and key details. Tap one to open and manage it.', mobileDescription: 'Every facility on the platform. Tap any to manage it.' },
      { route: '/master-admin', element: '', isAction: false, title: 'What you oversee', description: 'Add facilities, manage franchise admins, review analytics, set up QuickBooks, merge duplicates.', mobileDescription: 'Facilities, franchise admins, analytics, QuickBooks, and more.' },
      { route: '/stylists/directory', element: NAV_STYLISTS, isAction: true, title: 'Open Stylist Directory', description: 'Manage your whole workforce — active stylists, assignments, and applicants.', actionHint: 'Tap Stylists to continue.' },
      { route: '/stylists/directory', element: '', isAction: false, title: 'Your stylists', description: 'Every stylist across all facilities. Filter, search, or bulk-update status and assignments.', mobileDescription: 'Every stylist across facilities. Filter or search by name.' },
      { route: '/stylists/directory', element: '', isAction: false, title: "You're ready", description: 'The Help section has detailed tours — adding facilities, applicants, QuickBooks, and analytics.' },
    ],
  },

  // 19
  'master-add-facility': {
    id: 'master-add-facility',
    title: 'Adding a Facility',
    steps: [
      { route: '/master-admin', element: '', isAction: false, title: 'Adding a facility', description: 'Create new facilities in Master Admin. Each gets a code, a profile, and can receive stylists.', mobileDescription: 'Create facilities here. Each gets a code and takes stylists.' },
      { route: '/master-admin', element: '', isAction: false, title: 'Facility list', description: 'Check the existing list first so you don\'t add a duplicate under a different name.' },
      { route: '/master-admin', element: '', isAction: false, title: 'Open the form', description: 'Tap Add Facility to open the creation form, then return here and tap Next.' },
      { route: '/master-admin', element: '', isAction: false, title: 'Facility form', description: 'Enter name, address, and contact info. The code auto-generates; pick the franchise it belongs to.', mobileDescription: 'Enter name, address, and contact info. Code auto-generates.' },
      { route: '/master-admin', element: '', isAction: false, title: 'After creating', description: 'It appears in the list. Next: set working hours and payment type in Settings, then invite the admin.', mobileDescription: 'Next: set hours in Settings, then invite the facility admin.' },
      { route: '/master-admin', element: '', isAction: false, title: 'Assign stylists', description: 'In the Stylist Directory, assign stylists to it. Franchise-pool stylists work at any facility.' },
    ],
  },

  // 20
  'master-stylist-directory': {
    id: 'master-stylist-directory',
    title: 'Stylist Directory',
    steps: [
      { route: '/stylists/directory', element: '', isAction: false, title: 'The Stylist Directory', description: 'Your full workforce roster across all franchises. Manage status, assignments, and availability.' },
      { route: '/stylists/directory', element: '', isAction: false, title: 'Stylist list', description: 'Each row shows code, name, assigned facility (or Franchise Pool), and status.', mobileDescription: 'Each row shows code, name, facility, and status.' },
      { route: '/stylists/directory', element: '', isAction: false, title: 'Status types', description: 'Active, On Leave, Inactive, Terminated. Only Active stylists appear on booking surfaces.', mobileDescription: 'Active, On Leave, Inactive, Terminated. Only Active can be booked.' },
      { route: '/stylists/directory', element: '', isAction: false, title: 'Change a status', description: 'Open a profile and use the status dropdown, or bulk-select rows and use the action bar.', mobileDescription: 'Open a profile to change status. Bulk-select for many.' },
      { route: '/stylists/directory', element: '', isAction: false, title: 'Assign to facilities', description: 'In a profile\'s Assignments card, add a facility and set its commission. Stylists can have several.', mobileDescription: 'Profile → Assignments → add facility + set commission.' },
      { route: '/stylists/directory', element: '', isAction: false, title: 'The franchise pool', description: 'Unassigned stylists cover shifts but aren\'t on any calendar. Assign one to place them permanently.' },
    ],
  },

  // 21
  'master-applicant-pipeline': {
    id: 'master-applicant-pipeline',
    title: 'Applicant Pipeline',
    steps: [
      { route: '/stylists/directory', element: '', isAction: false, title: 'The Applicant Pipeline', description: 'Import Indeed applicants, review them, and promote the best to active stylists.', mobileDescription: 'Import Indeed applicants, review, and promote the best.' },
      { route: '/stylists/directory', element: '', isAction: false, title: 'Import from Indeed', description: 'Export a CSV from Indeed and Import CSV on the Applicants tab. We read name, contact, and qualifications.', mobileDescription: 'Export CSV from Indeed → Import CSV on the Applicants tab.' },
      { route: '/stylists/directory', element: '', isAction: false, title: 'The Applicants tab', description: 'Each applicant shows a status — New, Reviewing, Contacting, Hired, Rejected. Filter to focus.' },
      { route: '/stylists/directory', element: '', isAction: false, title: 'Review an applicant', description: 'Expand for experience, qualifications, and screening answers. Add notes and update their status.', mobileDescription: 'Tap to expand details. Add notes, update status.' },
      { route: '/stylists/directory', element: '', isAction: false, title: 'Promote to stylist', description: 'Promote to Stylist creates their profile. Finish setup: license, facility, commission.', mobileDescription: 'Promote to Stylist creates the profile. Then assign facility + commission.' },
      { route: '/stylists/directory', element: '', isAction: false, title: 'After promoting', description: 'Status flips to Hired and a new Active stylist appears. Send an account invite so they can log in.' },
    ],
  },

  // 22
  'master-quickbooks-setup': {
    id: 'master-quickbooks-setup',
    title: 'QuickBooks Setup',
    steps: [
      { route: '/settings', element: '', isAction: false, title: 'QuickBooks setup', description: 'Connect QuickBooks per facility. Payroll syncs as Bills and invoice data flows back automatically.', mobileDescription: 'Connect per facility. Payroll syncs as Bills, invoices sync back.' },
      { route: '/settings', element: NAV_SETTINGS, isAction: true, title: 'Open Settings', description: 'QuickBooks is configured in each facility\'s Settings.', actionHint: 'Tap Settings to continue.' },
      { route: '/settings?section=billing', element: '[data-tour="settings-quickbooks"]', isAction: false, title: 'QuickBooks section', description: 'In the Billing tab, the QuickBooks section is where you connect and manage the integration.', mobileDescription: 'Find QuickBooks in Settings → Billing tab.' },
      { route: '/settings?section=billing', element: '[data-tour="settings-qb-connect-btn"]', isAction: true, title: 'Connect QuickBooks', description: 'Starts the Intuit OAuth login to authorize access to this facility\'s QuickBooks account.', actionHint: 'Tap Connect QuickBooks — no real connection is made.' },
      { route: '/settings?section=billing', element: '', isAction: false, title: 'After connecting', description: 'Payroll syncs as Bills and invoices flow back. See a discrepancy? Use manual sync to refresh.', mobileDescription: 'Payroll syncs as Bills. Use manual sync if you see issues.' },
      { route: '/settings?section=billing', element: '', isAction: false, title: 'Per-facility setup', description: 'Each facility needs its own connection — they may use separate QB accounts. Repeat for each one.' },
    ],
  },

  // 23
  'master-analytics': {
    id: 'master-analytics',
    title: 'Cross-Facility Analytics',
    steps: [
      { route: '/analytics', element: NAV_ANALYTICS, isAction: true, title: 'Open Analytics', description: 'Performance data per facility. As Master Admin, view reports across all of them.', actionHint: 'Tap Analytics to continue.' },
      { route: '/analytics', element: '', isAction: false, title: 'Revenue overview', description: 'Total revenue by service type for the selected facility and range — see what drives income.', mobileDescription: 'Total revenue by service type for the selected facility.' },
      { route: '/analytics', element: '', isAction: false, title: 'Date range', description: 'Compare week over week or month over month to spot trends and seasonal patterns.', mobileDescription: 'Change the date range to compare across weeks or months.' },
      { route: '/analytics', element: '', isAction: false, title: 'Per-stylist breakdown', description: 'Scroll for appointments, revenue, and average per stylist — spot top performers and coverage gaps.', mobileDescription: 'Per-stylist appointments, revenue, and average. Spot gaps.' },
      { route: '/analytics', element: '', isAction: false, title: 'Compare facilities', description: 'Switch the facility selector and rerun the report to see who\'s growing and who needs attention.', mobileDescription: 'Switch the facility selector to rerun the report per facility.' },
    ],
  },
}

// ────────────────────────────────────────────────────────────────────────────
// ENGINE — runTour
// ────────────────────────────────────────────────────────────────────────────

// Lazy singleton — Driver.js is only loaded once per page session, not on every step.
let _driverModule: Awaited<typeof import('driver.js')> | null = null
async function getDriverModule() {
  if (!_driverModule) _driverModule = await import('driver.js')
  return _driverModule
}

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
// Phase 12Y — Platform-aware tour aliases. ONBOARDING_CHECKLIST, external
// `?tour=` query params, and any code that references the unsuffixed tour id
// is resolved to the right `-mobile`/`-desktop` variant at runtime.
export const PLATFORM_TOUR_ALIASES: Record<string, { mobile: string; desktop: string }> = {
  'stylist-getting-started': {
    mobile: 'stylist-getting-started-mobile',
    desktop: 'stylist-getting-started-desktop',
  },
  'stylist-calendar': {
    mobile: 'stylist-calendar-mobile',
    desktop: 'stylist-calendar-desktop',
  },
}

/**
 * Returns true when the given base tour id (or either of its platform
 * variants) appears in the user's completed tour list. Use this anywhere
 * completion needs to be checked against ONBOARDING_CHECKLIST base ids.
 */
export function isTourCompleted(baseId: string, completed: string[]): boolean {
  if (completed.includes(baseId)) return true
  const alias = PLATFORM_TOUR_ALIASES[baseId]
  if (!alias) return false
  return completed.includes(alias.mobile) || completed.includes(alias.desktop)
}

export async function startTour(
  tourId: string,
  opts: { resumeFromStep?: number } = {},
): Promise<void> {
  if (typeof window === 'undefined') return
  // Resolve platform-aware aliases before looking up the definition.
  const alias = PLATFORM_TOUR_ALIASES[tourId]
  if (alias) tourId = isMobile() ? alias.mobile : alias.desktop
  const def = TOUR_DEFINITIONS[tourId]
  if (!def) {
    console.warn(`[help] No tour definition for "${tourId}"`)
    return
  }

  // Phase 12Y — engine-level desktopOnly gating removed; the help catalog
  // filter now hides incompatible tours. If a tour is started programmatically
  // on the wrong platform (e.g. ?tour= query param), it silently runs with
  // whatever elements it can find; missing-element steps are skipped.

  // Mobile branch — spotlight + bottom sheet renderer
  if (isMobile()) {
    const { startMobileTour } = await import('./mobile-tour')
    await startMobileTour(tourId, opts)
    return
  }

  // Phase 12O — engage demo-mode write interception for the duration of the tour
  installTourFetchInterceptor()
  setTourModeActive(true)

  // Tear down any existing tour
  destroyActiveTour()
  const startIndex = Math.max(0, opts.resumeFromStep ?? 0)
  await runStep(def, startIndex)
}

async function runStep(def: TourDefinition, index: number): Promise<void> {
  if (index >= def.steps.length) {
    destroyActiveTour()
    clearSessionState()
    setTourModeActive(false)
    // Fire AFTER setTourModeActive(false) so the Phase 12O fetch interceptor is off
    window.dispatchEvent(new CustomEvent('tour-completed', { detail: { tourId: def.id } }))
    fetch('/api/profile/complete-tour', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tourId: def.id }),
    }).catch(() => {})
    return
  }
  const step = def.steps[index]
  const totalSteps = def.steps.length

  // Cross-route hop: SPA nav via router.push when available; module state
  // survives, waitForElement (MutationObserver) resolves once the new page
  // renders the target. Falls back to hard-nav + sessionStorage resume only
  // when the router ref hasn't been populated yet (SSR race).
  if (!isOnRoute(step.route)) {
    destroyActiveTour()
    const router = getTourRouter()
    if (router) {
      router.push(step.route)
      // Fall through — waitForElement below picks up the new route's DOM.
    } else {
      saveSessionState({
        tourId: def.id,
        stepIndex: index,
        expiresAt: Date.now() + SESSION_TTL_MS,
      })
      window.location.href = step.route
      return // Page will reload; <TourResumer /> picks up.
    }
  }

  // Same route — find the element (or no element for terminal info steps)
  let target: HTMLElement | null = null
  if (step.element) {
    const waitMs = isSlowRoute(step.route) ? SLOW_PAGE_WAIT_MS : DESKTOP_ELEMENT_WAIT_MS
    target = await waitForElement(resolveQuery(step.element), waitMs)
    if (!target) {
      // Phase 12Y — silently skip when a target is missing. The user never sees
      // a "Couldn't find that element" toast; developers see a console.warn.
      console.warn(`[tour] ${def.id}[${index}] target not found: ${step.element} — skipping`)
      return runStep(def, index + 1)
    }
  }

  // Lazy-load Driver.js (singleton — module is cached after first import)
  const { driver } = await getDriverModule()

  // Compose description (with action hint as a separate paragraph)
  const description = step.actionHint
    ? `${step.description}<br><br><span class="tour-action-hint">${step.actionHint}</span>`
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
      setTourModeActive(false)
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
