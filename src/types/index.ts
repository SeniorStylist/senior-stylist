export type PricingType = 'fixed' | 'addon' | 'tiered' | 'multi_option'

export interface PricingTier {
  minQty: number
  maxQty: number
  unitPriceCents: number
}

export interface PricingOption {
  name: string
  priceCents: number
}

export type UserRole = 'admin' | 'stylist' | 'viewer'
export type BookingStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show'
export type FacilityUserRole =
  | 'admin'
  | 'super_admin'
  | 'facility_staff'
  | 'bookkeeper'
  | 'stylist'
  | 'viewer'
export type StylistStatus = 'active' | 'inactive' | 'on_leave' | 'terminated'

export interface Profile {
  id: string
  email: string | null
  fullName: string | null
  avatarUrl: string | null
  role: UserRole
  stylistId: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

export interface Facility {
  id: string
  name: string
  address: string | null
  phone: string | null
  calendarId: string | null
  timezone: string
  paymentType: string
  stripePublishableKey: string | null
  stripeSecretKey: string | null
  qbRealmId: string | null
  qbAccessToken: string | null
  qbRefreshToken: string | null
  qbTokenExpiresAt: string | null
  qbExpenseAccountId: string | null
  workingHours: { days: string[]; startTime: string; endTime: string } | null
  contactEmail: string | null
  serviceCategoryOrder: string[] | null
  qbCustomerId?: string | null
  facilityCode?: string | null
  active: boolean
  createdAt: Date | null
  updatedAt: Date | null
}

export interface Resident {
  id: string
  facilityId: string
  name: string
  roomNumber: string | null
  phone: string | null
  notes: string | null
  defaultServiceId: string | null
  mostUsedServiceId?: string | null
  poaName: string | null
  poaEmail: string | null
  poaPhone: string | null
  poaPaymentMethod: string | null
  poaAddress?: string | null
  poaCity?: string | null
  poaNotificationsEnabled: boolean
  qbCustomerId?: string | null
  lastPortalInviteSentAt?: string | Date | null
  active: boolean
  createdAt: Date | null
  updatedAt: Date | null
}

export interface StylistPhone {
  label: string
  number: string
}

export interface Stylist {
  id: string
  stylistCode: string
  facilityId: string | null
  franchiseId: string | null
  name: string
  color: string
  commissionPercent: number
  active: boolean
  googleCalendarId: string | null
  licenseNumber: string | null
  licenseType: string | null
  licenseExpiresAt: string | null
  insuranceVerified: boolean
  insuranceExpiresAt: string | null
  backgroundCheckVerified: boolean
  email: string | null
  phones: StylistPhone[]
  address: string | null
  paymentMethod: string | null
  licenseState: string | null
  scheduleNotes: string | null
  status: StylistStatus
  specialties: string[]
  lastInviteSentAt?: string | null
  qbVendorId: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

export interface StylistFacilityAssignment {
  id: string
  stylistId: string
  facilityId: string
  commissionPercent: number | null
  active: boolean
  createdAt?: string | null
  updatedAt?: string | null
}

export interface StylistNote {
  id: string
  stylistId: string
  authorUserId: string
  body: string
  createdAt?: string | null
  updatedAt?: string | null
}

export interface SubstituteOption {
  id: string
  name: string
  stylistCode: string
  type: 'facility' | 'franchise'
}

export type ComplianceDocumentType =
  | 'license'
  | 'insurance'
  | 'w9'
  | 'contractor_agreement'
  | 'background_check'

export interface ComplianceDocument {
  id: string
  stylistId: string
  facilityId: string
  documentType: ComplianceDocumentType
  fileUrl: string
  fileName: string
  expiresAt: string | null
  verified: boolean
  verifiedBy: string | null
  verifiedAt: Date | null
  uploadedAt: Date
  createdAt: Date | null
}

export interface ComplianceDocumentWithUrl extends ComplianceDocument {
  signedUrl: string | null
}

export interface Service {
  id: string
  facilityId: string
  name: string
  description: string | null
  priceCents: number
  durationMinutes: number
  color: string | null
  category: string | null
  pricingType: PricingType
  addonAmountCents: number | null
  pricingTiers: PricingTier[] | null
  pricingOptions: PricingOption[] | null
  active: boolean
  createdAt: Date | null
  updatedAt: Date | null
}

export interface Booking {
  id: string
  facilityId: string
  residentId: string
  stylistId: string
  serviceId: string
  startTime: Date
  endTime: Date
  priceCents: number | null
  durationMinutes: number | null
  notes: string | null
  selectedQuantity: number | null
  selectedOption: string | null
  addonServiceIds: string[] | null
  addonTotalCents: number | null
  serviceIds: string[] | null
  serviceNames: string[] | null
  totalDurationMinutes: number | null
  status: BookingStatus
  paymentStatus: string
  cancellationReason: string | null
  recurring: boolean
  recurringRule: string | null
  recurringEndDate: string | null
  recurringParentId: string | null
  googleEventId: string | null
  syncError: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

export interface BookingWithRelations extends Booking {
  resident: Resident
  stylist: Stylist
  service: Service
}

export interface AccessRequest {
  id: string
  facilityId: string | null
  email: string
  fullName: string | null
  status: string
  role: string
  userId: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

export interface LogEntry {
  id: string
  facilityId: string
  stylistId: string
  date: string
  notes: string | null
  finalized: boolean
  finalizedAt: Date | null
  createdAt: Date | null
  updatedAt: Date | null
}

export interface StylistAvailability {
  id: string
  stylistId: string
  facilityId: string
  dayOfWeek: number
  startTime: string
  endTime: string
  active: boolean
  createdAt?: string | null
  updatedAt?: string | null
}

export type ApplicantStatus = 'new' | 'reviewing' | 'contacting' | 'hired' | 'rejected'

export interface Applicant {
  id: string
  franchiseId: string | null
  name: string
  email: string | null
  phone: string | null
  location: string | null
  appliedDate: string | null
  jobTitle: string | null
  jobLocation: string | null
  relevantExperience: string | null
  education: string | null
  source: string | null
  isIndeedEmail: boolean
  qualifications: Array<{ question: string; answer: string; match: string }>
  status: ApplicantStatus
  notes: string | null
  active: boolean
  createdAt: string | null
  updatedAt: string | null
}

export type PayPeriodType = 'weekly' | 'biweekly' | 'monthly'
export type PayPeriodStatus = 'open' | 'processing' | 'paid'
export type PayType = 'commission' | 'hourly' | 'flat'
export type DeductionType = 'cash_kept' | 'supplies' | 'advance' | 'other'

export interface PayPeriod {
  id: string
  facilityId: string
  franchiseId: string | null
  periodType: PayPeriodType
  startDate: string
  endDate: string
  status: PayPeriodStatus
  notes: string | null
  createdBy: string | null
  qbSyncedAt: string | null
  qbSyncError: string | null
  createdAt: string
  updatedAt: string
}

export interface StylistPayItem {
  id: string
  payPeriodId: string
  stylistId: string
  facilityId: string
  payType: PayType
  grossRevenueCents: number
  commissionRate: number
  commissionAmountCents: number
  hoursWorked: string | null
  hourlyRateCents: number | null
  flatAmountCents: number | null
  netPayCents: number
  notes: string | null
  qbBillId: string | null
  qbBillSyncToken: string | null
  qbSyncError: string | null
  createdAt: string
  updatedAt: string
}

export interface PayDeduction {
  id: string
  payItemId: string
  stylistId: string
  payPeriodId: string
  deductionType: DeductionType
  amountCents: number
  note: string | null
  createdBy: string | null
  createdAt: string
}

export type CoverageRequestStatus = 'open' | 'filled' | 'cancelled'

export interface CoverageRequest {
  id: string
  facilityId: string
  stylistId: string
  startDate: string
  endDate: string
  reason: string | null
  status: CoverageRequestStatus
  substituteStylistId: string | null
  assignedBy: string | null
  assignedAt: string | null
  createdAt?: string | null
  updatedAt?: string | null
  stylist?: { id: string; name: string } | null
  substituteStylist?: { id: string; name: string } | null
}

// Phase 11K — Payment reconciliation
// `logEntryId` actually holds a `bookings.id` — kept named "logEntryId" because
// per-resident service evidence lives on the booking row that appears in the daily log.
export type ReconciliationStatus = 'unreconciled' | 'reconciled' | 'partial' | 'flagged'
export type ReconciliationConfidence = 'high' | 'medium' | 'unmatched'

export interface ReconciliationLine {
  invoiceRef: string | null
  invoiceDate: string | null
  residentId: string | null
  residentName: string
  amountCents: number
  confidence: ReconciliationConfidence
  logEntryId: string | null
  logDate: string | null
  logStylistName: string | null
  flagReason: string | null
}
