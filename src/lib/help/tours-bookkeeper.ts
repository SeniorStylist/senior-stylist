import type { ScriptedTour } from './scripted-tour-types'

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
        title: 'Daily Log',
        description: 'Appointment not on the calendar? Log it here manually.',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="daily-log-add-walkin"]',
        title: 'Click "Add Walk-in"',
        description: 'Opens the walk-in form.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="walkin-resident-search"]',
        typeValue: 'Smith',
        title: 'Resident filled in',
        description: 'We typed "Smith" — Mrs. Smith appears below. Click Next.',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="walkin-resident-option"]',
        title: 'Click Mrs. Smith',
        description: 'Click her name to select her.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="walkin-service-select"]',
        typeValue: '{{wash-and-set}}',
        title: 'Service selected',
        description: 'Wash & Set is set. Time and stylist default to now. Click Next.',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="walkin-submit"]',
        title: 'Log the walk-in',
        description: 'Click Add walk-in. A demo entry is created — not in real billing.',
        placement: 'top',
      },
    ],
    learnings: [
      'Found the walk-in entry in the Daily Log',
      'Selected a resident and service',
      'Logged the appointment manually',
    ],
  },
]
