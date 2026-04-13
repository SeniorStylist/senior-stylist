import { db } from '@/db'
import { residents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { PortalClient } from './portal-client'

export default async function PortalPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const resident = await db.query.residents.findFirst({
    where: eq(residents.portalToken, token),
  })

  if (!resident) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-8 max-w-sm w-full text-center">
          <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p className="text-base font-semibold text-stone-700 mb-1">Link not found</p>
          <p className="text-sm text-stone-400">This portal link is invalid or has expired. Please contact your facility.</p>
        </div>
      </div>
    )
  }

  return (
    <PortalClient
      token={token}
      residentName={resident.name}
      roomNumber={resident.roomNumber}
      poaName={resident.poaName}
      poaEmail={resident.poaEmail}
      poaNotificationsEnabled={resident.poaNotificationsEnabled}
    />
  )
}
