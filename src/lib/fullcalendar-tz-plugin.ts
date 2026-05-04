import { createPlugin } from '@fullcalendar/core'

class IntlNamedTimeZone {
  constructor(private timeZoneName: string) {}

  // UTC ms → [year, month(0-indexed), day, hours, minutes, seconds, ms] in facility tz
  timestampToArray(ms: number): number[] {
    const d = new Date(ms)
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timeZoneName,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    })
    const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]))
    return [
      Number(p.year),
      Number(p.month) - 1, // FullCalendar expects 0-indexed month
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
      0,
    ]
  }

  // Local datetime array → UTC offset in minutes (positive = east of UTC)
  offsetForArray([year, month, day, hour, minute, second]: number[]): number {
    // The array uses 0-indexed month (FullCalendar convention)
    const localMs = Date.UTC(year, month, day, hour, minute, second)
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timeZoneName,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    })
    const p = Object.fromEntries(fmt.formatToParts(new Date(localMs)).map((x) => [x.type, x.value]))
    const displayedMs = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour), Number(p.minute), Number(p.second),
    )
    return (localMs - displayedMs) / 60_000
  }
}

export default createPlugin({
  name: 'fullcalendar-intl-tz',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  namedTimeZonedImpl: IntlNamedTimeZone as any,
})
