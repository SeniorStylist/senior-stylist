import { LoginClient } from './login-client'
import { FamilyModeEscape } from '@/components/portal/family-mode-escape'
import { getPortalT } from '@/lib/portal-i18n-server'

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
  const { lang, t } = await getPortalT()

  let errorMessage: string | null = null
  if (error === 'no_access') {
    errorMessage = t('login.errNoAccess')
  } else if (error === 'invalid_link') {
    errorMessage = t('login.errInvalidLink')
  }

  return (
    <div className="page-enter flex flex-col gap-4 mt-6">
      <header>
        <h1 className="text-2xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif', fontWeight: 400 }}>
          {t('login.title')}
        </h1>
        <p className="text-sm text-stone-500 mt-1">{t('login.subtitle')}</p>
      </header>
      {errorMessage && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{errorMessage}</div>
      )}
      <LoginClient facilityCode={decoded} lang={lang} />
      <FamilyModeEscape />
    </div>
  )
}
