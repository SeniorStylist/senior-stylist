// P55 — pure working-day helpers, CLIENT-SAFE (no db import — the query lives
// in src/lib/facility-working-days.ts, server-only). An empty workingDows
// array always means "no availability data → allow anything", never "closed".

/** Day-of-week for a 'YYYY-MM-DD' string (calendar dates are tz-free). */
export function dowForDateStr(dateStr: string): number | null {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Is this 'YYYY-MM-DD' a working day? Empty workingDows = always true. */
export function isWorkingDateStr(dateStr: string, workingDows: number[]): boolean {
  if (workingDows.length === 0) return true
  const dow = dowForDateStr(dateStr)
  if (dow === null) return true // malformed — let the schema reject it
  return workingDows.includes(dow)
}

/**
 * Does the inclusive from..to window contain at least one working day?
 * Empty workingDows = no data = always true (fail open).
 */
export function rangeHasWorkingDow(fromStr: string, toStr: string, workingDows: number[]): boolean {
  if (workingDows.length === 0) return true
  const from = dowForDateStr(fromStr)
  const to = dowForDateStr(toStr)
  if (from === null || to === null) return true
  const [fy, fm, fd] = fromStr.split('-').map(Number)
  const [ty, tm, td] = toStr.split('-').map(Number)
  const start = Date.UTC(fy, fm - 1, fd)
  const end = Date.UTC(ty, tm - 1, td)
  if (end < start) return true // malformed range — let the route reject it
  const days = Math.min(Math.round((end - start) / 86_400_000), 6) // ≥7 days spans every DOW
  if (days >= 6) return true
  const set = new Set(workingDows)
  for (let i = 0; i <= days; i++) {
    if (set.has((from + i) % 7)) return true
  }
  return false
}

/** "Tuesday, Thursday and Friday" — localized via Intl (portal) or en-US (staff). */
export function formatWorkingDayNames(workingDows: number[], locale: string): string {
  // Jan 4 2026 is a Sunday — index i lands on DOW i.
  const names = workingDows.map((d) =>
    new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + d))),
  )
  if (names.length <= 1) return names[0] ?? ''
  const last = names[names.length - 1]
  const sep = locale.startsWith('es') ? ' y ' : ' and '
  return names.slice(0, -1).join(', ') + sep + last
}
