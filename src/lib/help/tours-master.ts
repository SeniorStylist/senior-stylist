import type { ScriptedTour } from './scripted-tour-types'

export const MASTER_TOURS: ScriptedTour[] = [
  {
    id: 'scripted-master-add-facility',
    title: 'Add a Facility',
    scenarioSummary: 'Create Sunrise of Denver as a practice facility',
    platform: 'desktop',
    role: 'super_admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="master-facility-list"]',
        route: '/master-admin',
        title: 'Your Facilities list',
        description: 'Every location you manage appears here.',
      },
      {
        type: 'click',
        selector: '[data-tour="master-add-facility-btn"]',
        title: 'Click "+ Create Facility"',
        description: 'Opens the new-facility form.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="master-facility-form-name"]',
        typeValue: 'Sunrise of Denver',
        title: 'Name entered',
        description: "We typed the name. Use the facility's full legal name in practice. Click Next.",
        placement: 'right',
      },
      {
        type: 'click',
        selector: '[data-tour="master-facility-form-submit"]',
        title: 'Create the facility',
        description: 'Click Create Facility. A demo record is created — auto-cleaned up after the tour.',
        placement: 'top',
      },
    ],
    learnings: [
      'Found the Facilities list',
      'Created a new facility',
      'Ready to add staff and residents',
    ],
  },

  {
    id: 'scripted-master-add-stylist',
    title: 'Add a Stylist',
    scenarioSummary: 'Create a demo stylist in the directory',
    platform: 'desktop',
    role: 'super_admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="stylists-table"]',
        route: '/stylists/directory',
        title: 'Stylist Directory',
        description: 'All stylists across your facilities live here.',
      },
      {
        type: 'click',
        selector: '[data-tour="directory-add-stylist-btn"]',
        title: 'Click "+ Add Stylist"',
        description: 'Opens the add-stylist form.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="directory-add-stylist-name"]',
        typeValue: 'Alex Turner',
        title: 'Name entered',
        description: "We typed a demo name. Enter the stylist's real full name in practice. Click Next.",
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="directory-add-stylist-submit"]',
        title: 'Add the stylist',
        description: 'Click Add. Profile created — next: assign to a facility and set availability.',
        placement: 'top',
      },
    ],
    learnings: [
      'Found the Stylist Directory',
      'Created a stylist profile',
      'Ready to assign to a facility',
    ],
  },
]
