import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  primaryKey,
  unique,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  email: text('email'),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  role: text('role').default('stylist').notNull(),
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
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    uniqueNameFacility: unique().on(t.name, t.facilityId),
  })
)

export const stylists = pgTable('stylists', {
  id: uuid('id').primaryKey().defaultRandom(),
  facilityId: uuid('facility_id')
    .references(() => facilities.id)
    .notNull(),
  name: text('name').notNull(),
  color: text('color').default('#0D7377').notNull(),
  active: boolean('active').default(true).notNull(),
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
  status: text('status').default('scheduled').notNull(),
  paymentStatus: text('payment_status').default('unpaid').notNull(),
  cancellationReason: text('cancellation_reason'),
  googleEventId: text('google_event_id').unique(),
  syncError: text('sync_error'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  facilityId: uuid('facility_id').references(() => facilities.id).notNull(),
  email: text('email').notNull(),
  invitedBy: uuid('invited_by').references(() => profiles.id).notNull(),
  token: text('token').notNull().unique(),
  used: boolean('used').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
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

export const stylistsRelations = relations(stylists, ({ many }) => ({
  bookings: many(bookings),
  logEntries: many(logEntries),
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
