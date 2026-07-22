import { z } from 'zod'

// Phase 25 — shared schema for POST /api/residents (quick-add from the
// residents page, walk-in inline create, booking-modal inline create). Same
// regression-proof pattern as booking-update.ts: clients type their payloads
// with ResidentCreateInput so schema drift is a tsc error. Zod v4: .optional()
// REJECTS null — use .nullable() wherever a client can send null.

export const residentCreateSchema = z.object({
  // P41 — master admin only: target ANY active facility (assistant
  // cross-facility actions). IGNORED for every other caller.
  facilityId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  roomNumber: z.string().max(50).optional(),
  phone: z.string().max(50).optional(),
})

export type ResidentCreateInput = z.input<typeof residentCreateSchema>
