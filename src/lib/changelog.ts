export interface ChangelogEntry {
  version: string
  date: string // ISO YYYY-MM-DD
  title: string
  items: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '3.9',
    date: '2026-07-12',
    title: 'Smoother & Smarter',
    items: [
      'Fixed the Master Admin page error — the access-request approval queue works again',
      'Booking and walk-in forms pre-select each resident\'s usual service; one-tap tip presets',
      'Closing a half-filled booking or sign-up form now asks before discarding your typing',
      'Family portal: a big "Pay" button stays at your thumb when a balance is due, and the request form\'s submit button is always in reach',
      'Getting-started checklist gives you credit for signing up — you never start at 0%',
    ],
  },
  {
    version: '3.8',
    date: '2026-07-09',
    title: 'Faster Everywhere',
    items: [
      'Every page checks your login locally instead of calling out to the auth server — navigation is noticeably snappier',
      'Dashboard loads with one combined data request instead of seven separate ones',
      'Fonts now load from our own servers — no more waiting on Google Fonts',
      'Big screens (reports, booking form, scan review) download only when you open them',
      'Stylists can mark a visit done AND paid right on the home screen, with a one-tap jump to the Daily Log',
    ],
  },
  {
    version: '3.7',
    date: '2026-07-07',
    title: 'Speed',
    items: [
      'Much faster app and site: background page-priming trimmed way down so it never competes with your taps',
      'Bottom tabs always switch — if a page is slow to respond, the app forces it through within seconds',
    ],
  },
  {
    version: '3.6',
    date: '2026-07-07',
    title: 'Bookkeeper Fixes & Self-Healing Updates',
    items: [
      'Fixed "Invalid input" blocking every daily-log edit (date, stylist, service, room, amount, tips)',
      'Switching facilities now actually switches the whole page, not just the label',
      'New facility picker right in the Daily Log header — search by name or F-code',
      'After an app update, open tabs refresh themselves instead of showing a chunk error',
    ],
  },
  {
    version: '3.5',
    date: '2026-07-07',
    title: 'Stability & Tutorial Fixes',
    items: [
      'Fixed the outage: background page-warming no longer overloads the database',
      'Tutorials now exit demo mode instantly — on finish, on cancel, even if you close the tab mid-tour',
      "What's New opens as a proper dialog; fixed clipped toolbars on the dashboard",
      'Tutorials work at any time of day and auto-skip a step that fails to load instead of freezing',
    ],
  },
  {
    version: '3.4',
    date: '2026-07-07',
    title: 'Accessibility & Synced Tabs',
    items: [
      'Big accessibility pass for family members: screen-reader labels, announced errors, Spanish pronunciation, higher-contrast helper text',
      'Dialogs now keep keyboard focus inside and return it when closed',
      'Your customized bottom tabs now follow you across devices',
    ],
  },
  {
    version: '3.3',
    date: '2026-07-07',
    title: 'Full Offline Mode',
    items: [
      'Navigate between your pages while offline — recently visited screens keep working',
      'Photos taken offline upload automatically when wifi returns',
      'Walk-ins for brand-new residents now work offline too',
      'Cached pages are private per login and wiped on sign-out (shared-device safe)',
    ],
  },
  {
    version: '3.2',
    date: '2026-07-07',
    title: 'Mobile Comfort Pass & Offline Mode',
    items: [
      'Customize your bottom tabs — pick your 5 most-used, everything else lives under More',
      'Works offline: your schedule and daily log show the last saved copy, and edits sync when wifi returns',
      'Offline banner shows pending changes and confirms when everything synced',
      'Bigger, easier tap targets across the app; dialogs open as bottom sheets on phones',
      'Fixed overlapping buttons and cramped headers on small screens',
    ],
  },
  {
    version: '3.1',
    date: '2026-07-07',
    title: 'Smart Scheduling, Health Scores & Spanish Portal',
    items: [
      'Family portal is now fully bilingual — EN/ES toggle in the header',
      '"Due for a visit" panel suggests residents based on their own visit rhythm',
      'Copy an entire salon day to a new date; print a weekly schedule',
      'Facility health score on Master Admin; invoice aging strip on Billing',
      'Booking style photos — snap from the daily log, share to the family portal',
      'Stylists see a room-to-room route strip and a monthly earnings forecast',
      'Monthly statement email automation and appointment-reminder texts for families',
      'Prepay packages on the family portal (e.g. 3 × Wash & Set)',
    ],
  },
  {
    version: '3.0',
    date: '2026-07-07',
    title: 'Notifications, Waitlist & Payment Safeguards',
    items: [
      'In-app notification inbox with a bell in the header',
      'Cancellation waitlist — freed slots automatically alert the office',
      'Payment safeguards: auto-charge caps, double-pay protection, refunds, autopay consent emails',
      'Weekly owner digest email and resident birthday reminders',
      'Offline write-queue for spotty facility Wi-Fi; Tap to Pay groundwork',
    ],
  },
  {
    version: '2.9',
    date: '2026-06-22',
    title: 'Log Sheet History & Payment Types',
    items: [
      'Bookkeepers can now view, rename, move, and roll back imported OCR log sheets from the Daily Log page',
      'Payment type now supports free-text (Cash, Check, Card, ACH, or custom) on all booking edits',
      'Bookkeeper log editing expanded: tips, payment method, date, resident, service, and delete',
    ],
  },
  {
    version: '2.8',
    date: '2026-06-17',
    title: 'OCR & Price Sheet Improvements',
    items: [
      'Bulk price sheet scanner now auto-detects facility from document content',
      'OCR review shows a proper dropdown for stylist selection (was invisible on most browsers)',
      'Fixed blank imports caused by empty service names in partial rows',
      'Send confirmation dialog before one-click emails and texts',
    ],
  },
  {
    version: '2.7',
    date: '2026-06-15',
    title: 'Family Portal Self-Signup & Authorization Hardening',
    items: [
      'Families can now request portal access directly from the facility login page',
      'Admins review and approve claim requests in Settings → Family Portal',
      'Welcome coupons automatically issued on first portal access',
      'Full authorization audit — closed cross-facility data leaks',
    ],
  },
  {
    version: '2.6',
    date: '2026-06-12',
    title: 'QuickBooks Import Suite & Billing Polish',
    items: [
      'Step 5 unapplied credits importer — import QB Customer Balance Detail CSV',
      'Batch memo scan: match check memo text to residents across all facilities at once',
      'Monthly billing view with by-resident / by-day toggle and CSV export',
      'Check image lightbox and "Match memo" assistant',
    ],
  },
  {
    version: '2.5',
    date: '2026-05-31',
    title: 'Interactive Scripted Tutorials',
    items: [
      'All 30+ help tours are now fully interactive — click through real workflows with demo data',
      'Mobile-specific tour variants for every role',
      'Onboarding checklist widget on the dashboard tracks your progress',
    ],
  },
  {
    version: '2.4',
    date: '2026-05-13',
    title: 'Mobile Layout & Tour Overhaul',
    items: [
      'Fixed iOS Safari layout shell — no more gap under the bottom nav',
      'Tour engine now uses SPA navigation — no page reloads between steps',
      'Stylist check-in with smart day-rescheduling (Phase 12T)',
      'CMD+K command palette for admins (Phase 12V)',
      'Resident and stylist peek drawer (Phase 12W)',
    ],
  },
  {
    version: '2.3',
    date: '2026-05-04',
    title: 'Service Log Import & Reconciliation',
    items: [
      'Import service log XLSX files directly into bookings with fuzzy facility/service matching',
      'Reconciliation queue for bookings that need a service linked',
      'Batch rollback of an entire import with one click',
      'Historical bookings show an "H" badge in the calendar and daily log',
    ],
  },
]

/** ISO date string of the newest entry. */
export const LATEST_CHANGELOG_DATE = CHANGELOG[0]?.date ?? '2020-01-01'
