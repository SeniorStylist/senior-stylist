import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  createPortalSession,
  setPortalSessionCookie,
  verifyMagicLink,
} from '@/lib/portal-auth'
import { VerifySetPassword } from './verify-set-password'

export const dynamic = 'force-dynamic'

export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ facilityCode: string }>
  searchParams: Promise<{ token?: string }>
}) {
  const { facilityCode } = await params
  const { token } = await searchParams
  const decoded = decodeURIComponent(facilityCode)

  if (!token) {
    redirect(`/family/${encodeURIComponent(decoded)}/login?error=invalid_link`)
  }

  const result = await verifyMagicLink(token)

  if (!result) {
    return (
      <div className="page-enter mt-8 bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className="text-base font-semibold text-stone-800">Link expired</p>
        <p className="text-sm text-stone-500 mt-1">This sign-in link has expired or already been used.</p>
        <Link
          href={`/family/${encodeURIComponent(decoded)}/login`}
          className="inline-flex items-center justify-center bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-3 mt-5 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C]"
        >
          Request a new link
        </Link>
      </div>
    )
  }

  const sessionToken = await createPortalSession(result.portalAccountId)
  await setPortalSessionCookie(sessionToken)

  return (
    <div className="page-enter mt-6">
      <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="text-base font-semibold text-stone-800">You&apos;re signed in</p>
        <p className="text-sm text-stone-500 mt-1">Welcome back, {result.email}.</p>
      </div>

      <VerifySetPassword facilityCode={decoded} />
    </div>
  )
}
