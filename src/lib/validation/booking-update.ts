// Phase 23 — the booking-update contract, shared between the API route and
// every client that builds an update payload.
//
// WHY THIS FILE EXISTS (regression protection): the daily-log editor once sent
// `notes: null` while this schema said `z.string().optional()` (not nullable) —
// Zod rejected EVERY edit with "Invalid input" and bookkeepers were blocked for
// days. Client payload builders now type their body as `BookingUpdateInput`
// (see log-client.tsx::saveEditBooking), so any future schema/payload drift is
// a COMPILE ERROR caught by `npx tsc` in CI — not a runtime failure in the
// bookkeepers' hands. When you change this schema, the type ripples to every
// caller automatically. Keep the schema and the route in this pairing.

import { z } from 'zod'

export const bookingUpdateSchema = z.object({
  residentId: z.string().uuid().optional(),
  stylistId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  serviceIds: z.array(z.string().uuid()).min(1).optional(),
  addonServiceIds: z.array(z.string().uuid()).optional(),
  startTime: z.string().datetime().optional(),
  priceCents: z.number().int().min(0).optional(),
  // nullable — the daily-log editor sends null for "no note" / "clear the note"
  // (OCR-imported rows have no notes, so null appears in virtually every edit).
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show']).optional(),
  paymentStatus: z.enum(['unpaid', 'paid', 'waived']).optional(),
  cancellationReason: z.string().max(500).optional(),
  cancelFuture: z.boolean().optional(),
  selectedQuantity: z.number().int().min(1).max(1000).optional(),
  selectedOption: z.string().max(200).optional(),
  addonChecked: z.boolean().optional(),
  tipCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  paymentMethod: z.string().max(100).nullable().optional(),
  // Room # is a RESIDENT field, not a booking column — applied to the booking's
  // resident record (residents change rooms; the log sheet is the source of truth).
  roomNumber: z.string().max(50).nullable().optional(),
})

/** Type client payloads with this so drift from the schema fails `tsc`. */
export type BookingUpdateInput = z.input<typeof bookingUpdateSchema>
