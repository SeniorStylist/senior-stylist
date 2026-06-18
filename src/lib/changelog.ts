export interface ChangelogEntry {
  version: string
  date: string // YYYY-MM-DD
  title: string
  items: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '14A',
    date: '2026-06-15',
    title: 'Family Portal Self-Signup & Coupons',
    items: [
      'Family members can now create their own portal accounts',
      'Welcome coupons for new signups',
      'Admin approval queue for new accounts',
    ],
  },
  {
    version: '13Z',
    date: '2026-05-17',
    title: 'Excel Export for Daily Logs',
    items: [
      'Export daily logs to Excel format matching the facility template',
      'Multi-facility export from Analytics',
      'Includes services, amounts, tips, and payment type',
    ],
  },
  {
    version: '12W',
    date: '2026-05-12',
    title: 'Peek Drawer',
    items: [
      'Quick-view resident and stylist profiles without leaving the page',
      'Available from daily log, billing, and calendar',
      'Shows recent visits, next appointment, and key stats',
    ],
  },
  {
    version: '12V',
    date: '2026-05-12',
    title: 'Command Palette',
    items: [
      'Search residents and stylists from anywhere in the app',
      'Quick navigate to any page with CMD+K',
      'Available for admins and bookkeepers',
    ],
  },
  {
    version: '12T',
    date: '2026-05-12',
    title: "Stylist Check-In & Day Rescheduler",
    items: [
      "Stylists tap \"I'm Here\" when they arrive late",
      'Auto-shifts all bookings by the delay amount',
      'Available on the dashboard when you have bookings today',
    ],
  },
]

/** Date string (YYYY-MM-DD) of the newest changelog entry. */
export const NEWEST_CHANGELOG_DATE: string = CHANGELOG[0].date
