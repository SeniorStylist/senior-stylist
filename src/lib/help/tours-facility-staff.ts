import type { ScriptedTour } from './scripted-tour-types'

// Phase 13-Tutorial Batch 3 — interactive scripted facility-staff tours.
// 'click' steps wait for the user's real click; 'type' steps auto-fill a field.
// Residents tour creates a real is_demo=true resident through the form (no
// pre-seeding). Scheduling tours need seeded demo data (Mrs. Smith + Wash & Set)
// so the booking modal has someone to book — launched via seedAndStart.
export const FACILITY_STAFF_TOURS: ScriptedTour[] = [
  {
    id: 'scripted-facility-staff-residents',
    title: 'Add a Resident',
    scenarioSummary: 'Add a new resident to your facility',
    platform: 'desktop',
    role: 'facility_staff',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="residents-table"]',
        route: '/residents',
        title: 'This is your Residents list.',
        description:
          "Everyone at your facility lives here. Let's add a new resident together.",
      },
      {
        type: 'click',
        selector: '[data-tour="residents-new-button"]',
        title: 'Click the + button',
        description: 'Click the + button to open the new-resident form.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="residents-add-name"]',
        typeValue: 'Eleanor Davis',
        title: 'Enter their name',
        description:
          "We typed a demo name. In practice, use the resident's full name. Click Next.",
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="residents-add-submit"]',
        title: 'Add the resident',
        description:
          "Click Add to save. This is a practice resident — it's auto-cleaned up after the tour.",
        placement: 'top',
      },
      {
        type: 'highlight',
        selector: '[data-tour="residents-table"]',
        title: 'Resident added!',
        description:
          'They now appear in your list. You can open their profile to add room number, POA contact, and notes. That\'s it!',
      },
    ],
    learnings: [
      'Found the Residents list',
      'Opened the new-resident form and entered a name',
      'Created the resident — ready to add more details',
    ],
  },

  {
    id: 'scripted-facility-staff-scheduling-desktop',
    title: 'Book an Appointment',
    scenarioSummary: 'Book Mrs. Smith for a Wash & Set tomorrow at 10am',
    platform: 'desktop',
    role: 'facility_staff',
    steps: [
      {
        type: 'click',
        selector: '[data-tour="calendar-time-grid"]',
        route: '/dashboard',
        title: "Let's book Mrs. Smith.",
        description: 'Click any open time slot on the calendar to start a new booking.',
      },
      {
        type: 'type',
        selector: '[data-tour="booking-modal-resident"]',
        typeValue: 'Smith',
        title: "We'll find Mrs. Smith",
        description:
          'We typed her name into the resident field. Her name appears just below — click Next.',
        placement: 'right',
      },
      {
        type: 'click',
        selector: '[data-tour="booking-modal-resident-option"]',
        title: 'Click Mrs. Smith',
        description: 'Click her name in the list to select her.',
        placement: 'right',
      },
      {
        type: 'type',
        selector: '[data-tour="booking-modal-service"]',
        typeValue: '{{wash-and-set}}',
        title: 'Wash & Set selected',
        description:
          'We picked Wash & Set — the price and time fill in automatically. Click Next.',
        placement: 'right',
      },
      {
        type: 'type',
        selector: '[data-tour="booking-modal-date"]',
        typeValue: '{{tomorrow-10am}}',
        title: 'Tomorrow at 10am',
        description: 'We set the date to tomorrow at 10am. A stylist is auto-assigned for you. Click Next.',
        placement: 'right',
      },
      {
        type: 'click',
        selector: '[data-tour="booking-modal-submit"]',
        title: 'Book it!',
        description:
          "Click Book Appointment to save. This is a practice booking — it won't affect the real schedule.",
        placement: 'top',
      },
    ],
    learnings: [
      'Opened the new-booking form from the calendar',
      'Searched for and selected Mrs. Smith',
      'Chose a service and date — a stylist was auto-assigned',
      'Saved the appointment',
    ],
  },

  {
    id: 'scripted-facility-staff-scheduling-mobile',
    title: 'Book an Appointment',
    scenarioSummary: 'Book Mrs. Smith for a Wash & Set tomorrow at 10am',
    platform: 'mobile',
    role: 'facility_staff',
    steps: [
      {
        type: 'click',
        selector: '[data-tour-mobile="dashboard-new-booking-fab"]',
        route: '/dashboard',
        title: "Let's book Mrs. Smith.",
        description: 'Tap the + button in the corner to start a new booking.',
      },
      {
        type: 'type',
        selector: '[data-tour="booking-modal-resident"]',
        typeValue: 'Smith',
        title: "We'll find Mrs. Smith",
        description:
          'We typed her name into the resident field. Her name appears just below — tap Next.',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="booking-modal-resident-option"]',
        title: 'Tap Mrs. Smith',
        description: 'Tap her name in the list to select her.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="booking-modal-service"]',
        typeValue: '{{wash-and-set}}',
        title: 'Wash & Set selected',
        description:
          'We picked Wash & Set — the price and time fill in automatically. Tap Next.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="booking-modal-date"]',
        typeValue: '{{tomorrow-10am}}',
        title: 'Tomorrow at 10am',
        description: 'We set the date to tomorrow at 10am. A stylist is auto-assigned for you. Tap Next.',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="booking-modal-submit"]',
        title: 'Book it!',
        description:
          "Tap Book Appointment to save. This is a practice booking — it won't affect the real schedule.",
        placement: 'top',
      },
    ],
    learnings: [
      'Opened the new-booking form',
      'Searched for and selected Mrs. Smith',
      'Chose a service and date — a stylist was auto-assigned',
      'Saved the appointment',
    ],
  },

  {
    id: 'scripted-facility-staff-signup-sheet',
    title: 'Use the Sign-Up Sheet',
    scenarioSummary: 'Log that Mrs. Smith wants a Wash & Set — no time slot needed',
    platform: 'desktop',
    role: 'facility_staff',
    steps: [
      {
        type: 'click',
        selector: '[data-tour="signup-sheet-button"]',
        route: '/dashboard',
        title: 'Open the Sign-Up Sheet',
        description:
          "When a resident asks for an appointment but you don't need to pick a time, log it here. Click to open it.",
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="signup-sheet-resident"]',
        typeValue: 'Smith',
        title: "Who's it for?",
        description:
          'We typed Mrs. Smith into the resident field. Her name appears just below — click Next.',
        placement: 'left',
      },
      {
        type: 'click',
        selector: '[data-tour="signup-sheet-resident-option"]',
        title: 'Pick Mrs. Smith',
        description: 'Click her name to select her.',
        placement: 'left',
      },
      {
        type: 'type',
        selector: '[data-tour="signup-sheet-service"]',
        typeValue: 'Wash',
        title: 'What service?',
        description: 'We searched for Wash & Set. Click it in the list next.',
        placement: 'left',
      },
      {
        type: 'click',
        selector: '[data-tour="signup-sheet-service-option"]',
        title: 'Pick Wash & Set',
        description: 'Click the service to select it.',
        placement: 'left',
      },
      {
        type: 'type',
        selector: '[data-tour="signup-sheet-preferred-date"]',
        typeValue: '{{tomorrow}}',
        title: 'Preferred date (optional)',
        description:
          'We set tomorrow. This helps us auto-assign the right stylist for that day. Add notes if you like, then click Next.',
        placement: 'left',
      },
      {
        type: 'click',
        selector: '[data-tour="signup-sheet-submit"]',
        title: 'Add to the sheet',
        description:
          "Click Add to Sheet. A stylist will pick a time and turn it into a real booking. This is a practice entry — it's auto-cleaned up.",
        placement: 'top',
      },
    ],
    learnings: [
      'Opened the Sign-Up Sheet from the dashboard',
      'Logged a resident, service, and preferred date',
      'Saved a request for a stylist to schedule later',
    ],
  },
]
