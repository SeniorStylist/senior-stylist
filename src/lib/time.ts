/**
 * Display-time helpers — Phase 12F.
 *
 * All booking timestamps are stored as UTC. Every display surface MUST
 * format via these helpers passing the FACILITY's timezone, not the
 * browser's. NEVER call Date.prototype.getHours() / .getMinutes() /
 * .getDate() for display logic — they resolve to browser-local time.
 */

export interface LocalParts {
  year: number
  month: number   // 1-12 (NOT 0-indexed)
  day: number
  hours: number   // 0-23
  minutes: number
  weekday: string // 'Mon' | 'Tue' | ...
}

export function getLocalParts(date: Date | string, tz: string): LocalParts {
  const d = typeof date === 'string' ? new Date(date) : date
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]))
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hours: Number(p.hour),
    minutes: Number(p.minute),
    weekday: p.weekday,
  }
}

// "9:00 AM" in the facility's timezone
export function formatTimeInTz(date: Date | string, tz: string): string {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  })
}

// "Friday, March 27" in the facility's timezone (override via opts)
export function formatDateInTz(
  date: Date | string,
  tz: string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...opts,
    timeZone: tz,
  })
}

// Populates <input type="datetime-local"> — output: "YYYY-MM-DDTHH:MM" in facility tz
export function toDateTimeLocalInTz(date: Date | string, tz: string): string {
  const p = getLocalParts(date, tz)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hours)}:${pad(p.minutes)}`
}

// YYYY-MM-DD + IANA tz → [dayStartUtc, dayEndUtc). DST-safe via two-step offset derivation.
export function dayRangeInTimezone(
  dateStr: string,
  timezone: string,
  dayShift = 0,
): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return null
  const baseUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const shifted = new Date(baseUtc + dayShift * 86_400_000)
  const y = shifted.getUTCFullYear()
  const mo = shifted.getUTCMonth()
  const d = shifted.getUTCDate()
  const candidate = new Date(Date.UTC(y, mo, d, 0, 0, 0))
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(candidate)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  const localH = get('hour') === 24 ? 0 : get('hour')
  const localUtc = Date.UTC(get('year'), get('month') - 1, get('day'), localH, get('minute'))
  const offsetMs = candidate.getTime() - localUtc
  const start = new Date(Date.UTC(y, mo, d, 0, 0, 0) + offsetMs)
  const end = new Date(start.getTime() + 86_400_000)
  return { start, end }
}

// Reverse for booking-modal submit: "YYYY-MM-DDTHH:MM" in facility tz → UTC Date.
// DST-safe via the same two-pass drift correction used by serviceDateAtNoonInTz.
export function fromDateTimeLocalInTz(local: string, tz: string): Date {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) throw new Error(`Invalid datetime-local string: ${local}`)
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const h = Number(m[4])
  const mi = Number(m[5])
  let candidate = Date.UTC(y, mo - 1, d, h, mi, 0)
  for (let i = 0; i < 2; i++) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    const p = Object.fromEntries(
      fmt.formatToParts(new Date(candidate)).map((x) => [x.type, x.value]),
    )
    const drift =
      (Date.UTC(
        Number(p.year),
        Number(p.month) - 1,
        Number(p.day),
        Number(p.hour),
        Number(p.minute),
      ) -
        Date.UTC(y, mo - 1, d, h, mi)) /
      60_000
    candidate -= drift * 60_000
  }
  return new Date(candidate)
}
