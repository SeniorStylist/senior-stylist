'use client'

// P50 — senior-first signup wizard: one big question per screen.
//
// Design rules (do not regress):
// - Inputs are text-lg (18px — also kills the iOS focus-zoom) with
//   min-h-[52px] touch targets; option pills the same.
// - One primary action per screen; Back is always available from step 2.
// - Every string is an en/es PORTAL_STRINGS pair.
// - The wizard now asks WHO the resident is (name + room) — that's what lets
//   the admin approve a claim in one click instead of guessing from a
//   full-facility dropdown.
// - dateOfBirth was dropped from the UI (stored-but-unused; less friction,
//   less PII). The API still accepts it for back-compat.
// - P52: steps are IDs, not indices. Leaving the resident step runs the match
//   preview (POST /api/portal/signup/match, 3s timeout, NEVER blocks); a
//   confident match inserts the 'confirm' ("is this them?") step. The server
//   re-derives the match on submit — familyConfirmed is only an assertion.

import { useRef, useState } from 'react'
import Link from 'next/link'
import { usePortalT, type PortalLang } from '@/lib/portal-i18n'
import { firstErrorMessage } from '@/lib/first-error'

interface Props {
  facilityCode: string
  facilityName: string
  lang: PortalLang
  /**
   * P53 — master-only DRY RUN: the POST carries preview:true (server-verified
   * master session) and writes nothing; both confirmation screens render with
   * a "nothing was created" note. Client-asserted, server-enforced.
   */
  previewMode?: boolean
}

type Phase = 'wizard' | 'auto_approved' | 'pending'
type Relationship = 'self' | 'spouse' | 'child' | 'poa' | 'other'

// P52 — step IDs replace numeric indices; 'confirm' is present only when the
// match preview found a confident resident (steps.length is 6 or 7).
type StepId = 'who' | 'yourName' | 'resident' | 'confirm' | 'email' | 'phone' | 'review'

// P53 — no-spaces email gate (the old /.+@.+\..+/ passed "john smith@gmail.com"
// from a phone-keyboard space, which then 422'd server-side).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

type SignupMatchPreview = {
  residentName: string
  roomNumber: string | null
  poaMasked: string | null
  hasPoa: boolean
}

export function SignupClient({ facilityCode, facilityName, lang, previewMode = false }: Props) {
  const t = usePortalT(lang)
  const [phase, setPhase] = useState<Phase>('wizard')
  const [stepId, setStepId] = useState<StepId>('who')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [alreadyHasAccess, setAlreadyHasAccess] = useState(false)

  const [relationship, setRelationship] = useState<Relationship | null>(null)
  const [fullName, setFullName] = useState('')
  const [residentName, setResidentName] = useState('')
  const [roomNumber, setRoomNumber] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  // P52 — "is this them?" preview. The server re-derives the match on submit;
  // this state only drives the confirm card + the familyConfirmed flag.
  const [match, setMatch] = useState<SignupMatchPreview | null>(null)
  const [familyConfirmed, setFamilyConfirmed] = useState(false)
  const [checking, setChecking] = useState(false)
  const matchAbortRef = useRef<AbortController | null>(null)

  const loginUrl = `/family/${encodeURIComponent(facilityCode)}/login`
  const isSelf = relationship === 'self'

  const steps: StepId[] = match
    ? ['who', 'yourName', 'resident', 'confirm', 'email', 'phone', 'review']
    : ['who', 'yourName', 'resident', 'email', 'phone', 'review']
  const stepIndex = Math.max(0, steps.indexOf(stepId))

  const goTo = (id: StepId) => {
    setError(null)
    setStepId(id)
  }
  const next = () => goTo(steps[Math.min(stepIndex + 1, steps.length - 1)])
  const back = () => goTo(steps[Math.max(stepIndex - 1, 0)])

  const pickRelationship = (r: Relationship) => {
    setRelationship(r)
    setError(null)
    setStepId('yourName')
  }

  // A retype invalidates any previous match — no stale confirm card.
  const onResidentEdit = () => {
    setMatch(null)
    setFamilyConfirmed(false)
  }

  // P52 — leaving the resident step runs the match preview. NEVER blocks
  // signup: any failure/timeout/429 → no match → the confirm step is skipped.
  const advanceFromResident = async () => {
    setError(null)
    setChecking(true)
    matchAbortRef.current?.abort()
    const ctrl = new AbortController()
    matchAbortRef.current = ctrl
    const timer = setTimeout(() => ctrl.abort(), 3000)
    let m: SignupMatchPreview | null = null
    try {
      const res = await fetch('/api/portal/signup/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilityCode,
          residentName: (isSelf ? fullName : residentName).trim(),
          roomNumber: roomNumber.trim() || null,
        }),
        signal: ctrl.signal,
      })
      if (res.ok) {
        const j = await res.json().catch(() => null)
        m = j?.data?.match ?? null
      }
    } catch {
      m = null
    } finally {
      clearTimeout(timer)
      setChecking(false)
    }
    setMatch(m)
    setFamilyConfirmed(false)
    setStepId(m ? 'confirm' : 'email')
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    setAlreadyHasAccess(false)
    try {
      const res = await fetch('/api/portal/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          fullName: fullName.trim(),
          facilityCode,
          phone: phone.trim() || null,
          residentName: (isSelf ? fullName : residentName).trim(),
          roomNumber: roomNumber.trim() || null,
          relationship: relationship ?? undefined,
          familyConfirmed: familyConfirmed && !!match,
          ...(previewMode ? { preview: true } : {}),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 409) {
          setAlreadyHasAccess(true)
          setError(t('signup.alreadyAccess'))
          return
        }
        if (res.status === 429) {
          // P53 — translated, not the raw "Too many requests" (lobby sign-up events)
          setError(t('signup.tooMany'))
          return
        }
        // P53 — firstErrorMessage: a Zod flatten() OBJECT rendered as a React
        // child crashed the whole wizard and lost the typed data.
        setError(firstErrorMessage(j) ?? t('common.error'))
        return
      }
      setPhase(j.status === 'auto_approved' ? 'auto_approved' : 'pending')
    } catch {
      setError(t('common.networkError'))
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'auto_approved') {
    return (
      <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="text-lg font-semibold text-stone-800">{t('signup.welcome', { facility: facilityName })}</p>
        <p className="text-base text-stone-500 mt-2">{t('signup.foundAccount', { email })}</p>
        <p className="text-sm text-stone-500 mt-2">{t('signup.linkExpirySpam')}</p>
        {previewMode && (
          <p className="mt-3 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            {t('signup.preview.done')}
          </p>
        )}
        <Link href={loginUrl} className="mt-5 inline-block text-base font-semibold text-[#8B2E4A] hover:underline">
          {t('signup.goToSignIn')}
        </Link>
      </div>
    )
  }

  if (phase === 'pending') {
    return (
      <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className="text-lg font-semibold text-stone-800">{t('signup.pendingTitle')}</p>
        <p className="text-base text-stone-500 mt-2">{t('signup.pendingBody')}</p>
        <p className="text-sm text-stone-500 mt-3">{t('signup.pendingEta')}</p>
        {previewMode && (
          <p className="mt-3 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            {t('signup.preview.done')}
          </p>
        )}
      </div>
    )
  }

  const inputCls =
    'w-full rounded-2xl border border-stone-200 px-4 text-lg min-h-[52px] focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20'
  const pillCls =
    'w-full min-h-[52px] rounded-2xl border-2 px-4 text-left text-lg font-medium transition-colors'
  const primaryBtnCls =
    'portal-cta-cap w-full min-h-[52px] rounded-2xl bg-[#8B2E4A] text-white font-semibold shadow-[0_4px_14px_rgba(139,46,74,0.35)] hover:bg-[#72253C] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all'

  const stepBody = () => {
    switch (stepId) {
      case 'who':
        return (
          <div className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold text-stone-800 text-center">{t('signup.step.whoTitle')}</h2>
            <button
              type="button"
              onClick={() => pickRelationship('self')}
              className={`${pillCls} ${isSelf ? 'border-[#8B2E4A] bg-[#F9EFF2] text-[#8B2E4A]' : 'border-stone-200 bg-white text-stone-700'}`}
            >
              {t('signup.step.whoSelf', { facility: facilityName })}
            </button>
            <p className="text-center text-base text-stone-500 -my-1">{t('signup.step.whoFamily')}:</p>
            {(['spouse', 'child', 'poa', 'other'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => pickRelationship(r)}
                className={`${pillCls} ${relationship === r ? 'border-[#8B2E4A] bg-[#F9EFF2] text-[#8B2E4A]' : 'border-stone-200 bg-white text-stone-700'}`}
              >
                {t(`signup.role.${r}`)}
              </button>
            ))}
          </div>
        )
      case 'yourName':
        return (
          <StepInput
            title={t('signup.step.yourName')}
            hint={isSelf ? undefined : t('signup.fullNameHint')}
          >
            <input
              id="fullName"
              type="text"
              autoFocus
              autoComplete="name"
              value={fullName}
              onChange={(e) => { setFullName(e.target.value); if (isSelf) onResidentEdit() }}
              placeholder="Jane Smith"
              maxLength={200}
              aria-label={t('signup.step.yourName')}
              className={inputCls}
              onKeyDown={(e) => { if (e.key === 'Enter' && fullName.trim().length >= 2) next() }}
            />
            <button type="button" onClick={next} disabled={fullName.trim().length < 2} className={primaryBtnCls}>
              {t('signup.nav.next')}
            </button>
          </StepInput>
        )
      case 'resident':
        return (
          <StepInput
            title={isSelf ? t('signup.step.roomSelf') : t('signup.step.residentName')}
            hint={isSelf ? t('signup.step.roomHint') : t('signup.step.residentHint', { facility: facilityName })}
          >
            {!isSelf && (
              <input
                id="residentName"
                type="text"
                autoFocus
                value={residentName}
                onChange={(e) => { setResidentName(e.target.value); onResidentEdit() }}
                placeholder="Margaret Smith"
                maxLength={200}
                aria-label={t('signup.step.residentName')}
                className={inputCls}
              />
            )}
            <div className="flex flex-col gap-1.5">
              {!isSelf && (
                <label className="text-base font-medium text-stone-600" htmlFor="roomNumber">
                  {t('signup.step.room')} <span className="text-stone-400 font-normal">{t('signup.optional')}</span>
                </label>
              )}
              <input
                id="roomNumber"
                type="text"
                autoFocus={isSelf}
                value={roomNumber}
                onChange={(e) => { setRoomNumber(e.target.value); onResidentEdit() }}
                placeholder="112"
                maxLength={50}
                inputMode="numeric"
                aria-label={t('signup.step.room')}
                className={inputCls}
              />
              {isSelf && <p className="text-sm text-stone-500">{t('signup.step.roomHint')}</p>}
            </div>
            <button
              type="button"
              onClick={advanceFromResident}
              disabled={checking || (!isSelf && residentName.trim().length < 2) || (isSelf && fullName.trim().length < 2)}
              className={primaryBtnCls}
            >
              {checking ? t('signup.match.checking') : t('signup.nav.next')}
            </button>
          </StepInput>
        )
      case 'confirm':
        // P52 — "is this them?" card. Only reachable when the preview returned
        // a confident match; the server independently re-derives it on submit.
        return (
          <div className="flex flex-col gap-4">
            <StepInput title={t('signup.match.title')} hint={t('signup.match.hint', { facility: facilityName })}>
              <div className="rounded-2xl border-2 border-[#8B2E4A]/20 bg-[#F9EFF2] px-5 py-4 text-center">
                <p className="text-xl font-semibold text-stone-900 break-words">{match?.residentName}</p>
                {match?.roomNumber && (
                  <span className="inline-block mt-2 text-sm font-semibold text-stone-600 bg-white border border-stone-200 rounded-full px-3 py-1">
                    {t('signup.match.roomLabel', { room: match.roomNumber })}
                  </span>
                )}
                {match?.hasPoa && match.poaMasked && (
                  <p className="text-base text-stone-500 mt-2.5">
                    {t('signup.match.poaLine', { name: match.poaMasked })}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setFamilyConfirmed(true); goTo('email') }}
                className={primaryBtnCls}
              >
                {t('signup.match.yes')}
              </button>
              <button
                type="button"
                onClick={() => { setFamilyConfirmed(false); setMatch(null); goTo('email') }}
                className="portal-cta-cap w-full min-h-[52px] rounded-2xl border-2 border-stone-200 bg-white text-stone-700 font-semibold hover:bg-stone-50 active:scale-[0.98] transition-all"
              >
                {t('signup.match.no')}
              </button>
            </StepInput>
          </div>
        )
      case 'email':
        return (
          <StepInput title={t('signup.step.email')} hint={t('signup.step.emailHint')}>
            <input
              id="email"
              type="email"
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              maxLength={320}
              aria-label={t('signup.step.email')}
              className={inputCls}
              onKeyDown={(e) => { if (e.key === 'Enter' && EMAIL_RE.test(email.trim())) next() }}
            />
            <button
              type="button"
              onClick={next}
              disabled={!EMAIL_RE.test(email.trim())}
              className={primaryBtnCls}
            >
              {t('signup.nav.next')}
            </button>
          </StepInput>
        )
      case 'phone':
        return (
          <StepInput title={t('signup.step.phone')} hint={t('signup.step.phoneHint')}>
            <input
              id="phone"
              type="tel"
              autoFocus
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              maxLength={30}
              aria-label={t('signup.step.phone')}
              className={inputCls}
            />
            <button type="button" onClick={next} className={primaryBtnCls}>
              {phone.trim() ? t('signup.nav.next') : t('signup.nav.skip')}
            </button>
          </StepInput>
        )
      case 'review': {
        const rows: Array<[string, string, StepId]> = [
          [t('signup.review.you'), fullName, 'yourName'],
          ...(!isSelf ? ([[t('signup.review.resident'), residentName, 'resident']] as Array<[string, string, StepId]>) : []),
          ...(roomNumber.trim() ? ([[t('signup.review.room'), roomNumber, 'resident']] as Array<[string, string, StepId]>) : []),
          [t('signup.review.email'), email, 'email'],
          ...(phone.trim() ? ([[t('signup.review.phone'), phone, 'phone']] as Array<[string, string, StepId]>) : []),
        ]
        return (
          <div className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold text-stone-800 text-center">{t('signup.review.title')}</h2>
            <div className="rounded-2xl border border-stone-200 divide-y divide-stone-100">
              {rows.map(([label, value, editStep]) => (
                <div key={label} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-stone-500">{label}</p>
                    <p className="text-lg text-stone-800 break-words">{value}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => goTo(editStep)}
                    className="shrink-0 text-base font-semibold text-[#8B2E4A] min-h-[44px] px-2"
                  >
                    {t('signup.review.edit')}
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={handleSubmit} disabled={submitting} className={primaryBtnCls}>
              {submitting ? t('signup.creating') : t('signup.review.submit')}
            </button>
          </div>
        )
      }
      default:
        return null
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] overflow-hidden">
      {/* P26 — say what the portal gives them BEFORE asking for their details */}
      {stepId === 'who' && (
        <div className="bg-[#F9EFF2] px-5 py-3 border-b border-rose-100">
          <p className="text-base text-[#8B2E4A]">{t('signup.valueStrip')}</p>
        </div>
      )}

      <div className="p-5 flex flex-col gap-5">
        {/* Progress: dots + step label */}
        <div className="flex items-center justify-between">
          {stepIndex > 0 ? (
            <button type="button" onClick={back} className="text-base font-medium text-stone-500 min-h-[44px] pr-3">
              {t('signup.nav.back')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1.5" aria-label={t('signup.progress', { step: String(stepIndex + 1), total: String(steps.length) })}>
            {steps.map((id, i) => (
              <span
                key={id}
                className={`rounded-full transition-all ${i === stepIndex ? 'w-5 h-2 bg-[#8B2E4A]' : 'w-2 h-2 bg-stone-200'}`}
                aria-hidden
              />
            ))}
          </div>
          <span className="text-sm text-stone-400 pl-3">{stepIndex + 1}/{steps.length}</span>
        </div>

        {stepBody()}

        {error && (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700">
            {error}
            {alreadyHasAccess && (
              <span> <Link href={loginUrl} className="font-semibold underline">{t('signup.signIn')}</Link></span>
            )}
          </div>
        )}

        {stepId === 'who' && (
          <p className="text-center text-base text-stone-500">
            {t('signup.haveAccount')}{' '}
            <Link href={loginUrl} className="font-semibold text-[#8B2E4A] hover:underline">
              {t('login.signIn')}
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}

function StepInput({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold text-stone-800 text-center">{title}</h2>
      {hint && <p className="text-base text-stone-500 text-center -mt-1">{hint}</p>}
      {children}
    </div>
  )
}
