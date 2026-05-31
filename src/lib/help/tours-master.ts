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

  {
    id: 'scripted-master-getting-started',
    title: 'Getting Started',
    scenarioSummary: 'Overview of Master Admin — facilities, reports, and franchises',
    platform: 'desktop',
    role: 'super_admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="master-facility-list"]',
        route: '/master-admin',
        title: 'Your facilities',
        description: 'Every location you manage appears here. Click any facility card to switch into its admin view.',
      },
      {
        type: 'highlight',
        selector: '[data-tour="master-tab-reports"]',
        title: 'Reports tab',
        description: 'Click Reports to see a monthly revenue bar chart across all your facilities at once.',
      },
      {
        type: 'highlight',
        selector: '[data-tour="master-tab-franchises"]',
        title: 'Franchises tab',
        description: 'Franchises group facilities under a common owner with shared stylist pools and super-admin access.',
      },
    ],
    learnings: [
      'Facilities overview',
      'Cross-facility reports',
      'Franchise management',
    ],
  },

  {
    id: 'scripted-master-applicant-pipeline',
    title: 'Applicant Pipeline',
    scenarioSummary: 'Review and promote applicants in the stylist pipeline',
    platform: 'desktop',
    role: 'super_admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="stylists-table"]',
        route: '/stylists/directory',
        title: 'Stylist directory',
        description: 'All active stylists across every facility in one view.',
      },
      {
        type: 'click',
        selector: '[data-tour="directory-applicants-tab"]',
        title: 'Click Applicants',
        description: 'Switch to the applicant pipeline — your imported Indeed candidates.',
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour="directory-applicants-list"]',
        title: 'Applicant pipeline',
        description: 'Each candidate shows location, status, and a Promote button to convert them to an active stylist.',
        placement: 'top',
      },
    ],
    learnings: [
      'Found the stylist directory',
      'Opened the applicant pipeline',
      'Ready to review and promote',
    ],
  },

  {
    id: 'scripted-master-quickbooks-setup',
    title: 'QuickBooks Setup',
    scenarioSummary: "Connect a facility's QuickBooks account",
    platform: 'desktop',
    role: 'super_admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="settings-quickbooks"]',
        route: '/settings?section=billing',
        title: 'QuickBooks settings',
        description: "Each facility connects its own QuickBooks company. Switch facilities from the top to connect each one.",
      },
      {
        type: 'highlight',
        selector: '[data-tour="settings-qb-connect-btn"]',
        title: 'Connect button',
        description: "Click Connect QuickBooks — Intuit's OAuth flow opens. Takes about 30 seconds.",
      },
      {
        type: 'highlight',
        selector: '[data-tour="payroll-period-list"]',
        route: '/payroll',
        title: 'Payroll after setup',
        description: 'Once connected, pay periods can be pushed directly to QuickBooks Bills with one click.',
      },
    ],
    learnings: [
      'Found QB settings',
      'Started the OAuth connection',
      'Ready to push payroll to QB',
    ],
  },

  {
    id: 'scripted-master-analytics',
    title: 'Cross-Facility Analytics',
    scenarioSummary: 'View revenue and performance across all facilities',
    platform: 'desktop',
    role: 'super_admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="master-tab-reports"]',
        route: '/master-admin',
        title: 'Master reports',
        description: "The Reports tab shows a monthly revenue bar chart across all facilities. Click it to load the chart.",
      },
      {
        type: 'highlight',
        selector: '[data-tour="analytics-revenue-summary"]',
        route: '/analytics',
        title: 'Facility analytics',
        description: "Drill into any facility's detailed analytics — revenue trends, appointment counts, and stylist breakdowns.",
      },
      {
        type: 'highlight',
        selector: '[data-tour="analytics-by-stylist"]',
        title: 'Stylist breakdown',
        description: 'Revenue per stylist — identify top performers and compare across locations.',
      },
      {
        type: 'highlight',
        selector: '[data-tour="analytics-export-excel"]',
        title: 'Export',
        description: "Export any facility's log data to a styled Excel spreadsheet for your accountant.",
      },
    ],
    learnings: [
      'Cross-facility revenue overview',
      'Facility-level analytics',
      'Per-stylist breakdown',
      'Excel export',
    ],
  },

  {
    id: 'scripted-master-franchise',
    title: 'Franchise Management',
    scenarioSummary: 'View and manage franchise groups',
    platform: 'desktop',
    role: 'super_admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="master-facility-list"]',
        route: '/master-admin',
        title: 'All your facilities',
        description: 'Facilities can be grouped into franchises — shared ownership, stylist pools, and reporting.',
      },
      {
        type: 'click',
        selector: '[data-tour="master-tab-franchises"]',
        title: 'Click Franchises',
        description: 'Switch to the Franchises tab to see your franchise groups.',
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour="master-franchise-list"]',
        title: 'Franchise list',
        description: "Each franchise shows its member facilities and the owner's email. Click Edit to add/remove locations or change the owner.",
        placement: 'top',
      },
    ],
    learnings: [
      'Found franchise management',
      'Opened the Franchises tab',
      'Understood franchise structure',
    ],
  },

  {
    id: 'scripted-master-cross-facility-analytics',
    title: 'Cross-Facility Analytics',
    scenarioSummary: 'Compare revenue and KPIs across all your facilities',
    platform: 'desktop',
    role: 'super_admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="master-tab-reports"]',
        route: '/master-admin',
        title: 'Monthly report',
        description: 'The Reports tab compares total revenue and outstanding bookings across every facility for any month.',
      },
      {
        type: 'highlight',
        selector: '[data-tour="billing-outstanding"]',
        route: '/billing',
        title: 'Billing overview',
        description: 'Master billing shows outstanding balances across all facilities. Use the facility filter to drill in.',
      },
      {
        type: 'highlight',
        selector: '[data-tour="analytics-revenue-summary"]',
        route: '/analytics',
        title: 'Per-facility analytics',
        description: "Switch facilities at the top to see detailed revenue trends for each location.",
      },
    ],
    learnings: [
      'Cross-facility monthly report',
      'Billing overview across locations',
      'Per-facility deep analytics',
    ],
  },

  {
    id: 'scripted-master-merge-duplicates',
    title: 'Merging Duplicates',
    scenarioSummary: 'Merge duplicate facilities and residents',
    platform: 'desktop',
    role: 'super_admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="master-facility-list"]',
        route: '/master-admin',
        title: 'Duplicate facilities',
        description: 'The same location sometimes exists twice under slightly different names. The Merge tool finds and fixes these.',
      },
      {
        type: 'click',
        selector: '[data-tour="master-tab-merge"]',
        title: 'Click Merge',
        description: 'Opens the Merge tool with auto-detected duplicate facility pairs.',
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour="master-merge-candidates"]',
        title: 'Merge candidates',
        description: 'Each pair shows a confidence score and resident/booking counts. Click Merge to consolidate — all data transfers safely.',
        placement: 'top',
      },
    ],
    learnings: [
      'Found the Merge tool',
      'Understood duplicate detection',
      'Ready to merge facility pairs',
    ],
  },

  {
    id: 'scripted-master-team-roster',
    title: 'Global Team Roster',
    scenarioSummary: 'See every stylist and team member across your facilities',
    platform: 'desktop',
    role: 'super_admin',
    steps: [
      {
        type: 'highlight',
        selector: '[data-tour="stylists-table"]',
        route: '/stylists/directory',
        title: 'Global stylist directory',
        description: 'Every active stylist across all facilities — filter by status, sort by name, and view assignments.',
      },
      {
        type: 'highlight',
        selector: '[data-tour="directory-applicants-tab"]',
        title: 'Applicant pipeline',
        description: 'The Applicants tab shows your hiring pipeline — imported from Indeed and ready to promote.',
      },
      {
        type: 'highlight',
        selector: '[data-tour="settings-team-section"]',
        route: '/settings?section=team',
        title: 'Facility-level users',
        description: 'Admins, facility staff, and bookkeepers are managed per-facility from Settings → Team.',
      },
    ],
    learnings: [
      'Global stylist directory',
      'Applicant pipeline',
      'Facility-level team management',
    ],
  },
]
