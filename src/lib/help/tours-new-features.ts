// Phase 15 (2026-07-07) — tours for the feature wave: notifications, waitlist,
// birthdays, card-on-file payments, signage, and time-off approval. Mostly
// highlight/info tours (the payment + detail-page surfaces are dynamic-route or
// data-conditional, so those steps use selector '' per the house rules).

import type { ScriptedTour } from './scripted-tour-types'

export const NEW_FEATURE_TOURS: ScriptedTour[] = [
  {
    id: 'scripted-admin-notifications',
    title: 'Your Notification Inbox',
    scenarioSummary: 'Where booking, payment, and schedule alerts land',
    platform: 'desktop',
    role: 'admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="notification-bell"]',
        route: '/dashboard',
        title: 'The bell is your inbox',
        description: 'New bookings, cancellations, failed payments, birthdays, and waitlist matches all land here.',
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Unread count',
        description: 'The burgundy badge shows unread alerts. Click one to jump to the right page — it marks itself read.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Push too',
        description: 'The same alerts arrive as push notifications on your phone when push is enabled in My Account.',
      },
    ],
    learnings: [
      'Found the notification bell',
      'Alerts link straight to the right page',
      'Push mirrors the inbox on your phone',
    ],
  },

  {
    id: 'scripted-admin-waitlist',
    title: 'The Cancellation Waitlist',
    scenarioSummary: 'Fill freed slots with residents who are waiting',
    platform: 'desktop',
    role: 'admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="waitlist-panel"]',
        route: '/dashboard',
        title: 'Residents waiting for a slot',
        description: 'Anyone who wants an earlier appointment lives here, with the date window they can take.',
      },
      {
        type: 'highlight',
        selector: '[data-tour="waitlist-add"]',
        title: 'Add someone anytime',
        description: 'Or add straight from a cancellation — the cancel screen offers "Add to waitlist".',
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Cancellations match automatically',
        description: 'When a booking is cancelled inside someone’s window, you get a bell alert: "Slot opened — N residents waiting".',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Book → fills the slot',
        description: 'Book → opens the booking form prefilled with the resident and service. One save books it and clears the entry.',
      },
    ],
    learnings: [
      'Found the waitlist panel',
      'Cancellations alert you when a waiting resident matches',
      'Book → converts an entry into a real appointment',
    ],
  },

  {
    id: 'scripted-admin-birthdays',
    title: 'Resident Birthdays',
    scenarioSummary: 'Never miss a resident’s special day',
    platform: 'desktop',
    role: 'admin',
    steps: [
      {
        type: 'highlight',
        selector: '',
        route: '/residents',
        title: 'Add birthdays on the profile',
        description: 'Open any resident, click Edit, and fill the Birthday field. That’s the only setup.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'The dashboard shows who’s next',
        description: 'An Upcoming Birthdays card appears on your dashboard for the next 7 days.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Day-of reminders',
        description: 'On the day, admins get a bell alert and the morning digest email lists the birthdays — perfect for a special touch at their appointment.',
      },
    ],
    learnings: [
      'Birthday lives on the resident profile',
      'Dashboard card shows the next 7 days',
      'Day-of alerts + morning digest email',
    ],
  },

  {
    id: 'scripted-admin-payments-cof',
    title: 'Cards on File & Payments',
    scenarioSummary: 'Saved cards, automatic payment, and refunds',
    platform: 'desktop',
    role: 'admin',
    steps: [
      {
        type: 'highlight',
        selector: '',
        route: '/residents',
        title: 'Cards live on the resident profile',
        description: 'Open a resident to save a card (entered securely via Stripe — the site never stores card numbers).',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Automatic payment',
        description: 'Turn on autopay per resident. The family is emailed when it’s switched on, and gets a receipt for every automatic charge.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Built-in safety rails',
        description: 'Balances are re-checked before every charge (no double-pays), automatic charges are capped, and failures alert you here with a payment link sent to the family.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Refunds in one click',
        description: 'Mistaken card charge? The resident’s ledger has a Refund button — money goes back to the card and the ledger updates itself.',
      },
    ],
    learnings: [
      'Cards + autopay live on the resident profile',
      'Families are notified — no surprise charges',
      'Refunds happen right in the ledger',
    ],
  },

  {
    id: 'scripted-admin-signage',
    title: 'Print Salon Signage',
    scenarioSummary: 'Salon-day posters and price lists in two clicks',
    platform: 'desktop',
    role: 'admin',
    steps: [
      {
        type: 'highlight',
        selector: '',
        route: '/signage',
        title: 'Pick a template',
        description: 'Salon Day, Now Open, Price List, Welcome, and holiday signs — each branded with your facility name.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Edit and preview live',
        description: 'Change the text on the left and the poster preview updates instantly.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Print or save as PDF',
        description: 'Print / Save PDF opens the sign ready to print. On the app it opens the share sheet instead.',
      },
    ],
    learnings: [
      'Templates for salon days, prices, and holidays',
      'Live preview while you edit',
      'Print or save as PDF',
    ],
  },

  {
    id: 'scripted-admin-coverage-approval',
    title: 'Time-Off Approval',
    scenarioSummary: 'Approve requests and find coverage in one flow',
    platform: 'desktop',
    role: 'admin',
    steps: [
      {
        type: 'highlight',
        selector: '',
        route: '/dashboard',
        title: 'Requests arrive on your dashboard',
        description: 'When a stylist requests time off you get an email + bell alert, and the request appears in the Coverage Requests panel.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Approve or deny',
        description: 'Approve moves it to "finding coverage"; deny (with an optional reason) emails the stylist either way.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Pick a substitute',
        description: 'After approving, the same row shows available substitutes — your facility’s stylists first, then the franchise pool.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'The stylist stays in the loop',
        description: 'Their My Account page shows the request status: pending, approved, covered, or denied with your reason.',
      },
    ],
    learnings: [
      'Time-off requests need your approval first',
      'Approve → substitute picker in the same row',
      'The stylist sees every status change',
    ],
  },
  {
    id: 'scripted-admin-photos',
    title: 'Booking Photos & Style Gallery',
    scenarioSummary: 'Capture finished styles and share them with families',
    platform: 'desktop',
    role: 'admin',
    steps: [
      {
        type: 'highlight',
        selector: '',
        route: '/log',
        title: 'Snap it on the daily log',
        description: 'After marking an appointment Done, the camera button saves a photo of the finished style — with an optional caption.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Share with the family',
        description: 'Tick "Share with the family" and the photo appears on that appointment in their portal — a little delight after every visit.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'The style gallery',
        description: 'Every photo lands in the resident\'s Style Gallery on their profile ("the cut she likes"). Stylists see the latest three in the peek drawer.',
      },
    ],
    learnings: [
      'Camera button on completed daily-log rows',
      'Shared photos show in the family portal',
      'The gallery remembers each resident\'s look',
    ],
  },

  {
    id: 'scripted-admin-scheduling-tools',
    title: 'Scheduling Power Tools',
    scenarioSummary: 'Copy salon days, print the week, fill overdue visits',
    platform: 'desktop',
    role: 'admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="copy-day-button"]',
        route: '/dashboard',
        title: 'Copy a salon day',
        description: 'Re-book everyone from a past day onto a new date at the same times. Conflicts are skipped, never double-booked.',
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour="print-week-button"]',
        title: 'Print the week',
        description: 'A clean printout of the week\'s appointments — time, resident, room, service, stylist — grouped by day.',
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Due for a visit',
        description: 'The dashboard suggests residents who are overdue based on their own visit rhythm. Book → prefills their usual service.',
      },
    ],
    learnings: [
      'Copy day re-books a whole salon day',
      'Print week for the front desk or floor staff',
      'Due-for-a-visit fills quiet days with overdue residents',
    ],
  },
  // Phase 21 — mobile variants: the desktop tours highlight elements that are
  // hidden md: on phones (waitlist panel, print week). Info-style steps keep
  // the feature discoverable on mobile and point to the full site.
  {
    id: 'scripted-admin-waitlist-mobile',
    title: 'Cancellation Waitlist',
    scenarioSummary: 'How the waitlist fills freed slots',
    platform: 'mobile',
    role: 'admin',
    steps: [
      {
        type: 'highlight',
        selector: '',
        route: '/dashboard',
        title: 'The waitlist',
        description: 'Residents who want an earlier slot go on the waitlist. When a booking is cancelled, the office is alerted if someone fits the freed time.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Adding someone',
        description: 'When you cancel a booking, tap "Add to waitlist" — or use the Waitlist panel on the desktop dashboard.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Manage on the full site',
        description: 'The Waitlist panel with one-tap booking lives on the desktop dashboard\u2019s right panel.',
      },
    ],
    learnings: ['What the waitlist does', 'Adding from a cancellation', 'Where to manage it'],
  },
  {
    id: 'scripted-admin-scheduling-tools-mobile',
    title: 'Scheduling Power Tools',
    scenarioSummary: 'Due-for-a-visit, copy day, and printable week',
    platform: 'mobile',
    role: 'admin',
    steps: [
      {
        type: 'highlight',
        selector: '',
        route: '/dashboard',
        title: 'Due for a visit',
        description: 'The dashboard suggests residents who are overdue based on their own visit rhythm — one tap books them.',
      },
      {
        type: 'highlight',
        selector: '[data-tour="copy-day-button"]',
        title: 'Copy a salon day',
        description: 'Re-book everyone from one day onto a new date at the same times — conflicts are skipped, never double-booked.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Print week (desktop)',
        description: 'A printable weekly schedule for the front desk lives on the desktop dashboard.',
      },
    ],
    learnings: ['Due-for-a-visit suggestions', 'Copy day', 'Printable week on desktop'],
  },

  // P46 — the assistant finally gets its own tour (the anchor existed since
  // P38 but nothing pointed at it).
  {
    id: 'scripted-meet-assistant',
    title: 'Meet Your AI Assistant',
    scenarioSummary: 'Ask anything, get things done, be walked through the app',
    platform: 'desktop',
    role: 'admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="assistant-button"]',
        route: '/dashboard',
        title: 'Your AI coworker lives here',
        description: 'Tap the sparkle anytime — ask about your day, your residents, or your numbers in plain English. Type or talk.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'It does things, too',
        description: 'Book, mark visits paid, add walk-ins, make signs and statements — every change shows a Confirm card first.',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'Say "show me how"',
        description: 'Ask "help me scan a sheet" and it walks you there with arrows on screen. Quick mode is fast; ✦ Smart thinks deeper.',
      },
    ],
    learnings: ['Where the assistant lives', 'Ask questions or give it work', 'Guided walks + Quick/Smart modes'],
  },
]
