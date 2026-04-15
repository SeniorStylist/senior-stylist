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
export type FacilityUserRole = 'admin' | 'stylist' | 'viewer'

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
  workingHours: { days: string[]; startTime: string; endTime: string } | null
  contactEmail: string | null
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
  portalToken: string | null
  defaultServiceId: string | null
  poaName: string | null
  poaEmail: string | null
  poaPhone: string | null
  poaPaymentMethod: string | null
  poaNotificationsEnabled: boolean
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
  createdAt: Date | null
  updatedAt: Date | null
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
