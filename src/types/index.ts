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
  active: boolean
  createdAt: Date | null
  updatedAt: Date | null
}

export interface Stylist {
  id: string
  facilityId: string
  name: string
  color: string
  commissionPercent: number
  active: boolean
  createdAt: Date | null
  updatedAt: Date | null
}

export interface Service {
  id: string
  facilityId: string
  name: string
  description: string | null
  priceCents: number
  durationMinutes: number
  color: string | null
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
