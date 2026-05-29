import type { ScriptedTour } from './scripted-tour-types'

// Phase 13-Tutorial Batch 2 — interactive scripted master-admin tours (desktop only).
// These tours create real is_demo=true records via the existing form UI.
// No pre-seeding needed — the tour itself triggers the form POST.
export const MASTER_TOURS: ScriptedTour[] = [
  {
    id: 'scripted-master-add-facility',
    title: 'Add a Facility',
    scenarioSummary: 'Create a practice facility to see how the setup works',
    platform: 'desktop',
    role: 'super_admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="master-facility-list"]',
        route: '/master-admin',
        title: 'This is your Facilities list.',
        description:
          'Every facility you manage appears here. We\'ll walk through adding a new one together.',
      },
      {
        type: 'click',
        selector: '[data-tour="master-add-facility-btn"]',
        title: 'Click "+ Create Facility"',
        description: 'Click the button to open the new-facility form.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="master-facility-form-name"]',
        typeValue: 'Sunrise of Denver',
        title: 'Name the facility',
        description:
          'We typed a name for you. In a real setup, use the facility\'s full legal name. Click Next when ready.',
        placement: 'right',
      },
      {
        type: 'click',
        selector: '[data-tour="master-facility-form-submit"]',
        title: 'Create the facility',
        description:
          'Click Create Facility to save. This is a practice run — the record is auto-cleaned up after the tour.',
        placement: 'top',
      },
    ],
    learnings: [
      'Found the Facilities list where all your locations live',
      'Opened the new-facility form and set the name',
      'Created the facility — it\'s now ready to receive staff and residents',
    ],
  },

  {
    id: 'scripted-master-add-stylist',
    title: 'Add a Stylist',
    scenarioSummary: 'Create a demo stylist profile in the directory',
    platform: 'desktop',
    role: 'super_admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="stylists-table"]',
        route: '/stylists/directory',
        title: 'This is the Stylist Directory.',
        description:
          'All stylists across your facilities live here. Let\'s add one together.',
      },
      {
        type: 'click',
        selector: '[data-tour="directory-add-stylist-btn"]',
        title: 'Click "+ Add Stylist"',
        description: 'Click to open the add-stylist form below.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="directory-add-stylist-name"]',
        typeValue: 'Alex Turner',
        title: "Enter the stylist's name",
        description:
          'We typed a demo name. In practice, enter the stylist\'s real full name. Click Next.',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="directory-add-stylist-submit"]',
        title: 'Add the stylist',
        description:
          'Click Add to create the profile. Next: assign them to a facility and set their availability.',
        placement: 'top',
      },
    ],
    learnings: [
      'Found the Stylist Directory where all stylists are managed',
      'Opened the add-stylist form and entered a name',
      'Created the stylist profile — next step is assigning them to a facility',
    ],
  },
]
