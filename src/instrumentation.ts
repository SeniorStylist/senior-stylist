// P62 — record server render errors where the owner can actually read them.
//
// The error card shows Next's digest ("ref 3531942187"). That number is a hash
// of the message + stack, so it is stable across users and facilities for one
// root cause — but on its own it says nothing. Correlating it meant opening the
// Vercel logs, which is not a workflow Josh should need. `onRequestError` is
// Next's supported hook for exactly this, and it receives the SAME digest the
// card shows, so the two line up.
//
// Everything here is best-effort. It must never throw and never slow the error
// path down: if the failure was the database itself, the write simply doesn't
// land, which is the correct outcome rather than a second cascading error.

export async function onRequestError(
  err: unknown,
  request: { path?: string; headers?: Record<string, string | undefined> },
) {
  // The DB client is Node-only; instrumentation also loads in the edge runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { db } = await import('@/db')
    const { sql } = await import('drizzle-orm')
    const { ensureErrorEventsSchema } = await import('@/lib/error-events-ddl')
    await ensureErrorEventsSchema()

    const e = err as { digest?: string; message?: string; stack?: string }
    // Which facility the user was looking at is the single most useful field —
    // it is what turns "some facilities fail" into a name.
    const cookieHeader = request?.headers?.cookie ?? ''
    const m = /(?:^|;\s*)selected_facility_id=([^;]+)/.exec(cookieHeader)
    const facilityId = m?.[1] ? decodeURIComponent(m[1]) : null
    const isUuid = facilityId ? /^[0-9a-f-]{36}$/i.test(facilityId) : false

    await db.execute(sql`
      INSERT INTO app_error_events (digest, message, stack, path, facility_id)
      VALUES (
        ${e?.digest ?? null},
        ${(e?.message ?? String(err)).slice(0, 2000)},
        ${(e?.stack ?? '').slice(0, 4000)},
        ${(request?.path ?? '').slice(0, 300)},
        ${isUuid ? facilityId : null}::uuid
      )
    `)
  } catch {
    // Deliberately silent — Next already logged the original error, and a
    // diagnostic that reports its own failures just adds noise to an outage.
  }
}
