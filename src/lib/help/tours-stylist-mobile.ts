import type { ScriptedTour } from './scripted-tour-types'

// Phase 13 — interactive scripted stylist tours (mobile). Action ('click') steps
// wait for the user's real tap; 'type' steps auto-fill a field (the popover shows
// Next). {{slug}} placeholders in typeValue resolve to seeded demo-record IDs.
export const STYLIST_MOBILE_TOURS: ScriptedTour[] = [
  {
    id: 'scripted-stylist-getting-started-mobile',
    title: 'Getting Started',
    scenarioSummary: 'A quick tour of your home screen and how to get around',
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour-mobile="nav-calendar"]',
        route: '/dashboard',
        title: "Welcome! This is your Calendar tab.",
        description: "Every morning, tap here to see your schedule for the day — your appointments, times, and residents.",
      },
      {
        type: 'highlight',
        selector: '[data-tour-mobile="stylist-mobile-booking-list"]',
        title: "Today's appointments",
        description: "These are your bookings for today. Tap any card to see details or make notes.",
      },
      {
        type: 'highlight',
        selector: '[data-tour-mobile="nav-daily-log"]',
        title: "Daily Log",
        description: "After each appointment, the Daily Log is where you confirm the service and mark payment.",
      },
      {
        type: 'highlight',
        selector: '[data-tour="checkin-banner"]',
        title: "'I'm Here' check-in",
        description: "When you arrive, tap this banner to check in. If you're running late, we can shift your day automatically.",
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour-mobile="nav-my-account"]',
        title: "My Account",
        description: "Tap here to see your schedule, update your hours, and manage your profile. That's it — you're ready!",
        placement: 'top',
      },
    ],
    learnings: [
      'Found the Calendar tab for your daily schedule',
      'Found the Daily Log for confirming appointments',
      'Learned about the check-in feature',
    ],
  },

  {
    id: 'scripted-stylist-calendar-mobile',
    title: 'Book an Appointment',
    scenarioSummary: "Book Mrs. Smith for a Wash & Set tomorrow at 10am",
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'click',
        selector: '[data-tour-mobile="dashboard-new-booking-fab"]',
        route: '/dashboard',
        title: "Let's book Mrs. Smith.",
        description: "Tap the + button in the corner to start a new booking.",
      },
      {
        type: 'type',
        selector: '[data-tour="booking-modal-resident"]',
        typeValue: 'Smith',
        title: "We'll find Mrs. Smith",
        description: "We typed her name into the resident field for you. Her name will appear just below — tap Next.",
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="booking-modal-resident-option"]',
        title: "Tap Mrs. Smith",
        description: "Tap her name in the list to select her.",
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="booking-modal-service"]',
        typeValue: '{{wash-and-set}}',
        title: "Wash & Set selected",
        description: "We picked Wash & Set for you — the price and time fill in automatically. Tap Next.",
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="booking-modal-date"]',
        typeValue: '{{tomorrow-10am}}',
        title: "Tomorrow at 10am",
        description: "We set the date to tomorrow at 10am for you. Tap Next.",
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="booking-modal-submit"]',
        title: "Book it!",
        description: "Tap Book Appointment to save. This is a practice booking — it won't affect your real schedule.",
        placement: 'top',
      },
    ],
    learnings: [
      'Opened the new-booking form',
      "Searched for and selected Mrs. Smith",
      'Chose a service and set the date',
      'Saved the appointment',
    ],
  },

  {
    id: 'scripted-stylist-daily-log-mobile',
    title: 'Daily Log',
    scenarioSummary: "Mark Mrs. Smith as paid and finalize the day",
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="daily-log-entry-row"]',
        route: '/log',
        title: "This is your Daily Log.",
        description: "Here's Mrs. Smith's appointment for today. After each visit, you confirm it here and mark payment.",
      },
      {
        type: 'click',
        selector: '[data-tour="log-payment-toggle"]',
        title: "Tap the payment badge",
        description: "Tap the $ badge on Mrs. Smith's row to mark her as paid.",
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour="log-payment-toggle"]',
        title: "Marked paid!",
        description: "It now shows paid. Your bookkeeper sees this reflected in billing automatically.",
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="daily-log-finalize-button"]',
        title: "Finalize your day",
        description: "At the end of the day, tap Finalize Day to lock in your log. Nice work!",
        placement: 'top',
      },
    ],
    learnings: [
      "Found today's appointment in the Daily Log",
      "Marked a payment as paid",
      "Finalized the day to lock in the record",
    ],
  },

  {
    id: 'scripted-stylist-checkin-mobile',
    title: "I'm Here Check-In",
    scenarioSummary: "Check in when you arrive at the facility",
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="checkin-banner"]',
        route: '/dashboard',
        title: "Good morning! Here's your check-in.",
        description: "When you arrive, you'll see this banner. It only appears on days you have appointments.",
      },
      {
        type: 'click',
        selector: '[data-tour="checkin-button"]',
        title: "Tap 'I'm Here →'",
        description: "Tap to record your arrival. We note the time and compare it to your first appointment.",
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour-mobile="stylist-mobile-booking-list"]',
        title: "You're checked in!",
        description: "If you'd arrived late, we'd offer to shift your remaining appointments forward so residents know the new times. That's it!",
      },
    ],
    learnings: [
      "Found the arrival check-in banner",
      "Recorded your arrival time",
      "Learned about automatic rescheduling for late arrivals",
    ],
  },

  {
    id: 'scripted-stylist-finalize-day-mobile',
    title: 'Finalize Your Day',
    scenarioSummary: "Walk through closing out the daily log",
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="daily-log-entry-row"]',
        route: '/log',
        title: "End-of-day wrap up.",
        description: "Before finalizing, glance over each appointment — payment status, notes, any cancellations.",
      },
      {
        type: 'click',
        selector: '[data-tour="daily-log-finalize-button"]',
        title: "Tap Finalize Day",
        description: "This locks the log for today. Your admin and bookkeeper can now see your completed day. Great work!",
        placement: 'top',
      },
    ],
    learnings: [
      "Reviewed bookings before closing out",
      "Finalized the day to lock in the record",
    ],
  },
]
