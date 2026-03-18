import { db } from '@/db'
import { facilities, bookings, residents, services, stylists } from '@/db/schema'
import { eq, and, gte, lt } from 'drizzle-orm'
import { PrintButton } from './print-button'

function formatCentsDisplay(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ facilityId: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const { facilityId } = await params
  const { month } = await searchParams

  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const targetMonth = (month && /^\d{4}-\d{2}$/.test(month)) ? month : currentMonth
  const [year, mon] = targetMonth.split('-').map(Number)
  const monthStart = new Date(year, mon - 1, 1)
  const monthEnd = new Date(year, mon, 1)

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
  })

  if (!facility) {
    return (
      <div className="p-8">
        <p className="text-stone-500">Facility not found.</p>
      </div>
    )
  }

  const invoiceBookings = await db.query.bookings.findMany({
    where: and(
      eq(bookings.facilityId, facilityId),
      eq(bookings.status, 'completed'),
      gte(bookings.startTime, monthStart),
      lt(bookings.startTime, monthEnd)
    ),
    with: {
      resident: true,
      service: true,
      stylist: true,
    },
    orderBy: (t, { asc }) => [asc(t.startTime)],
  })

  // Group by resident
  const byResident: Record<string, {
    resident: typeof invoiceBookings[0]['resident']
    rows: typeof invoiceBookings
  }> = {}

  for (const b of invoiceBookings) {
    if (!byResident[b.residentId]) {
      byResident[b.residentId] = { resident: b.resident, rows: [] }
    }
    byResident[b.residentId].rows.push(b)
  }

  const grandTotal = invoiceBookings.reduce((sum, b) => sum + (b.priceCents ?? 0), 0)

  const monthLabel = new Date(year, mon - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="max-w-4xl mx-auto p-8 print:p-4" style={{ fontFamily: 'Georgia, serif', backgroundColor: 'white', minHeight: '100vh' }}>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between print:mb-6">
        <div>
          <h1 className="text-3xl font-bold text-stone-900 mb-1">{facility.name}</h1>
          {facility.address && <p className="text-stone-500 text-sm">{facility.address}</p>}
          {facility.phone && <p className="text-stone-500 text-sm">{facility.phone}</p>}
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-stone-700">Invoice</p>
          <p className="text-stone-500 text-sm mt-1">{monthLabel}</p>
        </div>
      </div>

      <hr className="border-stone-200 mb-8" />

      {Object.keys(byResident).length === 0 ? (
        <p className="text-stone-400 text-center py-16">No completed appointments for {monthLabel}.</p>
      ) : (
        Object.values(byResident).map(({ resident: res, rows }) => {
          const subtotal = rows.reduce((sum, b) => sum + (b.priceCents ?? 0), 0)
          return (
            <div key={res.id} className="mb-8 print:mb-6 break-inside-avoid">
              <div className="bg-stone-50 rounded-lg px-4 py-2.5 mb-2 flex items-center gap-3">
                <p className="font-bold text-stone-800">{res.name}</p>
                {res.roomNumber && (
                  <span className="text-stone-500 text-sm">Room {res.roomNumber}</span>
                )}
              </div>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-stone-200">
                    <th className="text-left py-2 px-2 text-xs font-semibold text-stone-500 uppercase">Date</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-stone-500 uppercase">Service</th>
                    <th className="text-left py-2 px-2 text-xs font-semibold text-stone-500 uppercase">Stylist</th>
                    <th className="text-right py-2 px-2 text-xs font-semibold text-stone-500 uppercase">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id} className="border-b border-stone-100">
                      <td className="py-2 px-2 text-stone-600">
                        {new Date(b.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </td>
                      <td className="py-2 px-2 text-stone-800 font-medium">{b.service.name}</td>
                      <td className="py-2 px-2 text-stone-600">{b.stylist.name}</td>
                      <td className="py-2 px-2 text-right font-semibold text-stone-800">
                        {formatCentsDisplay(b.priceCents ?? 0)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-stone-50">
                    <td colSpan={3} className="py-2 px-2 text-right text-sm font-semibold text-stone-600">
                      Subtotal
                    </td>
                    <td className="py-2 px-2 text-right font-bold text-stone-900">
                      {formatCentsDisplay(subtotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        })
      )}

      {Object.keys(byResident).length > 0 && (
        <div className="mt-6 border-t-2 border-stone-300 pt-4 flex justify-end">
          <div className="text-right">
            <p className="text-sm text-stone-500 mb-1">Grand Total</p>
            <p className="text-3xl font-bold text-stone-900">{formatCentsDisplay(grandTotal)}</p>
          </div>
        </div>
      )}

      <div className="mt-8 print:hidden">
        <PrintButton />
      </div>
    </div>
  )
}
