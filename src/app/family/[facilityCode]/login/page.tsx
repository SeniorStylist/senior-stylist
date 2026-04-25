import { LoginClient } from './login-client'

export const dynamic = 'force-dynamic'

export default async function FamilyLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ facilityCode: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { facilityCode } = await params
  const { error } = await searchParams
  const decoded = decodeURIComponent(facilityCode)

  let errorMessage: string | null = null
  if (error === 'no_access') {
    errorMessage = "We couldn't find a resident at this facility for your account. Try requesting a fresh link below."
  } else if (error === 'invalid_link') {
    errorMessage = 'This link has expired or already been used. Please request a new one below.'
  }

  return (
    <div className="page-enter flex flex-col gap-4 mt-6">
      <header>
        <h1 className="text-2xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
          Family Portal
        </h1>
        <p className="text-sm text-stone-500 mt-1">Sign in to view appointments, request service, and pay balances.</p>
      </header>
      {errorMessage && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{errorMessage}</div>
      )}
      <LoginClient facilityCode={decoded} />
    </div>
  )
}
