import type { ScriptedTour } from './scripted-tour-types'

export const STYLIST_MOBILE_TOURS: ScriptedTour[] = [
  {
    id: 'scripted-stylist-getting-started-mobile',
    title: 'Getting Started',
    scenarioSummary: 'A quick tour of your home screen and how to navigate',
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour-mobile="mobile-nav-calendar"]',
        title: "Welcome! This is your Calendar tab.",
        description: "Every morning, tap here to see your schedule for the day. Your appointments, times, and residents are all right here.",
      },
      {
        type: 'highlight',
        selector: '[data-tour-mobile="mobile-nav-log"]',
        title: "Daily Log",
        description: "After each appointment, tap the Daily Log to confirm the service and mark payment. This is how your day gets recorded.",
      },
      {
        type: 'highlight',
        selector: '[data-tour-mobile="stylist-mobile-booking-list"]',
        title: "Today's appointments",
        description: "These are your bookings for today. Tap any card to see details, make notes, or update the status.",
      },
      {
        type: 'highlight',
        selector: '[data-tour-mobile="checkin-button"]',
        title: "'I'm Here' check-in",
        description: "When you arrive at the facility, tap this button. If you're running late, Senior Stylist can automatically shift your appointments to keep things running smoothly.",
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour-mobile="mobile-nav-account"]',
        title: "My Account",
        description: "Tap here to see your schedule, update your hours, and manage your profile. That's it — you're ready to go!",
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
    scenarioSummary: "Schedule Mrs. Smith for a Wash & Set tomorrow at 10am",
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour-mobile="mobile-nav-calendar"]',
        title: "Let's book Mrs. Smith for tomorrow.",
        description: "First, tap the Calendar tab to get to your schedule.",
      },
      {
        type: 'highlight',
        selector: '[data-tour="dashboard-new-booking-fab"]',
        title: "Tap the + button",
        description: "See the + button in the corner? That's how you add a new booking. Tap it now.",
      },
      {
        type: 'highlight',
        selector: '[data-tour="booking-modal-resident"]',
        title: "Search for Mrs. Smith",
        description: "Type 'Smith' in the resident field. You'll see Mrs. Margaret Smith appear — tap her name to select.",
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour="booking-modal-service"]',
        title: "Pick Wash & Set",
        description: "Choose 'Wash & Set (Demo)' from the service list. The price and duration fill in automatically.",
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour="booking-modal-date"]',
        title: "Set the date to tomorrow",
        description: "Tap the date field and pick tomorrow. The time is already set to 10am — perfect.",
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour="booking-modal-submit"]',
        title: "Save the booking",
        description: "Great! Tap 'Book Appointment' to save. Mrs. Smith's Wash & Set is on your calendar. Remember — this is just practice, so nothing is actually saved.",
        placement: 'top',
      },
    ],
    learnings: [
      'Found the + booking button',
      "Searched for and selected Mrs. Smith",
      'Chose a service and set the date',
      'Saved the appointment',
    ],
  },

  {
    id: 'scripted-stylist-daily-log-mobile',
    title: 'Daily Log',
    scenarioSummary: "Review today's bookings and mark Mrs. Smith as paid",
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour-mobile="mobile-nav-log"]',
        title: "Let's visit the Daily Log.",
        description: "After your appointments, the Daily Log is where you confirm everything and mark payments. Tap it now.",
      },
      {
        type: 'highlight',
        selector: '[data-tour="log-booking-card"]',
        title: "Here are today's bookings",
        description: "Each card shows a resident's appointment. You can see the time, service, and payment status at a glance.",
      },
      {
        type: 'highlight',
        selector: '[data-tour="log-booking-edit"]',
        title: "Tap to update Mrs. Smith's payment",
        description: "Find Mrs. Smith's card and tap the edit icon. You can change the payment status to 'Paid' once she's settled up.",
      },
      {
        type: 'highlight',
        selector: '[data-tour="log-payment-status"]',
        title: "Mark as Paid",
        description: "Change the dropdown to 'Paid'. This records the payment in the system — your bookkeeper will see it reflected in billing.",
        placement: 'top',
      },
      {
        type: 'highlight',
        selector: '[data-tour="log-finalize-day"]',
        title: "Finalize your day",
        description: "At the end of the day, tap 'Finalize Day' to lock in your log. This tells the facility the day is complete. Nice work!",
        placement: 'top',
      },
    ],
    learnings: [
      "Navigated to the Daily Log",
      "Viewed today's appointment cards",
      "Marked a payment as Paid",
      "Learned how to finalize the day",
    ],
  },

  {
    id: 'scripted-stylist-checkin-mobile',
    title: "I'm Here Check-In",
    scenarioSummary: "Check in when you arrive and see the reschedule option",
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="checkin-banner"]',
        title: "Good morning! The check-in banner is here.",
        description: "When you arrive at the facility, you'll see this banner at the top of your screen. It only appears on days when you have appointments.",
      },
      {
        type: 'highlight',
        selector: '[data-tour="checkin-button"]',
        title: "Tap 'I'm Here →'",
        description: "Tap this button to record your arrival. Senior Stylist notes the time and compares it to your first appointment.",
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour="reschedule-sheet"]',
        title: "Running late? This sheet appears.",
        description: "If you arrive after your first appointment was supposed to start, you'll see this screen. It lets you push all your remaining bookings forward so residents know the updated times.",
        placement: 'top',
      },
      {
        type: 'highlight',
        selector: '[data-tour="reschedule-confirm"]',
        title: "Reschedule or skip",
        description: "Tap 'Shift All Appointments' to update the times, or 'Keep Original Times' if you prefer. Either way, the check-in is recorded and you're good to go.",
        placement: 'top',
      },
    ],
    learnings: [
      "Found the arrival check-in banner",
      "Learned how to record your arrival time",
      "Discovered the automatic reschedule feature for late arrivals",
    ],
  },

  {
    id: 'scripted-stylist-finalize-day-mobile',
    title: 'Finalize Your Day',
    scenarioSummary: "Walk through the end-of-day workflow to close out the log",
    platform: 'mobile',
    role: 'stylist',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour-mobile="mobile-nav-log"]',
        title: "Head to the Daily Log.",
        description: "At the end of each day, the Daily Log is your last stop. Let's walk through wrapping up the day.",
      },
      {
        type: 'highlight',
        selector: '[data-tour="log-booking-card"]',
        title: "Review each booking",
        description: "Before finalizing, take a moment to check each card. Payment status, notes, any cancellations — make sure everything looks right.",
      },
      {
        type: 'highlight',
        selector: '[data-tour="log-notes-field"]',
        title: "Add any notes",
        description: "If anything unusual happened — a resident cancelled last minute, or needed extra time — jot it here. Your notes stay with the log.",
        placement: 'top',
      },
      {
        type: 'highlight',
        selector: '[data-tour="log-finalize-day"]',
        title: "Tap Finalize Day",
        description: "This is the final step. Tapping 'Finalize Day' locks the log for this date. Your admin and bookkeeper can now see your completed day. Great work!",
        placement: 'top',
      },
    ],
    learnings: [
      "Reviewed all bookings before closing out",
      "Added notes to the daily log",
      "Finalized the day to lock in the record",
    ],
  },
]
