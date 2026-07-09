import { z } from 'zod'

// Phase 25 — shared schema for POST /api/log (day-notes / finalize upsert).
// Same regression-proof pattern as booking-update.ts: clients type their
// payloads with LogEntryInput so schema drift is a tsc error, not a runtime
// "Invalid input". Zod v4: .optional() REJECTS null — use .nullable() wherever
// a client can send null.

export const logEntryCreateSchema = z.object({
  stylistId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(2000).optional(),
  finalized: z.boolean().optional(),
})

export type LogEntryInput = z.input<typeof logEntryCreateSchema>
