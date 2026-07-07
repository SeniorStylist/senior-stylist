// Phase 16 G9 — printable weekly schedule. Self-contained HTML (signage print
// pattern: preview/print via window.open + document.write on web, share-sheet
// HTML blob on native). Grouped by day, time-sorted, burgundy header.

export interface WeeklyScheduleBooking {
  startTime: string
  endTime: string
  status: string
  residentName: string
  roomNumber: string | null
  serviceName: string
  stylistName: string
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildWeeklyScheduleHtml(opts: {
  facilityName: string
  weekLabel: string
  tz: string
  bookings: WeeklyScheduleBooking[]
}): string {
  const { facilityName, weekLabel, tz, bookings } = opts

  // Group by facility-local day
  const byDay = new Map<string, WeeklyScheduleBooking[]>()
  for (const b of bookings) {
    if (b.status === 'cancelled') continue
    const dayKey = new Date(b.startTime).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', timeZone: tz,
    })
    const list = byDay.get(dayKey) ?? []
    list.push(b)
    byDay.set(dayKey, list)
  }

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz })

  const daySections = [...byDay.entries()]
    .map(([day, rows]) => {
      const sorted = [...rows].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      const trs = sorted
        .map(
          (b) => `<tr>
            <td class="time">${fmtTime(b.startTime)}</td>
            <td><strong>${esc(b.residentName)}</strong>${b.roomNumber ? ` <span class="room">Rm ${esc(b.roomNumber)}</span>` : ''}</td>
            <td>${esc(b.serviceName)}</td>
            <td>${esc(b.stylistName)}</td>
          </tr>`,
        )
        .join('')
      return `<section>
        <h2>${esc(day)} <span class="count">${sorted.length} appointment${sorted.length === 1 ? '' : 's'}</span></h2>
        <table>
          <thead><tr><th>Time</th><th>Resident</th><th>Service</th><th>Stylist</th></tr></thead>
          <tbody>${trs}</tbody>
        </table>
      </section>`
    })
    .join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Weekly Schedule — ${esc(facilityName)}</title>
<style>
  @page { margin: 1.2cm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1C1917; padding: 16px; }
  header { border-bottom: 4px solid #8B2E4A; padding-bottom: 12px; margin-bottom: 18px; }
  header h1 { font-size: 22px; color: #8B2E4A; }
  header p { font-size: 13px; color: #78716C; margin-top: 3px; }
  section { margin-bottom: 20px; page-break-inside: avoid; }
  h2 { font-size: 15px; margin-bottom: 6px; color: #1C1917; }
  h2 .count { font-size: 11px; font-weight: 400; color: #A8A29E; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #78716C; border-bottom: 2px solid #E7E5E4; padding: 4px 8px 6px 0; }
  td { padding: 6px 8px 6px 0; border-bottom: 1px solid #F5F5F4; vertical-align: top; }
  td.time { white-space: nowrap; font-weight: 600; color: #8B2E4A; width: 84px; }
  .room { font-size: 11px; color: #78716C; background: #F5F5F4; border-radius: 8px; padding: 1px 6px; margin-left: 4px; }
  .empty { color: #A8A29E; font-size: 14px; padding: 24px 0; text-align: center; }
  footer { margin-top: 24px; font-size: 10px; color: #A8A29E; }
</style>
</head>
<body>
  <header>
    <h1>${esc(facilityName)} — Weekly Salon Schedule</h1>
    <p>${esc(weekLabel)}</p>
  </header>
  ${daySections || '<p class="empty">No appointments scheduled this week.</p>'}
  <footer>Printed from Senior Stylist</footer>
</body>
</html>`.trim()
}
