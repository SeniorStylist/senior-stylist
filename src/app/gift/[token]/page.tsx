// P55 — public shareable gift page. A relative with the link can send salon
// credit for ONE resident. Shows ONLY the facility name and the resident's
// first name + masked surname — never room, balance, appointments, or contact
// info (that ruling is why the legacy /api/portal/[token] data routes were
// retired alongside this page).

import { notFound } from 'next/navigation'
import Image from 'next/image'
import { db } from '@/db'
import { facilities, residents } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { maskName } from '@/lib/name-mask'
import { getPortalT } from '@/lib/portal-i18n-server'
import { GiftClient } from './gift-client'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Senior Stylist — Send a Gift' }

export default async function GiftPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ success?: string }>
}) {
  const { token } = await params
  const { success } = await searchParams
  if (!token || token.length > 200) notFound()

  const resident = await db.query.residents.findFirst({
    where: and(eq(residents.portalToken, token), eq(residents.active, true), eq(residents.isDemo, false)),
    columns: { id: true, name: true, facilityId: true },
  })
  if (!resident) notFound()

  const facility = await db.query.facilities.findFirst({
    where: and(eq(facilities.id, resident.facilityId), eq(facilities.active, true), eq(facilities.isDemo, false)),
    columns: { id: true, name: true },
  })
  if (!facility) notFound()

  const { lang, t } = await getPortalT()

  // First name in full, surname masked (fixed 3 bullets — never leaks length).
  const parts = resident.name.trim().split(/\s+/)
  const displayName = parts.length > 1 ? `${parts[0]} ${maskName(parts[parts.length - 1])}` : parts[0]

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="px-6 py-8 text-center" style={{ backgroundColor: '#8B2E4A' }}>
        <Image
          src="/seniorstylistlogo-white.png"
          alt="Senior Stylist"
          width={180}
          height={145}
          className="mx-auto"
          style={{ objectFit: 'contain', height: 48, width: 'auto' }}
        />
        <p className="text-white/80 text-sm mt-3">{facility.name}</p>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 pt-8 pb-12">
        <div className="w-full max-w-sm">
          <h1
            className="text-2xl text-stone-900 text-center mb-1"
            style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}
          >
            {t('gift.for', { name: displayName })}
          </h1>
          <p className="text-sm text-stone-500 text-center mb-5">
            {t('gift.subtitle', { facility: facility.name, name: parts[0] })}
          </p>
          <GiftClient token={token} lang={lang} firstName={parts[0]} success={success === '1'} />
        </div>
      </main>
    </div>
  )
}
