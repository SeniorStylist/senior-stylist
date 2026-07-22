import { z } from 'zod'

// Phase 25 — shared schema for POST /api/bookings, following the Phase 23
// regression-proof pattern (see booking-update.ts): the route validates with
// this schema and clients type their payload builders with BookingCreateInput,
// so schema/payload drift becomes a tsc error in CI instead of a runtime
// "Invalid input". Zod v4: .optional() REJECTS null — use .nullable() wherever
// a client can send null.

export const bookingCreateSchema = z.object({
  // P41 — master admin only: target ANY active facility (assistant
  // cross-facility actions). IGNORED for every other caller — the route
  // derives their facility from getUserFacility().
  facilityId: z.string().uuid().optional(),
  residentId: z.string().uuid().optional(),
  // Phase 18 — offline walk-in for a brand-new resident: the client can't run
  // the create-resident → book chain offline, so the queued booking POST
  // carries the new resident inline and we create both atomically here.
  newResident: z
    .object({
      name: z.string().min(1).max(200),
      roomNumber: z.string().max(50).optional(),
    })
    .optional(),
  stylistId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  serviceIds: z.array(z.string().uuid()).min(1).optional(),
  startTime: z.string().datetime(),
  notes: z.string().max(2000).optional(),
  selectedQuantity: z.number().int().min(1).max(1000).optional(),
  selectedOption: z.string().max(200).optional(),
  addonChecked: z.boolean().optional(),
  addonServiceIds: z.array(z.string().uuid()).optional().default([]),
  tipCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
}).refine((d) => d.serviceId || (d.serviceIds && d.serviceIds.length > 0), {
  message: 'serviceId or serviceIds is required',
}).refine((d) => !!d.residentId !== !!d.newResident, {
  message: 'Provide exactly one of residentId or newResident',
})

export type BookingCreateInput = z.input<typeof bookingCreateSchema>
