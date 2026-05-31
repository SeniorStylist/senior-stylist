import type { ScriptedTour } from './scripted-tour-types'

export const ADMIN_TOURS: ScriptedTour[] = [
  {
    id: 'scripted-admin-residents',
    title: 'Add a Resident',
    scenarioSummary: 'Add a new resident to your facility',
    platform: 'desktop',
    role: 'admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="residents-table"]',
        route: '/residents',
        title: 'Your Residents list',
        description: 'Everyone at your facility — visit history and balances in one place.',
      },
      {
        type: 'click',
        selector: '[data-tour="residents-new-button"]',
        title: 'Click + to add a resident',
        description: 'Opens the new-resident form.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="residents-add-name"]',
        typeValue: 'Eleanor Davis',
        title: 'Name entered',
        description: "We typed a demo name. Use the resident's full name in practice. Click Next.",
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="residents-add-submit"]',
        title: 'Save the resident',
        description: 'Click Add. A demo resident is created — auto-cleaned up after the tour.',
        placement: 'top',
      },
      {
        type: 'highlight',
        selector: '[data-tour="residents-table"]',
        title: 'Resident added',
        description: "They're in your list. Open their profile to add room, POA contact, tip defaults, and portal access.",
      },
    ],
    learnings: [
      'Found the Residents list',
      'Created a new resident',
      'Ready to add room, POA, and portal access',
    ],
  },
]
