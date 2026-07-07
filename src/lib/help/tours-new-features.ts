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
]
