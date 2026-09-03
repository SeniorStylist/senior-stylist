// P60 — types for the New-Facility wizard (/facilities/new).

import type { AutopayMode, PaymentType, WorkingHours } from '@/lib/facility-options'

export type StepId = 'basics' | 'hours' | 'stylists' | 'services' | 'launch' | 'done'

/** Server-computed capabilities; the page derives these from the caller's role. */
export interface WizardCaps {
  isMaster: boolean
  rawRole: 'master' | 'super_admin' | 'admin' | 'bookkeeper'
  /** master || bookkeeper — the roles whose typed F-code POST honors */
  canEditCode: boolean
  canManageStylists: boolean
  canImportServices: boolean
  canSetRevShare: boolean
  canLinkFranchise: boolean
  canSetAutopay: boolean
  /** next free F-code ('' when !canEditCode — shown as "assigned automatically") */
  suggestedCode: string
  /** every facility code + name + active flag (master/bookkeeper only — live clash feedback) */
  codeDirectory: { code: string; name: string; active: boolean }[]
  /** every facility name (master/bookkeeper only — pre-submit duplicate check) */
  nameDirectory: { id: string; name: string; facilityCode: string | null; active: boolean }[]
  /** stylists the caller may assign here (empty for facility admins) */
  stylistDirectory: DirectoryStylist[]
  franchises: { id: string; name: string; facilityIds: string[] }[]
  paymentsStatus: 'not_configured' | 'test' | 'blocked' | 'live'
  /** sanitized: starts with '/', not '//' */
  returnTo: string
}

export interface DirectoryStylist {
  id: string
  name: string
  stylistCode: string
  color: string
  homeFacilityId: string | null
}

export interface PickedStylist extends DirectoryStylist {
  /** stylist_availability day_of_week values at THIS facility (0=Sun…6=Sat) */
  days: number[]
}

export interface CreatedFacility {
  id: string
  name: string
  facilityCode: string | null
}

export interface WizardState {
  step: StepId
  facility: CreatedFacility | null
  basics: {
    name: string
    facilityCode: string
    address: string
    phone: string
    contactEmail: string
    timezone: string
  }
  hours: WorkingHours
  stylists: {
    picked: PickedStylist[]
    /** result of the "upload stylist sheet" import, if any */
    imported: { imported: number; updated: number; assigned: number; availabilityCreated: number } | null
    /** truth from GET /api/facilities/[id]/stylists after the step commits */
    assignedCount: number | null
  }
  services: { created: number; skipped: number } | null
  launch: {
    paymentType: PaymentType
    revSharePercentage: string
    qbRevShareType: 'we_deduct' | 'they_pay'
    autopayMode: AutopayMode
    autopaySweepCadence: 'off' | 'nightly' | 'biweekly' | 'monthly'
    franchiseId: string
  }
  saved: { launch: boolean; franchise: boolean }
  busy: boolean
  error: string | null
  /** 409 payload from POST /api/facilities — drives the conflict card */
  conflict: {
    id: string
    name: string
    facilityCode: string | null
    active: boolean
  } | null
  suggestedCodeFromServer: string | null
}
