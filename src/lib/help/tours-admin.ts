import type { ScriptedTour } from './scripted-tour-types'

// Phase 13-Tutorial Batch 3 — interactive scripted admin tours.
// Creates a real is_demo=true resident through the form (no pre-seeding).
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
        title: 'This is your Residents list.',
        description:
          "Everyone at your facility lives here, with their visit history and balances. Let's add a new resident.",
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
          'They now appear in your list. Open their profile to add room number, POA contact, tip defaults, and the family portal invite. That\'s it!',
      },
    ],
    learnings: [
      'Found the Residents list',
      'Opened the new-resident form and entered a name',
      'Created the resident — ready to add room, POA, and portal access',
    ],
  },
]
