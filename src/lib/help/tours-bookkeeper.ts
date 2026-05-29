import type { ScriptedTour } from './scripted-tour-types'

// Phase 13-Tutorial Batch 3 — interactive scripted bookkeeper tour.
// The walk-in form needs an existing resident + service to fill, so this tour
// is launched via seedAndStart (Mrs. Smith + Wash & Set + Demo Sarah seeded).
// Creates a real is_demo=true booking through the walk-in form.
export const BOOKKEEPER_TOURS: ScriptedTour[] = [
  {
    id: 'scripted-bookkeeper-manual-entry',
    title: 'Add a Walk-in',
    scenarioSummary: 'Manually log a walk-in appointment for Mrs. Smith',
    platform: 'desktop',
    role: 'bookkeeper',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="daily-log-add-walkin"]',
        route: '/log',
        title: 'This is the Daily Log.',
        description:
          'When an appointment happens that isn\'t on the calendar, you can log it here by hand. Let\'s add one.',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="daily-log-add-walkin"]',
        title: 'Click "Add Walk-in"',
        description: 'Click to open the walk-in form.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="walkin-resident-search"]',
        typeValue: 'Smith',
        title: "We'll find Mrs. Smith",
        description:
          'We typed her name into the resident field. Her name appears just below — click Next.',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="walkin-resident-option"]',
        title: 'Click Mrs. Smith',
        description: 'Click her name in the list to select her.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="walkin-service-select"]',
        typeValue: '{{wash-and-set}}',
        title: 'Pick the service',
        description:
          'We selected Wash & Set. The time and stylist default to the current time and your first stylist. Click Next.',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="walkin-submit"]',
        title: 'Log it!',
        description:
          "Click Add walk-in to save. This is a practice entry — it won't affect real billing.",
        placement: 'top',
      },
    ],
    learnings: [
      'Found the walk-in entry in the Daily Log',
      'Selected a resident and service by hand',
      'Logged a completed appointment manually',
    ],
  },
]
