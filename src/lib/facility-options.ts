// P57 — ONE home for the facility option lists that used to be copy-pasted
// into four create forms (master-admin, onboarding, Settings→General,
// Settings→Advanced). Plain-language blurbs are the wizard's explanations —
// keep them honest (the autopay one must never promise a charge).

export const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Arizona' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
] as const

export type PaymentType = 'facility' | 'ip' | 'rfms' | 'hybrid'

export const PAYMENT_TYPES: { value: PaymentType; label: string; blurb: string }[] = [
  { value: 'ip', label: 'Residents pay', blurb: 'Each family pays for their own visits — card on file, check, or cash.' },
  { value: 'facility', label: 'Facility pays', blurb: 'The community is billed for every service.' },
  { value: 'rfms', label: 'RFMS billing', blurb: "Visits are charged to the resident's account at the facility." },
  { value: 'hybrid', label: 'Hybrid', blurb: 'Some residents pay individually, others through the facility.' },
]

export type AutopayMode = 'manual' | 'on_completion'

export const AUTOPAY_MODES: { value: AutopayMode; label: string; blurb: string }[] = [
  {
    value: 'on_completion',
    label: 'Automatically, when a visit is completed',
    blurb:
      "For residents whose family saved a card and turned on automatic payment: the card is charged when the stylist marks the visit done or finalizes the day, and the family gets a receipt.",
  },
  {
    value: 'manual',
    label: 'Manually',
    blurb: 'Nothing is charged on its own. Staff press Collect on each visit, or send the family a payment link.',
  },
]

export const DAY_CHIPS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export type DayChip = (typeof DAY_CHIPS)[number]

/** 'Mon' → 1 … 'Sun' → 0 (stylist_availability.day_of_week). */
export const DAY_TO_DOW: Record<DayChip, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
export const DOW_TO_DAY: Record<number, DayChip> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' }

export interface WorkingHours {
  days: string[]
  startTime: string
  endTime: string
}

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  startTime: '08:00',
  endTime: '18:00',
}
