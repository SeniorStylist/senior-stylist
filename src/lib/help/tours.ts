// Help Center: tutorial catalog + Driver.js tour engine.
// Driver.js is dynamically imported inside startTour() so the ~16 KB lib stays
// out of the global bundle for users who never open a tour.

import type { DriveStep } from 'driver.js'

export type TutorialRole =
  | 'admin'
  | 'super_admin'
  | 'facility_staff'
  | 'bookkeeper'
  | 'stylist'
  | 'viewer'

export type TutorialIcon =
  | 'KeyRound'
  | 'Calendar'
  | 'FileText'
  | 'Users'
  | 'UserPlus'
  | 'CheckCircle2'
  | 'UserCog'
  | 'Building2'
  | 'Mail'
  | 'BarChart3'
  | 'HeartHandshake'
  | 'ShieldCheck'
  | 'CreditCard'
  | 'ScanLine'
  | 'GitMerge'
  | 'Database'
  | 'FileSpreadsheet'
  | 'Wallet'
  | 'PlusSquare'
  | 'Network'
  | 'BookOpen'
  | 'CircleHelp'

export type Tutorial = {
  id: string
  category: string
  title: string
  blurb: string
  estMinutes: number
  icon: TutorialIcon
  roles: TutorialRole[]
  /** When non-null, "Guided Tour" button launches this tour. Null = "Coming soon". */
  tourId: string | null
  /** When true, only the master admin (env email) sees this card. */
  masterOnly?: boolean
}

// Each tour ships separate desktop + mobile DriveStep arrays so popover copy and
// selectors can differ per device (sidebar nav vs bottom-tab nav, etc).
export type TourDefinition = {
  id: string
  title: string
  desktop: DriveStep[]
  mobile: DriveStep[]
}

const isMobile = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches

// ────────────────────────────────────────────────────────────────────────────
// TUTORIAL CATALOG — all ~30 cards rendered on /help. Only 5 have non-null
// tourId; the rest show "Coming soon" on their Guided Tour button.
// ────────────────────────────────────────────────────────────────────────────

export const TUTORIAL_CATALOG: Tutorial[] = [
  // STYLIST
  {
    id: 'stylist-getting-started',
    category: 'Getting Started',
    title: 'Getting Started',
    blurb: 'Logging in and getting around your dashboard. The basics.',
    estMinutes: 2,
    icon: 'KeyRound',
    roles: ['stylist'],
    tourId: null,
  },
  {
    id: 'stylist-calendar',
    category: 'Scheduling',
    title: 'Your Calendar',
    blurb: 'Read your schedule and book a resident by clicking a time slot.',
    estMinutes: 3,
    icon: 'Calendar',
    roles: ['stylist'],
    tourId: 'stylist-calendar',
  },
  {
    id: 'stylist-daily-log',
    category: 'Daily Log',
    title: 'Daily Log',
    blurb: 'Complete service entries, prices, and notes for the day.',
    estMinutes: 4,
    icon: 'FileText',
    roles: ['stylist'],
    tourId: 'stylist-daily-log',
  },
  {
    id: 'stylist-walkins',
    category: 'Daily Log',
    title: 'Walk-ins',
    blurb: 'Add a walk-in service to the daily log on the fly.',
    estMinutes: 2,
    icon: 'UserPlus',
    roles: ['stylist'],
    tourId: null,
  },
  {
    id: 'stylist-finalize',
    category: 'Daily Log',
    title: 'Finalizing the Day',
    blurb: 'What finalizing means and how to do it at end of day.',
    estMinutes: 2,
    icon: 'CheckCircle2',
    roles: ['stylist'],
    tourId: null,
  },
  {
    id: 'stylist-residents',
    category: 'Residents',
    title: 'Managing Residents',
    blurb: 'Find, edit, and add new residents.',
    estMinutes: 3,
    icon: 'Users',
    roles: ['stylist'],
    tourId: 'stylist-residents',
  },
  {
    id: 'stylist-account',
    category: 'Account',
    title: 'Your Account',
    blurb: 'Edit your profile, set your hours, and update your info.',
    estMinutes: 2,
    icon: 'UserCog',
    roles: ['stylist'],
    tourId: null,
  },

  // FACILITY STAFF
  {
    id: 'staff-getting-started',
    category: 'Getting Started',
    title: 'Getting Started',
    blurb: 'Logging in and navigating your dashboard.',
    estMinutes: 2,
    icon: 'KeyRound',
    roles: ['facility_staff'],
    tourId: null,
  },
  {
    id: 'staff-residents',
    category: 'Residents',
    title: 'Resident List',
    blurb: 'Find, edit, and manage residents at your facility.',
    estMinutes: 3,
    icon: 'Users',
    roles: ['facility_staff'],
    tourId: null,
  },
  {
    id: 'staff-scheduling',
    category: 'Scheduling',
    title: 'Scheduling',
    blurb: 'Book appointments by clicking a time slot in the calendar.',
    estMinutes: 3,
    icon: 'Calendar',
    roles: ['facility_staff'],
    tourId: null,
  },
  {
    id: 'staff-add-residents',
    category: 'Residents',
    title: 'Adding Residents',
    blurb: 'Add a new resident with name, room, and POA contact.',
    estMinutes: 2,
    icon: 'UserPlus',
    roles: ['facility_staff'],
    tourId: null,
  },
  {
    id: 'staff-daily-log-readonly',
    category: 'Daily Log',
    title: 'Daily Log (Read-Only)',
    blurb: 'See what was done today. View-only — no edits.',
    estMinutes: 2,
    icon: 'FileText',
    roles: ['facility_staff'],
    tourId: null,
  },

  // FACILITY ADMIN — sees stylist + staff tutorials too (handled in client)
  {
    id: 'admin-facility-setup',
    category: 'Facility',
    title: 'Facility Setup',
    blurb: 'Set name, hours, working days, payment type, and contact info.',
    estMinutes: 4,
    icon: 'Building2',
    roles: ['admin', 'super_admin'],
    tourId: 'admin-facility-setup',
  },
  {
    id: 'admin-invite-staff',
    category: 'Team',
    title: 'Inviting Staff',
    blurb: 'Send invites to facility staff and bookkeepers.',
    estMinutes: 2,
    icon: 'Mail',
    roles: ['admin', 'super_admin'],
    tourId: null,
  },
  {
    id: 'admin-reports',
    category: 'Reports',
    title: 'Reports & Analytics',
    blurb: 'Run facility-level reports for revenue, services, and stylists.',
    estMinutes: 3,
    icon: 'BarChart3',
    roles: ['admin', 'super_admin'],
    tourId: null,
  },
  {
    id: 'admin-family-portal',
    category: 'Family Portal',
    title: 'Family Portal',
    blurb: 'Set up resident portals and send POA invite links.',
    estMinutes: 4,
    icon: 'HeartHandshake',
    roles: ['admin', 'super_admin'],
    tourId: null,
  },
  {
    id: 'admin-compliance',
    category: 'Compliance',
    title: 'Compliance Documents',
    blurb: 'Manage stylist licenses, insurance, and W-9 paperwork.',
    estMinutes: 3,
    icon: 'ShieldCheck',
    roles: ['admin', 'super_admin'],
    tourId: null,
  },

  // BOOKKEEPER
  {
    id: 'bookkeeper-billing-dashboard',
    category: 'Billing',
    title: 'Billing Dashboard',
    blurb: 'Navigate AR and outstanding balances per facility and resident.',
    estMinutes: 4,
    icon: 'CreditCard',
    roles: ['bookkeeper'],
    tourId: null,
  },
  {
    id: 'bookkeeper-scan-logs',
    category: 'Daily Log',
    title: 'Scanning Daily Logs',
    blurb: 'Upload paper logs, review the OCR result, fix misread fields.',
    estMinutes: 5,
    icon: 'ScanLine',
    roles: ['bookkeeper'],
    tourId: 'bookkeeper-scan-logs',
  },
  {
    id: 'bookkeeper-duplicates',
    category: 'Residents',
    title: 'Duplicate Resolution',
    blurb: 'Find and resolve duplicate residents and bookings.',
    estMinutes: 3,
    icon: 'GitMerge',
    roles: ['bookkeeper'],
    tourId: null,
  },
  {
    id: 'bookkeeper-quickbooks',
    category: 'Billing',
    title: 'QuickBooks Data',
    blurb: 'Import QB customer + transaction data and read balances.',
    estMinutes: 4,
    icon: 'Database',
    roles: ['bookkeeper'],
    tourId: null,
  },
  {
    id: 'bookkeeper-financial-reports',
    category: 'Reports',
    title: 'Financial Reports',
    blurb: 'Run and export reports for accountants and tax season.',
    estMinutes: 3,
    icon: 'FileSpreadsheet',
    roles: ['bookkeeper'],
    tourId: null,
  },
  {
    id: 'bookkeeper-payroll',
    category: 'Payroll',
    title: 'Payroll & Pay Periods',
    blurb: 'Review pay periods and confirm payment status with QuickBooks.',
    estMinutes: 4,
    icon: 'Wallet',
    roles: ['bookkeeper'],
    tourId: null,
  },

  // MASTER / SUPER ADMIN
  {
    id: 'master-add-facility',
    category: 'Facilities',
    title: 'Adding a Facility',
    blurb: 'Create and configure a new facility from the master admin panel.',
    estMinutes: 4,
    icon: 'PlusSquare',
    roles: ['admin', 'super_admin'],
    tourId: null,
    masterOnly: true,
  },
  {
    id: 'master-quickbooks-setup',
    category: 'Billing',
    title: 'QuickBooks Setup',
    blurb: 'Connect QuickBooks per facility and configure invoice sync.',
    estMinutes: 5,
    icon: 'Database',
    roles: ['admin', 'super_admin'],
    tourId: null,
    masterOnly: true,
  },
  {
    id: 'master-franchise',
    category: 'Franchise',
    title: 'Franchise Management',
    blurb: 'Manage franchises and super admin user assignments.',
    estMinutes: 4,
    icon: 'Network',
    roles: ['admin', 'super_admin'],
    tourId: null,
    masterOnly: true,
  },
  {
    id: 'master-cross-facility-analytics',
    category: 'Reports',
    title: 'Cross-Facility Analytics',
    blurb: 'View revenue and KPIs across every facility you own.',
    estMinutes: 3,
    icon: 'BarChart3',
    roles: ['admin', 'super_admin'],
    tourId: null,
    masterOnly: true,
  },
  {
    id: 'master-merge-duplicates',
    category: 'Residents',
    title: 'Merging Duplicates',
    blurb: 'Merge duplicate facilities and residents safely.',
    estMinutes: 4,
    icon: 'GitMerge',
    roles: ['admin', 'super_admin'],
    tourId: null,
    masterOnly: true,
  },
  {
    id: 'master-team-roster',
    category: 'Team',
    title: 'Global Team Roster',
    blurb: 'See every user across every facility you manage.',
    estMinutes: 3,
    icon: 'Users',
    roles: ['admin', 'super_admin'],
    tourId: null,
    masterOnly: true,
  },
]

// ────────────────────────────────────────────────────────────────────────────
// TOUR DEFINITIONS — 5 implemented Driver.js tours.
// Each defines desktop + mobile step arrays. The engine picks one at runtime.
// ────────────────────────────────────────────────────────────────────────────

const driverDefaults = {
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

export const TOUR_DEFINITIONS: Record<string, TourDefinition> = {
  'stylist-calendar': {
    id: 'stylist-calendar',
    title: 'Your Calendar',
    desktop: [
      {
        element: '[data-tour="nav-calendar"]',
        popover: {
          title: 'Your Calendar',
          description: 'This is your home base — every appointment lives here.',
          side: 'right',
        },
      },
      {
        element: '.fc-toolbar',
        popover: {
          title: 'Switch views',
          description: 'Use these buttons to flip between Day, Week, and Month.',
          side: 'bottom',
        },
      },
      {
        element: '.fc-timegrid-slot',
        popover: {
          title: 'Click a slot',
          description: 'Click any time slot to start a new booking.',
          side: 'right',
        },
      },
      {
        element: '[data-tour="calendar-time-grid"]',
        popover: {
          title: 'Booking blocks',
          description: 'Each colored block is a booking. Drag to reschedule, click to edit.',
        },
      },
    ],
    mobile: [
      {
        element: '[data-tour-mobile="nav-calendar"]',
        popover: {
          title: 'Calendar tab',
          description: 'Tap Calendar at the bottom to see your day.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="calendar-time-grid"]',
        popover: {
          title: 'Tap to book',
          description: 'Pinch to zoom. Tap any time slot to start a new booking.',
        },
      },
    ],
  },

  'stylist-daily-log': {
    id: 'stylist-daily-log',
    title: 'Daily Log',
    desktop: [
      {
        element: '[data-tour="nav-daily-log"]',
        popover: {
          title: 'Daily Log',
          description: 'See everything done today, line by line.',
          side: 'right',
        },
      },
      {
        element: '[data-tour="daily-log-entry-row"]',
        popover: {
          title: 'Edit inline',
          description: 'Click the pencil icon on any row to update price or notes.',
        },
      },
      {
        element: '[data-tour="daily-log-add-walkin"]',
        popover: {
          title: 'Add a walk-in',
          description: 'Did someone come in unscheduled? Add them here.',
          side: 'left',
        },
      },
      {
        element: '[data-tour="daily-log-finalize-button"]',
        popover: {
          title: 'Finalize the day',
          description: 'When you\'re done, finalize to lock the entries. This sends bills out.',
          side: 'left',
        },
      },
    ],
    mobile: [
      {
        element: '[data-tour-mobile="nav-daily-log"]',
        popover: {
          title: 'Daily Log',
          description: 'Tap Log at the bottom of the screen.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="daily-log-entry-row"]',
        popover: {
          title: 'Edit a row',
          description: 'Tap any row to change price, notes, or service.',
        },
      },
      {
        element: '[data-tour-mobile="daily-log-add-walkin"]',
        popover: {
          title: 'Add a walk-in',
          description: 'For unscheduled visitors. Tap and fill in the form.',
        },
      },
      {
        element: '[data-tour-mobile="daily-log-finalize-button"]',
        popover: {
          title: 'Finalize',
          description: 'When the day is done, finalize to lock entries.',
        },
      },
    ],
  },

  'stylist-residents': {
    id: 'stylist-residents',
    title: 'Managing Residents',
    desktop: [
      {
        element: '[data-tour="nav-residents"]',
        popover: {
          title: 'Residents',
          description: 'The full list of every resident at your facility.',
          side: 'right',
        },
      },
      {
        element: '[data-tour="residents-search"]',
        popover: {
          title: 'Search',
          description: 'Type a name or room number to filter the list instantly.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="residents-new-button"]',
        popover: {
          title: 'Add a resident',
          description: 'Use this button to add someone new — name, room, POA contact.',
          side: 'left',
        },
      },
      {
        element: '[data-tour="residents-table"]',
        popover: {
          title: 'Click any row',
          description: 'Click a resident\'s row to see their full history and edit details.',
        },
      },
    ],
    mobile: [
      {
        element: '[data-tour-mobile="nav-residents"]',
        popover: {
          title: 'Residents',
          description: 'Tap Residents at the bottom.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="residents-search"]',
        popover: {
          title: 'Search',
          description: 'Type a name or room number to find someone.',
        },
      },
      {
        element: '[data-tour="residents-new-button"]',
        popover: {
          title: 'Add new',
          description: 'Tap the + button to add a new resident.',
        },
      },
    ],
  },

  'admin-facility-setup': {
    id: 'admin-facility-setup',
    title: 'Facility Setup',
    desktop: [
      {
        element: '[data-tour="nav-settings"]',
        popover: {
          title: 'Settings',
          description: 'Everything about your facility lives in Settings.',
          side: 'right',
        },
      },
      {
        element: '[data-tour="settings-facility-form"]',
        popover: {
          title: 'Facility details',
          description: 'Name, payment type, and contact info. Set these once and forget them.',
        },
      },
      {
        element: '[data-tour="settings-working-hours"]',
        popover: {
          title: 'Working hours',
          description: 'Pick the days and times your facility is open. Bookings respect these bounds.',
          side: 'top',
        },
      },
    ],
    mobile: [
      {
        element: '[data-tour-mobile="nav-settings"]',
        popover: {
          title: 'Settings',
          description: 'Tap Settings at the bottom of the screen.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="settings-facility-form"]',
        popover: {
          title: 'Facility details',
          description: 'Name, payment type, and contact info.',
        },
      },
      {
        element: '[data-tour="settings-working-hours"]',
        popover: {
          title: 'Working hours',
          description: 'Pick the days and times your facility is open.',
        },
      },
    ],
  },

  'bookkeeper-scan-logs': {
    id: 'bookkeeper-scan-logs',
    title: 'Scanning Daily Logs',
    desktop: [
      {
        element: '[data-tour="nav-daily-log"]',
        popover: {
          title: 'Daily Log',
          description: 'Scanning happens from the daily log page.',
          side: 'right',
        },
      },
      {
        element: '[data-tour="daily-log-scan-sheet"]',
        popover: {
          title: 'Upload paper logs',
          description: 'Click here to upload photos or PDFs of handwritten log sheets.',
          side: 'left',
        },
      },
      {
        element: '[data-tour="daily-log-entry-row"]',
        popover: {
          title: 'Review entries',
          description: 'After OCR runs, every row appears here. Edit any field that looks off.',
        },
      },
      {
        element: '[data-tour="daily-log-finalize-button"]',
        popover: {
          title: 'Finalize',
          description: 'When everything looks right, finalize to lock and send invoices.',
          side: 'left',
        },
      },
    ],
    mobile: [
      {
        element: '[data-tour-mobile="nav-daily-log"]',
        popover: {
          title: 'Daily Log',
          description: 'Tap Log at the bottom.',
          side: 'top',
        },
      },
      {
        element: '[data-tour-mobile="daily-log-scan-sheet"]',
        popover: {
          title: 'Scan log sheets',
          description: 'Take a photo or upload a PDF — OCR fills the entries for you.',
        },
      },
      {
        element: '[data-tour="daily-log-entry-row"]',
        popover: {
          title: 'Review',
          description: 'Tap any row to fix a misread service or price.',
        },
      },
      {
        element: '[data-tour-mobile="daily-log-finalize-button"]',
        popover: {
          title: 'Finalize',
          description: 'Lock the day and send invoices.',
        },
      },
    ],
  },
}

// ────────────────────────────────────────────────────────────────────────────
// PUBLIC ENTRY POINT
// ────────────────────────────────────────────────────────────────────────────

export async function startTour(tourName: string): Promise<void> {
  const def = TOUR_DEFINITIONS[tourName]
  if (!def) {
    console.warn(`[help] No tour definition for "${tourName}"`)
    return
  }

  // Dynamic import keeps driver.js out of the global bundle.
  const { driver } = await import('driver.js')

  const steps = isMobile() ? def.mobile : def.desktop
  if (!steps.length) {
    console.warn(`[help] Tour "${tourName}" has no steps for this device`)
    return
  }

  driver({ ...driverDefaults, steps }).drive()
}
