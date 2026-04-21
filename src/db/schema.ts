import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  numeric,
  primaryKey,
  unique,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  email: text('email'),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  role: text('role').default('stylist').notNull(),
  stylistId: uuid('stylist_id').references(() => stylists.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const facilities = pgTable('facilities', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  address: text('address'),
  phone: text('phone'),
  calendarId: text('calendar_id'),
  timezone: text('timezone').default('America/New_York').notNull(),
  paymentType: text('payment_type').default('facility').notNull(),
  stripePublishableKey: text('stripe_publishable_key'),
  stripeSecretKey: text('stripe_secret_key'),
  qbRealmId: text('qb_realm_id'),
  qbAccessToken: text('qb_access_token'),
  qbRefreshToken: text('qb_refresh_token'),
  qbTokenExpiresAt: timestamp('qb_token_expires_at', { withTimezone: true }),
  qbExpenseAccountId: text('qb_expense_account_id'),
  workingHours: jsonb('working_hours').$type<{
    days: string[]
    startTime: string
    endTime: string
  }>(),
  contactEmail: text('contact_email'),
  serviceCategoryOrder: jsonb('service_category_order').$type<string[]>(),
  qbCustomerId: text('qb_customer_id'),
  facilityCode: text('facility_code'),
  qbOutstandingBalanceCents: integer('qb_outstanding_balance_cents').default(0),
  qbRevShareType: text('qb_rev_share_type').default('we_deduct'),
  revSharePercentage: integer('rev_share_percentage'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const facilityUsers = pgTable(
  'facility_users',
  {
    userId: uuid('user_id')
      .references(() => profiles.id)
      .notNull(),
    facilityId: uuid('facility_id')
      .references(() => facilities.id)
      .notNull(),
    role: text('role').default('stylist').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.facilityId] }),
  })
)

export const residents = pgTable(
  'residents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .references(() => facilities.id)
      .notNull(),
    name: text('name').notNull(),
    roomNumber: text('room_number'),
    phone: text('phone'),
    notes: text('notes'),
    portalToken: text('portal_token').unique(),
    defaultServiceId: uuid('default_service_id').references(() => services.id),
    poaName: text('poa_name'),
    poaEmail: text('poa_email'),
    poaPhone: text('poa_phone'),
    poaPaymentMethod: text('poa_payment_method'),
    poaAddress: text('poa_address'),
    poaCity: text('poa_city'),
    poaNotificationsEnabled: boolean('poa_notifications_enabled').default(true).notNull(),
    qbCustomerId: text('qb_customer_id'),
    qbOutstandingBalanceCents: integer('qb_outstanding_balance_cents').default(0),
    residentPaymentType: text('resident_payment_type'),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  }
)

export const stylists = pgTable('stylists', {
  id: uuid('id').primaryKey().defaultRandom(),
  stylistCode: text('stylist_code').notNull().unique(),
  facilityId: uuid('facility_id').references(() => facilities.id),
  franchiseId: uuid('franchise_id').references((): AnyPgColumn => franchises.id),
  name: text('name').notNull(),
  color: text('color').default('#0D7377').notNull(),
  commissionPercent: integer('commission_percent').default(0).notNull(),
  active: boolean('active').default(true).notNull(),
  googleCalendarId: text('google_calendar_id'),
  googleRefreshToken: text('google_refresh_token'),
  licenseNumber: text('license_number'),
  licenseType: text('license_type'),
  licenseExpiresAt: date('license_expires_at'),
  insuranceVerified: boolean('insurance_verified').default(false).notNull(),
  insuranceExpiresAt: date('insurance_expires_at'),
  backgroundCheckVerified: boolean('background_check_verified').default(false).notNull(),
  email: text('email'),
  phones: jsonb('phones').$type<Array<{ label: string; number: string }>>().default([]).notNull(),
  address: text('address'),
  paymentMethod: text('payment_method'),
  licenseState: text('license_state'),
  scheduleNotes: text('schedule_notes'),
  status: text('status').default('active').notNull(),
  specialties: jsonb('specialties').$type<string[]>().default([]).notNull(),
  lastInviteSentAt: timestamp('last_invite_sent_at'),
  qbVendorId: text('qb_vendor_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const stylistFacilityAssignments = pgTable(
  'stylist_facility_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stylistId: uuid('stylist_id')
      .references(() => stylists.id, { onDelete: 'cascade' })
      .notNull(),
    facilityId: uuid('facility_id')
      .references(() => facilities.id, { onDelete: 'cascade' })
      .notNull(),
    commissionPercent: integer('commission_percent'),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    uniqueStylistFacility: unique('stylist_facility_assignments_stylist_facility_unique').on(
      t.stylistId,
      t.facilityId,
    ),
  }),
)

export const stylistNotes = pgTable('stylist_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  stylistId: uuid('stylist_id')
    .references(() => stylists.id, { onDelete: 'cascade' })
    .notNull(),
  authorUserId: uuid('author_user_id')
    .references(() => profiles.id)
    .notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const complianceDocuments = pgTable('compliance_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  stylistId: uuid('stylist_id')
    .references(() => stylists.id)
    .notNull(),
  facilityId: uuid('facility_id')
    .references(() => facilities.id)
    .notNull(),
  documentType: text('document_type').notNull(),
  fileUrl: text('file_url').notNull(),
  fileName: text('file_name').notNull(),
  expiresAt: date('expires_at'),
  verified: boolean('verified').default(false).notNull(),
  verifiedBy: uuid('verified_by').references(() => profiles.id),
  verifiedAt: timestamp('verified_at'),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

export const stylistAvailability = pgTable(
  'stylist_availability',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stylistId: uuid('stylist_id')
      .references(() => stylists.id)
      .notNull(),
    facilityId: uuid('facility_id')
      .references(() => facilities.id)
      .notNull(),
    dayOfWeek: integer('day_of_week').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    uniqueStylistFacilityDay: unique('stylist_availability_stylist_facility_day_unique').on(
      t.stylistId,
      t.facilityId,
      t.dayOfWeek,
    ),
  })
)

export const coverageRequests = pgTable('coverage_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  facilityId: uuid('facility_id')
    .references(() => facilities.id)
    .notNull(),
  stylistId: uuid('stylist_id')
    .references(() => stylists.id)
    .notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  reason: text('reason'),
  status: text('status').default('open').notNull(),
  substituteStylistId: uuid('substitute_stylist_id').references(() => stylists.id),
  assignedBy: uuid('assigned_by').references(() => profiles.id),
  assignedAt: timestamp('assigned_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const services = pgTable('services', {
  id: uuid('id').primaryKey().defaultRandom(),
  facilityId: uuid('facility_id')
    .references(() => facilities.id)
    .notNull(),
  name: text('name').notNull(),
  description: text('description'),
  priceCents: integer('price_cents').notNull(),
  durationMinutes: integer('duration_minutes').default(30).notNull(),
  color: text('color'),
  category: text('category'),
  pricingType: text('pricing_type').default('fixed').notNull(),
  addonAmountCents: integer('addon_amount_cents'),
  pricingTiers: jsonb('pricing_tiers').$type<Array<{ minQty: number; maxQty: number; unitPriceCents: number }>>(),
  pricingOptions: jsonb('pricing_options').$type<Array<{ name: string; priceCents: number }>>(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  facilityId: uuid('facility_id')
    .references(() => facilities.id)
    .notNull(),
  residentId: uuid('resident_id')
    .references(() => residents.id)
    .notNull(),
  stylistId: uuid('stylist_id')
    .references(() => stylists.id)
    .notNull(),
  serviceId: uuid('service_id')
    .references(() => services.id)
    .notNull(),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }).notNull(),
  priceCents: integer('price_cents'),
  durationMinutes: integer('duration_minutes'),
  notes: text('notes'),
  selectedQuantity: integer('selected_quantity'),
  selectedOption: text('selected_option'),
  addonServiceIds: text('addon_service_ids').array(),
  addonTotalCents: integer('addon_total_cents'),
  serviceIds: text('service_ids').array(),
  serviceNames: text('service_names').array(),
  totalDurationMinutes: integer('total_duration_minutes'),
  status: text('status').default('scheduled').notNull(),
  paymentStatus: text('payment_status').default('unpaid').notNull(),
  cancellationReason: text('cancellation_reason'),
  recurring: boolean('recurring').default(false).notNull(),
  recurringRule: text('recurring_rule'),
  recurringEndDate: date('recurring_end_date'),
  recurringParentId: uuid('recurring_parent_id').references((): AnyPgColumn => bookings.id),
  googleEventId: text('google_event_id').unique(),
  syncError: text('sync_error'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  facilityId: uuid('facility_id').references(() => facilities.id).notNull(),
  email: text('email').notNull(),
  inviteRole: text('invite_role').default('stylist').notNull(),
  invitedBy: uuid('invited_by').references(() => profiles.id).notNull(),
  token: text('token').notNull().unique(),
  used: boolean('used').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
})

export const accessRequests = pgTable('access_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  facilityId: uuid('facility_id').references(() => facilities.id),
  email: text('email').notNull(),
  fullName: text('full_name'),
  status: text('status').default('pending').notNull(),
  role: text('role').default('stylist').notNull(),
  userId: uuid('user_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const logEntries = pgTable(
  'log_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .references(() => facilities.id)
      .notNull(),
    stylistId: uuid('stylist_id')
      .references(() => stylists.id)
      .notNull(),
    date: date('date').notNull(),
    notes: text('notes'),
    finalized: boolean('finalized').default(false).notNull(),
    finalizedAt: timestamp('finalized_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    uniqueFacilityStylistDate: unique().on(t.facilityId, t.stylistId, t.date),
  })
)

export const oauthStates = pgTable('oauth_states', {
  nonce: text('nonce').primaryKey(),
  userId: uuid('user_id').notNull(),
  stylistId: uuid('stylist_id'),
  facilityId: uuid('facility_id').references(() => facilities.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const franchises = pgTable('franchises', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id').references(() => profiles.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const franchiseFacilities = pgTable(
  'franchise_facilities',
  {
    franchiseId: uuid('franchise_id')
      .references(() => franchises.id, { onDelete: 'cascade' })
      .notNull(),
    facilityId: uuid('facility_id')
      .references(() => facilities.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.franchiseId, t.facilityId] }),
  })
)

export const applicants = pgTable('applicants', {
  id: uuid('id').primaryKey().defaultRandom(),
  franchiseId: uuid('franchise_id').references(() => franchises.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  location: text('location'),
  appliedDate: date('applied_date'),
  jobTitle: text('job_title'),
  jobLocation: text('job_location'),
  relevantExperience: text('relevant_experience'),
  education: text('education'),
  source: text('source'),
  isIndeedEmail: boolean('is_indeed_email').default(false).notNull(),
  qualifications: jsonb('qualifications')
    .$type<Array<{ question: string; answer: string; match: string }>>()
    .default([])
    .notNull(),
  status: text('status').default('new').notNull(),
  notes: text('notes'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const payPeriods = pgTable('pay_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  facilityId: uuid('facility_id').references(() => facilities.id).notNull(),
  franchiseId: uuid('franchise_id').references((): AnyPgColumn => franchises.id),
  periodType: text('period_type').default('monthly').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  status: text('status').default('open').notNull(),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => profiles.id),
  qbSyncedAt: timestamp('qb_synced_at', { withTimezone: true }),
  qbSyncError: text('qb_sync_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const stylistPayItems = pgTable(
  'stylist_pay_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payPeriodId: uuid('pay_period_id')
      .references(() => payPeriods.id, { onDelete: 'cascade' })
      .notNull(),
    stylistId: uuid('stylist_id').references(() => stylists.id).notNull(),
    facilityId: uuid('facility_id').references(() => facilities.id).notNull(),
    payType: text('pay_type').default('commission').notNull(),
    grossRevenueCents: integer('gross_revenue_cents').default(0).notNull(),
    commissionRate: integer('commission_rate').default(0).notNull(),
    commissionAmountCents: integer('commission_amount_cents').default(0).notNull(),
    hoursWorked: numeric('hours_worked', { precision: 6, scale: 2 }),
    hourlyRateCents: integer('hourly_rate_cents'),
    flatAmountCents: integer('flat_amount_cents'),
    netPayCents: integer('net_pay_cents').default(0).notNull(),
    notes: text('notes'),
    qbBillId: text('qb_bill_id'),
    qbBillSyncToken: text('qb_bill_sync_token'),
    qbSyncError: text('qb_sync_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniquePeriodStylist: unique('stylist_pay_items_period_stylist_unique').on(
      t.payPeriodId,
      t.stylistId,
    ),
  }),
)

export const payDeductions = pgTable('pay_deductions', {
  id: uuid('id').primaryKey().defaultRandom(),
  payItemId: uuid('pay_item_id')
    .references(() => stylistPayItems.id, { onDelete: 'cascade' })
    .notNull(),
  stylistId: uuid('stylist_id').references(() => stylists.id).notNull(),
  payPeriodId: uuid('pay_period_id').references(() => payPeriods.id).notNull(),
  deductionType: text('deduction_type').notNull(),
  amountCents: integer('amount_cents').notNull(),
  note: text('note'),
  createdBy: uuid('created_by').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const qbInvoices = pgTable('qb_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  facilityId: uuid('facility_id').references(() => facilities.id, { onDelete: 'cascade' }).notNull(),
  residentId: uuid('resident_id').references(() => residents.id, { onDelete: 'set null' }),
  qbCustomerId: text('qb_customer_id'),
  invoiceNum: text('invoice_num').notNull(),
  invoiceDate: date('invoice_date').notNull(),
  dueDate: date('due_date'),
  amountCents: integer('amount_cents').notNull().default(0),
  openBalanceCents: integer('open_balance_cents').notNull().default(0),
  status: text('status').notNull().default('open'),
  paymentType: text('payment_type'),
  qbInvoiceId: text('qb_invoice_id'),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  sentVia: text('sent_via'),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  dedupIdx: unique('qb_invoices_dedup_idx').on(t.invoiceNum, t.facilityId),
}))

export const qbPayments = pgTable('qb_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  facilityId: uuid('facility_id').references(() => facilities.id, { onDelete: 'cascade' }).notNull(),
  residentId: uuid('resident_id').references(() => residents.id, { onDelete: 'set null' }),
  qbCustomerId: text('qb_customer_id'),
  checkNum: text('check_num'),
  checkDate: date('check_date'),
  paymentDate: date('payment_date').notNull(),
  amountCents: integer('amount_cents').notNull().default(0),
  memo: text('memo'),
  invoiceRef: text('invoice_ref'),
  paymentType: text('payment_type'),
  paymentMethod: text('payment_method').notNull().default('check'),
  residentBreakdown: jsonb('resident_breakdown').$type<
    | Array<{
        name: string
        residentId: string | null
        amountCents: number
        matchConfidence: 'high' | 'medium' | 'low' | 'none'
      }>
    | {
        type: 'remittance_lines'
        lines: Array<{
          ref: string | null
          invoiceDate: string | null
          amountCents: number
        }>
      }
  >(),
  recordedVia: text('recorded_via').notNull().default('manual'),
  checkImageUrl: text('check_image_url'),
  qbPaymentId: text('qb_payment_id'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow(),
})

export const qbUnresolvedPayments = pgTable('qb_unresolved_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  facilityId: uuid('facility_id').references(() => facilities.id, { onDelete: 'cascade' }).notNull(),
  // @deprecated 11A scaffolding, unused — 11D uses extracted_* columns below
  checkNum: text('check_num'),
  checkDate: date('check_date'),
  totalAmountCents: integer('total_amount_cents').notNull().default(0),
  rawResidentName: text('raw_resident_name'),
  rawAmountCents: integer('raw_amount_cents'),
  rawServiceType: text('raw_service_type'),
  checkImageUrl: text('check_image_url'),
  notes: text('notes'),
  resolvedToResidentId: uuid('resolved_to_resident_id').references(() => residents.id, { onDelete: 'set null' }),
  // 11D columns
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by'),
  rawOcrJson: jsonb('raw_ocr_json').$type<Record<string, unknown>>(),
  extractedCheckNum: text('extracted_check_num'),
  extractedCheckDate: date('extracted_check_date'),
  extractedAmountCents: integer('extracted_amount_cents'),
  extractedPayerName: text('extracted_payer_name'),
  extractedInvoiceRef: text('extracted_invoice_ref'),
  extractedInvoiceDate: date('extracted_invoice_date'),
  extractedResidentLines: jsonb('extracted_resident_lines').$type<Array<{
    rawName: string
    amountCents: number
    serviceCategory: string | null
    residentId: string | null
    matchConfidence: 'high' | 'medium' | 'low' | 'none'
  }>>(),
  confidenceOverall: text('confidence_overall'),
  unresolvedReason: text('unresolved_reason'),
  createdAt: timestamp('created_at').defaultNow(),
})

export const scanCorrections = pgTable('scan_corrections', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  facilityId: uuid('facility_id').references(() => facilities.id, { onDelete: 'cascade' }),
  documentType: text('document_type').notNull(),
  fieldName: text('field_name').notNull(),
  geminiExtracted: text('gemini_extracted'),
  correctedValue: text('corrected_value').notNull(),
  contextNote: text('context_note'),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
})

export const facilityMergeLog = pgTable('facility_merge_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  performedBy: uuid('performed_by').references(() => profiles.id, { onDelete: 'set null' }),
  primaryFacilityId: uuid('primary_facility_id').references(() => facilities.id, { onDelete: 'set null' }),
  secondaryFacilityId: uuid('secondary_facility_id'),
  secondaryFacilityName: text('secondary_facility_name').notNull(),
  residentsTransferred: integer('residents_transferred').notNull().default(0),
  residentsConflicted: integer('residents_conflicted').notNull().default(0),
  bookingsTransferred: integer('bookings_transferred').notNull().default(0),
  logEntriesTransferred: integer('log_entries_transferred').notNull().default(0),
  logEntriesDropped: integer('log_entries_dropped').notNull().default(0),
  stylistAssignmentsTransferred: integer('stylist_assignments_transferred').notNull().default(0),
  stylistAssignmentsDropped: integer('stylist_assignments_dropped').notNull().default(0),
  qbInvoicesTransferred: integer('qb_invoices_transferred').notNull().default(0),
  qbInvoicesDropped: integer('qb_invoices_dropped').notNull().default(0),
  qbPaymentsTransferred: integer('qb_payments_transferred').notNull().default(0),
  fieldsInherited: text('fields_inherited').array().notNull().default(sql`'{}'::text[]`),
  notes: text('notes'),
})

// ─── Relations ───────────────────────────────────────────────────────────────

export const bookingsRelations = relations(bookings, ({ one }) => ({
  resident: one(residents, {
    fields: [bookings.residentId],
    references: [residents.id],
  }),
  stylist: one(stylists, {
    fields: [bookings.stylistId],
    references: [stylists.id],
  }),
  service: one(services, {
    fields: [bookings.serviceId],
    references: [services.id],
  }),
  facility: one(facilities, {
    fields: [bookings.facilityId],
    references: [facilities.id],
  }),
}))

export const residentsRelations = relations(residents, ({ many }) => ({
  bookings: many(bookings),
}))

export const stylistsRelations = relations(stylists, ({ one, many }) => ({
  facility: one(facilities, {
    fields: [stylists.facilityId],
    references: [facilities.id],
  }),
  franchise: one(franchises, {
    fields: [stylists.franchiseId],
    references: [franchises.id],
  }),
  bookings: many(bookings),
  logEntries: many(logEntries),
  complianceDocuments: many(complianceDocuments),
  availability: many(stylistAvailability),
  coverageRequests: many(coverageRequests, { relationName: 'coverage_stylist' }),
  coveringRequests: many(coverageRequests, { relationName: 'coverage_substitute' }),
  assignments: many(stylistFacilityAssignments),
  notes: many(stylistNotes),
}))

export const stylistFacilityAssignmentsRelations = relations(
  stylistFacilityAssignments,
  ({ one }) => ({
    stylist: one(stylists, {
      fields: [stylistFacilityAssignments.stylistId],
      references: [stylists.id],
    }),
    facility: one(facilities, {
      fields: [stylistFacilityAssignments.facilityId],
      references: [facilities.id],
    }),
  }),
)

export const stylistNotesRelations = relations(stylistNotes, ({ one }) => ({
  stylist: one(stylists, {
    fields: [stylistNotes.stylistId],
    references: [stylists.id],
  }),
  author: one(profiles, {
    fields: [stylistNotes.authorUserId],
    references: [profiles.id],
  }),
}))

export const stylistAvailabilityRelations = relations(stylistAvailability, ({ one }) => ({
  stylist: one(stylists, {
    fields: [stylistAvailability.stylistId],
    references: [stylists.id],
  }),
  facility: one(facilities, {
    fields: [stylistAvailability.facilityId],
    references: [facilities.id],
  }),
}))

export const coverageRequestsRelations = relations(coverageRequests, ({ one }) => ({
  stylist: one(stylists, {
    fields: [coverageRequests.stylistId],
    references: [stylists.id],
    relationName: 'coverage_stylist',
  }),
  substituteStylist: one(stylists, {
    fields: [coverageRequests.substituteStylistId],
    references: [stylists.id],
    relationName: 'coverage_substitute',
  }),
  facility: one(facilities, {
    fields: [coverageRequests.facilityId],
    references: [facilities.id],
  }),
  assignedByProfile: one(profiles, {
    fields: [coverageRequests.assignedBy],
    references: [profiles.id],
  }),
}))

export const complianceDocumentsRelations = relations(complianceDocuments, ({ one }) => ({
  stylist: one(stylists, {
    fields: [complianceDocuments.stylistId],
    references: [stylists.id],
  }),
  facility: one(facilities, {
    fields: [complianceDocuments.facilityId],
    references: [facilities.id],
  }),
  verifiedByProfile: one(profiles, {
    fields: [complianceDocuments.verifiedBy],
    references: [profiles.id],
  }),
}))

export const servicesRelations = relations(services, ({ many }) => ({
  bookings: many(bookings),
}))

export const facilitiesRelations = relations(facilities, ({ many }) => ({
  facilityUsers: many(facilityUsers),
  residents: many(residents),
  stylists: many(stylists),
  services: many(services),
  bookings: many(bookings),
  logEntries: many(logEntries),
  invites: many(invites),
  franchiseFacilities: many(franchiseFacilities),
  stylistAssignments: many(stylistFacilityAssignments),
}))

export const invitesRelations = relations(invites, ({ one }) => ({
  facility: one(facilities, {
    fields: [invites.facilityId],
    references: [facilities.id],
  }),
  invitedByProfile: one(profiles, {
    fields: [invites.invitedBy],
    references: [profiles.id],
  }),
}))

export const facilityUsersRelations = relations(facilityUsers, ({ one }) => ({
  facility: one(facilities, {
    fields: [facilityUsers.facilityId],
    references: [facilities.id],
  }),
  profile: one(profiles, {
    fields: [facilityUsers.userId],
    references: [profiles.id],
  }),
}))

export const logEntriesRelations = relations(logEntries, ({ one }) => ({
  facility: one(facilities, {
    fields: [logEntries.facilityId],
    references: [facilities.id],
  }),
  stylist: one(stylists, {
    fields: [logEntries.stylistId],
    references: [stylists.id],
  }),
}))

export const franchisesRelations = relations(franchises, ({ one, many }) => ({
  owner: one(profiles, {
    fields: [franchises.ownerUserId],
    references: [profiles.id],
  }),
  franchiseFacilities: many(franchiseFacilities),
  stylists: many(stylists),
  applicants: many(applicants),
}))

export const franchiseFacilitiesRelations = relations(franchiseFacilities, ({ one }) => ({
  franchise: one(franchises, {
    fields: [franchiseFacilities.franchiseId],
    references: [franchises.id],
  }),
  facility: one(facilities, {
    fields: [franchiseFacilities.facilityId],
    references: [facilities.id],
  }),
}))

export const applicantsRelations = relations(applicants, ({ one }) => ({
  franchise: one(franchises, {
    fields: [applicants.franchiseId],
    references: [franchises.id],
  }),
}))

export const payPeriodsRelations = relations(payPeriods, ({ one, many }) => ({
  facility: one(facilities, {
    fields: [payPeriods.facilityId],
    references: [facilities.id],
  }),
  items: many(stylistPayItems),
}))

export const stylistPayItemsRelations = relations(stylistPayItems, ({ one, many }) => ({
  payPeriod: one(payPeriods, {
    fields: [stylistPayItems.payPeriodId],
    references: [payPeriods.id],
  }),
  stylist: one(stylists, {
    fields: [stylistPayItems.stylistId],
    references: [stylists.id],
  }),
  facility: one(facilities, {
    fields: [stylistPayItems.facilityId],
    references: [facilities.id],
  }),
  deductions: many(payDeductions),
}))

export const payDeductionsRelations = relations(payDeductions, ({ one }) => ({
  payItem: one(stylistPayItems, {
    fields: [payDeductions.payItemId],
    references: [stylistPayItems.id],
  }),
}))
