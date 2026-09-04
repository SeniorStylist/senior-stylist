// APLEY — the owner-facing end-to-end demo.
//
// One walk, three identities: the family creates their Salon Account and saves
// a card, asks for a visit; the stylist accepts it, does it, and finalizes the
// day; the family sees what it cost. Every record it creates is real — demo-
// flagged and torn down by Debug → Apley → Reset, but produced by the same code
// paths a live family and a live stylist use. Nothing here is simulated.
//
// Why the family half needed new machinery: the scripted-tour overlay was
// mounted only in the protected layout, and `activeFacilityByCodeWhere` hides
// demo facilities from the portal entirely. Both are fixed (see the family
// layout and facility-code.ts); this file is what uses them.
//
// A note on the step mix. The signup wizard's step list is conditional — the
// "is this them?" card only appears when the resident matcher is confident, and
// that is a network call — so those screens are HIGHLIGHT steps that tell the
// operator exactly what to type, rather than `type` steps that would desync the
// moment the branch differs. Where the DOM is stable (the request page, the
// stylist's queue, the day log) the steps are precise. The engine advances
// silently past a selector it cannot find, so a branch that does not appear
// costs nothing.

import type { ScriptedTour } from './scripted-tour-types'

/** The family the demo creates. Josh types these; they are not pre-seeded. */
export const APLEY_DEMO = {
  familyName: 'Jane Apley',
  residentName: 'Margaret Apley',
  room: '112',
  email: 'jane.apley@example.com',
  password: 'ApleyDemo!2026',
  testCard: '4242 4242 4242 4242',
} as const

export const APLEY_TOURS: ScriptedTour[] = [
  {
    id: 'scripted-apley-end-to-end',
    title: 'Apley — the whole journey',
    scenarioSummary: 'A family signs up, saves a card, asks for a visit; the stylist does it and the card is charged',
    platform: 'desktop',
    role: 'super_admin',
    steps: [
      // ── Act 1: the family ────────────────────────────────────────────────
      {
        type: 'highlight',
        selector: '[data-tour="signup-wizard"]',
        route: '/family/FAPLEY/signup',
        title: 'This is what the QR code opens',
        description:
          'A family scans the poster at the salon door and lands here. One question per screen, large type. Everything you do from here is real — it just belongs to the Apley demo facility.',
        placement: 'center',
      },
      {
        type: 'highlight',
        selector: '[data-tour="signup-wizard"]',
        title: 'Who is signing up',
        description:
          'Choose "I\'m a family member", then Daughter. The wizard asks who they are before it asks anything about the resident.',
        placement: 'center',
      },
      {
        type: 'type',
        selector: '[data-tour="signup-your-name"]',
        typeValue: APLEY_DEMO.familyName,
        title: 'Their name',
        description: 'Typed for you. Tap Next.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="signup-resident-name"]',
        typeValue: APLEY_DEMO.residentName,
        title: 'Who they are signing up for',
        description:
          'Apley Court has no residents yet, so nothing will match — that is the point. The wizard creates Margaret\'s profile from what the family types.',
        placement: 'bottom',
      },
      {
        type: 'type',
        selector: '[data-tour="signup-room"]',
        typeValue: APLEY_DEMO.room,
        title: 'Room number',
        description: 'Then tap Next.',
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '[data-tour="signup-wizard"]',
        title: 'How to reach them',
        description:
          `Enter an email (${APLEY_DEMO.email}) and, if you want to see the text path, a phone number. The consent line under the phone field is the wording the carriers check — it is not decoration.`,
        placement: 'center',
      },
      {
        type: 'highlight',
        selector: '[data-tour="signup-wizard"]',
        title: 'A password, then review',
        description:
          `Use ${APLEY_DEMO.password}. On the review screen, tap Continue to Payment. Margaret's profile is created the moment you submit.`,
        placement: 'center',
      },
      {
        type: 'highlight',
        selector: '[data-tour="signup-wizard"]',
        title: 'The card',
        description:
          `Stripe's own form. In test mode use ${APLEY_DEMO.testCard}, any future expiry, any CVC, any ZIP. A real SetupIntent is created and a real card is vaulted — in test mode, so no money moves. If this environment has no Stripe test keys the step is skipped and Apley says so.`,
        placement: 'center',
      },

      // ── Act 2: the family asks for a visit ───────────────────────────────
      {
        type: 'highlight',
        selector: '[data-tour="request-service-option"]',
        route: '/family/FAPLEY/request',
        title: 'Asking for a visit',
        description:
          'Pick a service. Families never see prices here — pricing is a conversation with the office, and that is deliberate.',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="request-submit"]',
        title: 'Send the request',
        description:
          'This does NOT create an appointment. It files a request — only the stylist places a time. Watch where it turns up next.',
        placement: 'top',
      },

      // ── Act 3: the stylist ───────────────────────────────────────────────
      {
        type: 'highlight',
        selector: '[data-tour="stylist-pending-panel"]',
        route: '/dashboard',
        title: 'The stylist sees it',
        description:
          'You are now signed in as the Apley stylist. The family\'s request is waiting here, on the calendar, with a badge on the tab.',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="stylist-pending-convert"]',
        title: 'Pick a time',
        description:
          'The stylist chooses when — nobody at the facility can place the slot for them. Tap "Pick time".',
        placement: 'bottom',
      },
      {
        type: 'click',
        selector: '[data-tour="booking-modal-submit"]',
        title: 'Save the appointment',
        description:
          'The request becomes a real appointment, and the family gets a confirmation naming the stylist, the day and the time.',
        placement: 'top',
      },
      {
        type: 'click',
        selector: '[data-tour="daily-log-done"]',
        route: '/log',
        title: 'The visit happens',
        description:
          'After the appointment the stylist marks it Done in the Day Log. Tap Done.',
        placement: 'left',
      },
      {
        type: 'click',
        selector: '[data-tour="daily-log-finalize-button"]',
        title: 'Finalize the day — this is the charge',
        description:
          'Finalizing is what charges the saved card for the day\'s completed visits. Tap it, then give it a moment.',
        placement: 'top',
      },

      // ── Act 4: back to the family ────────────────────────────────────────
      {
        type: 'highlight',
        selector: '[data-tour="family-past-visit"]',
        route: '/family/FAPLEY/appointments',
        title: 'What the family sees',
        description:
          'The visit, and what it cost, with any tip shown separately. The receipt went to the email — and to the phone too, once texting is switched on.',
        placement: 'bottom',
      },
      {
        type: 'highlight',
        selector: '',
        title: 'That was the whole journey',
        description:
          'A poster, a family, a card, a request, a stylist, a completed visit and a charge — every step through the same code a real community uses. Closing this returns you to your own account; Debug → Apley → Reset removes the demo facility so you can run it again.',
        placement: 'center',
      },
    ],
    learnings: [
      'A family created their own account and profile from the QR poster',
      'A card was saved and really charged in Stripe test mode',
      'A request became an appointment only when the stylist picked a time',
      'Finalizing the day is what charges the card and sends the receipt',
    ],
  },
]
