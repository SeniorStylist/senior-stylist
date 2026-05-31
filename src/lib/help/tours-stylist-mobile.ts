import type { ScriptedTour } from './scripted-tour-types'

export const STYLIST_MOBILE_TOURS: ScriptedTour[] = [
  {
    id: 'scripted-stylist-getting-started-mobile',
    title: 'Getting Started',
    scenarioSummary: 'Quick tour of your home screen',
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour-mobile="nav-calendar"]',
        route: '/dashboard',
        title: 'Your Calendar tab',
        description: 'Tap here each morning to see your schedule — appointments, times, and residents.',
      },
      {
        type: 'highlight',
        selector: '[data-tour-mobile="stylist-mobile-booking-list"]',
        title: "Today's appointments",
        description: "Your bookings for today. Tap any card to view details or add notes.",
      },
      {
        type: 'highlight',
        selector: '[data-tour-mobile="nav-daily-log"]',
        title: 'Daily Log',
        description: 'After each visit, confirm the service and mark payment here.',
      },
      {
        type: 'highlight',
        selector: '[data-tour="checkin-banner"]',
        title: "Check-in banner",
        description: "Tap this when you arrive. Running late? Your appointments shift automatically.",
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour-mobile="nav-my-account"]',
        title: 'My Account',
        description: 'Your schedule, hours, and profile. All set!',
        placement: 'top',
      },
    ],
    learnings: [
      'Found the Calendar for your daily schedule',
      'Found the Daily Log for confirming visits',
      'Learned about the check-in banner',
    ],
  },

  {
    id: 'scripted-stylist-calendar-mobile',
    title: 'Book an Appointment',
    scenarioSummary: 'Book Mrs. Smith for a Wash & Set tomorrow at 10am',
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'click',
        selector: '[data-tour-mobile="dashboard-new-booking-fab"]',
        route: '/dashboard',
        title: 'Start a new booking',
        description: 'Tap the + button to open the booking form.',
      },
      {
        type: 'type',
        selector: '[data-tour="booking-modal-resident"]',
        typeValue: 'Smith',
        title: 'Resident filled in',
        description: 'We typed "Smith" — Mrs. Smith appears below. Tap Next.',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="booking-modal-resident-option"]',
        title: 'Tap Mrs. Smith',
        description: 'Tap her name to select her.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="booking-modal-service"]',
        typeValue: '{{wash-and-set}}',
        title: 'Service selected',
        description: 'Wash & Set is set. Price and duration filled automatically. Tap Next.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="booking-modal-date"]',
        typeValue: '{{tomorrow-10am}}',
        title: 'Date and time set',
        description: 'Tomorrow at 10am. Tap Next.',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="booking-modal-submit"]',
        title: 'Save the booking',
        description: 'Tap Book Appointment. A demo booking is created — not on your real schedule.',
        placement: 'top',
      },
    ],
    learnings: [
      'Opened the booking form',
      'Selected a resident, service, and time',
      'Saved the appointment',
    ],
  },

  {
    id: 'scripted-stylist-daily-log-mobile',
    title: 'Daily Log',
    scenarioSummary: 'Mark Mrs. Smith as paid and finalize the day',
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="daily-log-entry-row"]',
        route: '/log',
        title: 'Your Daily Log',
        description: "Mrs. Smith's appointment is here. Confirm visits and mark payment after each one.",
      },
      {
        type: 'click',
        selector: '[data-tour="log-payment-toggle"]',
        title: 'Tap the payment badge',
        description: 'Tap the $ badge to mark Mrs. Smith as paid.',
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour="log-payment-toggle"]',
        title: 'Marked paid',
        description: 'Billing updates automatically. Your bookkeeper sees this in real time.',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="daily-log-finalize-button"]',
        title: 'Finalize the day',
        description: 'Tap Finalize Day to lock your log. Your admin and bookkeeper can see your completed day.',
        placement: 'top',
      },
    ],
    learnings: [
      'Found the appointment in the Daily Log',
      'Marked payment as paid',
      'Finalized the day',
    ],
  },

  {
    id: 'scripted-stylist-checkin-mobile',
    title: "I'm Here Check-In",
    scenarioSummary: 'Check in when you arrive at the facility',
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="checkin-banner"]',
        route: '/dashboard',
        title: 'Check-in banner',
        description: 'Appears on days you have appointments. Tap it when you arrive.',
      },
      {
        type: 'click',
        selector: '[data-tour="checkin-button"]',
        title: "Tap 'I'm Here →'",
        description: 'Records your arrival time against your first appointment.',
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour-mobile="stylist-mobile-booking-list"]',
        title: "You're checked in",
        description: 'Arrived late? We offer to shift your remaining appointments forward automatically.',
      },
    ],
    learnings: [
      'Found the check-in banner',
      'Recorded your arrival',
      'Learned about automatic late-arrival rescheduling',
    ],
  },

  {
    id: 'scripted-stylist-finalize-day-mobile',
    title: 'Finalize Your Day',
    scenarioSummary: 'Close out the daily log',
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="daily-log-entry-row"]',
        route: '/log',
        title: 'Review before closing',
        description: 'Check payment status, notes, and any cancellations before you finalize.',
      },
      {
        type: 'click',
        selector: '[data-tour="daily-log-finalize-button"]',
        title: 'Tap Finalize Day',
        description: "Locks today's log. Your admin and bookkeeper can now see your completed day.",
        placement: 'top',
      },
    ],
    learnings: [
      'Reviewed bookings before closing out',
      'Finalized the day',
    ],
  },
]
