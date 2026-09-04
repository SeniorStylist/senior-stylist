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

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { usePortalT, type PortalLang } from '@/lib/portal-i18n'
import { firstErrorMessage } from '@/lib/first-error'
import { PasswordFields } from '@/components/portal/password-fields'

// Stripe.js stays out of the wizard bundle until the payment step renders.
const AddCardForm = dynamic(
  () => import('@/components/payments/add-card-form').then((m) => m.AddCardForm),
  { ssr: false },
)

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
  /**
   * P54 — platform Stripe configured + not blocked: the review button reads
   * "Continue to Payment" and a card page follows. Server-computed; the POST
   * re-derives it, so a stale prop only mislabels the button, never the flow.
   */
  paymentsEnabled?: boolean
}

// P54 — no 'pending' phase anymore: unsure signups auto-create a resident
// ('created') and the admin keep-or-merges afterward. Every path succeeds.
// 'payment' is the card page between the wizard and the final screen.
type Phase = 'wizard' | 'payment' | 'auto_approved' | 'created'
type Relationship = 'self' | 'spouse' | 'child' | 'poa' | 'other'

// P52 — step IDs replace numeric indices; 'confirm' is present only when the
// match preview found a confident resident.
// P55 — 'email'+'phone' merged into ONE 'contact' screen (email OR phone, at
// least one — owner decision), and 'password' is a required step (username =
// email or phone, password = the password).
type StepId = 'who' | 'yourName' | 'resident' | 'confirm' | 'contact' | 'password' | 'review'

// P56 — the full step universe (for history-state validation) + reload blob.
const ALL_STEPS: readonly StepId[] = ['who', 'yourName', 'resident', 'confirm', 'contact', 'password', 'review']
const RESUME_TTL_MS = 30 * 60 * 1000

// P53 — no-spaces email gate (the old /.+@.+\..+/ passed "john smith@gmail.com"
// from a phone-keyboard space, which then 422'd server-side).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

type SignupMatchPreview = {
  residentName: string
  roomNumber: string | null
  poaMasked: string | null
  hasPoa: boolean
}

export function SignupClient({ facilityCode, facilityName, lang, previewMode = false, paymentsEnabled = false }: Props) {
  const t = usePortalT(lang)
  const [phase, setPhase] = useState<Phase>('wizard')
  const [stepId, setStepId] = useState<StepId>('who')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [alreadyHasAccess, setAlreadyHasAccess] = useState(false)

  // P54 — payment step state: where to land after the card page, which
  // resident the card belongs to, and the matched-signup card token (created
  // signups authorize via the freshly-minted portal session instead).
  const [afterPayment, setAfterPayment] = useState<'auto_approved' | 'created'>('created')
  const [cardResidentId, setCardResidentId] = useState<string | null>(null)
  const [cardToken, setCardToken] = useState<string | null>(null)
  const [cardSetupFailed, setCardSetupFailed] = useState(false)
  // P55 — which contact channel the account uses; keys the done-screen copy
  // (phone-only signups have no "check your email" to mention).
  const [doneContact, setDoneContact] = useState<'email' | 'phone'>('email')

  const [relationship, setRelationship] = useState<Relationship | null>(null)
  const [fullName, setFullName] = useState('')
  const [residentName, setResidentName] = useState('')
  const [roomNumber, setRoomNumber] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  // A2P web-opt-in requirement: consent is an ACTIVELY ticked checkbox — never
  // pre-checked. Required whenever a phone number is entered.
  const [smsConsent, setSmsConsent] = useState(false)
  // P55 — password created in the wizard (strength meter + confirm + show/hide)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')

  // P52 — "is this them?" preview. The server re-derives the match on submit;
  // this state only drives the confirm card + the familyConfirmed flag.
  const [match, setMatch] = useState<SignupMatchPreview | null>(null)
  const [familyConfirmed, setFamilyConfirmed] = useState(false)
  const [checking, setChecking] = useState(false)
  const matchAbortRef = useRef<AbortController | null>(null)

  const loginUrl = `/family/${encodeURIComponent(facilityCode)}/login`
  const isSelf = relationship === 'self'

  const steps: StepId[] = match
    ? ['who', 'yourName', 'resident', 'confirm', 'contact', 'password', 'review']
    : ['who', 'yourName', 'resident', 'contact', 'password', 'review']
  const stepIndex = Math.max(0, steps.indexOf(stepId))

  // P56 (Josh) — the wizard participates in browser history: every forward
  // move pushes an entry (same URL, state carries the step), the in-app Back
  // button IS history.back(), and popstate restores the step — so the phone's
  // back gesture / browser buttons walk the wizard instead of exiting it.
  const resumeKey = `ss_signup:${facilityCode}`
  const pushedRef = useRef(0) // wizard entries pushed THIS mount (0 after a fresh restore)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const matchRef = useRef(match)
  matchRef.current = match
  const passwordRef = useRef(password)
  passwordRef.current = password

  const goForward = (id: StepId) => {
    setError(null)
    setStepId(id)
    pushedRef.current += 1
    try { window.history.pushState({ ssStep: id }, '') } catch { /* ignore */ }
  }
  const next = () => goForward(steps[Math.min(stepIndex + 1, steps.length - 1)])
  const back = () => {
    setError(null)
    if (pushedRef.current > 0) {
      pushedRef.current -= 1
      window.history.back() // popstate handler restores the previous step
    } else {
      // Restored session with no in-tab entries behind us (rare re-entry):
      // step back in place so Back never throws the family out of the wizard.
      const prev = steps[Math.max(stepIndex - 1, 0)]
      setStepId(prev)
      try { window.history.replaceState({ ssStep: prev }, '') } catch { /* ignore */ }
    }
  }

  const pickRelationship = (r: Relationship) => {
    setRelationship(r)
    goForward('yourName')
  }

  // P56 — reload survival: restore typed answers (NEVER the password) and the
  // step, then seed the history entry. Runs after mount (not in initializers)
  // so SSR/hydration render the default 'who' step identically.
  useEffect(() => {
    if (previewMode) return // dry runs leave no residue and never resume
    let initial: StepId | null = null
    try {
      const raw = sessionStorage.getItem(resumeKey)
      if (raw) {
        const j = JSON.parse(raw) as Record<string, unknown>
        if (j && Date.now() - (Number(j.savedAt) || 0) <= RESUME_TTL_MS && typeof j.relationship === 'string') {
          setRelationship(j.relationship as Relationship)
          if (typeof j.fullName === 'string') setFullName(j.fullName)
          if (typeof j.residentName === 'string') setResidentName(j.residentName)
          if (typeof j.roomNumber === 'string') setRoomNumber(j.roomNumber)
          if (typeof j.email === 'string') setEmail(j.email)
          if (typeof j.phone === 'string') setPhone(j.phone)
          if (j.smsConsent === true) setSmsConsent(true)
          const s = ALL_STEPS.includes(j.step as StepId) ? (j.step as StepId) : 'who'
          // Clamps: 'confirm' needs the (unrestored) match preview → re-run it
          // from 'resident'; 'review' needs the password the family must retype.
          initial = s === 'confirm' ? 'resident' : s === 'review' ? 'password' : s
        }
      }
    } catch { /* ignore */ }
    if (initial && initial !== 'who') setStepId(initial)
    try { window.history.replaceState({ ssStep: initial ?? 'who' }, '') } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // P56 — browser back/forward. Entries without our ssStep marker are outside
  // the wizard — let the browser leave. After submit (phase !== 'wizard') the
  // leftover wizard entries auto-unwind so one back-press exits cleanly
  // instead of silently eating N presses.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const s = (e.state as { ssStep?: string } | null)?.ssStep as StepId | undefined
      if (!s || !ALL_STEPS.includes(s)) return
      if (phaseRef.current !== 'wizard') {
        window.history.back()
        return
      }
      setError(null)
      const clamped = s === 'confirm' && !matchRef.current
        ? 'resident'
        : s === 'review' && passwordRef.current.length < 8
        ? 'password'
        : s
      setStepId(clamped)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // P56 — persist the answers per keystroke/step (tab-scoped sessionStorage,
  // 30-min TTL, cleared on submit). The password is deliberately NEVER stored.
  useEffect(() => {
    if (previewMode || phase !== 'wizard' || !relationship) return
    try {
      sessionStorage.setItem(
        resumeKey,
        JSON.stringify({
          step: stepId,
          relationship,
          fullName,
          residentName,
          roomNumber,
          email,
          phone,
          smsConsent,
          savedAt: Date.now(),
        }),
      )
    } catch { /* storage full/blocked — resume just won't work */ }
  }, [previewMode, phase, stepId, relationship, fullName, residentName, roomNumber, email, phone, smsConsent, resumeKey])

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
    goForward(m ? 'confirm' : 'contact')
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
          // P55 — email OR phone (at least one, enforced by the contact step)
          email: email.trim() ? email.trim().toLowerCase() : null,
          fullName: fullName.trim(),
          facilityCode,
          phone: phone.trim() || null,
          password: password.length >= 8 && password === passwordConfirm ? password : undefined,
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
      const finalPhase: 'auto_approved' | 'created' = j.status === 'auto_approved' ? 'auto_approved' : 'created'
      // P56 — the signup is done: a reload must not resurrect the wizard.
      if (!previewMode) {
        try { sessionStorage.removeItem(resumeKey) } catch { /* ignore */ }
      }
      setDoneContact(j.contact === 'phone' ? 'phone' : 'email')
      // P54 — the card page. Real runs need a resident + (for matched signups)
      // the card token; the dry run shows the step's copy with entry skipped.
      const canTakeCard = previewMode
        ? j.paymentsEnabled === true
        : j.paymentsEnabled === true && !!j.residentId && (finalPhase === 'created' || !!j.cardToken)
      if (canTakeCard) {
        setAfterPayment(finalPhase)
        setCardResidentId(j.residentId ?? null)
        setCardToken(j.cardToken ?? null)
        setPhase('payment')
      } else {
        setPhase(finalPhase)
      }
    } catch {
      setError(t('common.networkError'))
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'w-full rounded-2xl border border-stone-200 px-4 text-lg min-h-[52px] focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20'
  const pillCls =
    'w-full min-h-[52px] rounded-2xl border-2 px-4 text-left text-lg font-medium transition-colors'
  const primaryBtnCls =
    'portal-cta-cap w-full min-h-[52px] rounded-2xl bg-[#8B2E4A] text-white font-semibold shadow-[0_4px_14px_rgba(139,46,74,0.35)] hover:bg-[#72253C] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all'

  // P54 — the card page (owner decisions: card on file is the default, no
  // visible opt-out; the reassurance copy carries the trust). The ONLY way
  // past without a card is the quiet link that appears if Stripe errors.
  if (phase === 'payment') {
    return (
      <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-6">
        <h2 className="text-xl font-semibold text-stone-800 text-center">{t('signup.payment.title')}</h2>
        <p className="text-base text-stone-500 text-center mt-2 mb-5">{t('signup.payment.reassure')}</p>
        {previewMode ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center">
              {t('signup.payment.preview')}
            </p>
            <button type="button" onClick={() => setPhase(afterPayment)} className={primaryBtnCls}>
              {t('signup.nav.next')}
            </button>
          </div>
        ) : cardResidentId ? (
          <>
            <AddCardForm
              residentId={cardResidentId}
              lang={lang}
              signupToken={cardToken ?? undefined}
              enableAutopay
              onSaved={() => setPhase(afterPayment)}
              onSetupError={() => setCardSetupFailed(true)}
            />
            {cardSetupFailed && (
              <button
                type="button"
                onClick={() => setPhase(afterPayment)}
                className="mt-4 mx-auto block text-sm text-stone-400 hover:text-stone-600 underline"
              >
                {t('signup.payment.skipAfterError')}
              </button>
            )}
          </>
        ) : null}
      </div>
    )
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
        {/* P55 — phone-only signups have no inbox: no "link on its way" copy */}
        <p className="text-base text-stone-500 mt-2">
          {doneContact === 'phone' ? t('signup.foundAccountPhone') : t('signup.foundAccount', { email })}
        </p>
        {doneContact === 'email' && <p className="text-sm text-stone-500 mt-2">{t('signup.linkExpirySpam')}</p>}
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

  // P54 — the uniform model: unsure signups create the account on the spot
  // (no more "we'll review your request" dead end).
  if (phase === 'created') {
    return (
      <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="text-lg font-semibold text-stone-800">
          {doneContact === 'phone' ? t('signup.createdPhone.title') : t('signup.created.title')}
        </p>
        <p className="text-base text-stone-500 mt-2">
          {doneContact === 'phone' ? t('signup.createdPhone.body') : t('signup.created.body')}
        </p>
        {doneContact === 'email' && <p className="text-sm text-stone-500 mt-2">{t('signup.linkExpirySpam')}</p>}
        {previewMode && (
          <p className="mt-3 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            {t('signup.preview.done')}
          </p>
        )}
        {/* P54 — created signups hold a real (7-day) session; land them inside. */}
        {!previewMode && (
          <Link
            href={`/family/${encodeURIComponent(facilityCode)}`}
            className="portal-cta-cap mt-5 flex items-center justify-center w-full min-h-[52px] rounded-2xl bg-[#8B2E4A] text-white font-semibold shadow-[0_4px_14px_rgba(139,46,74,0.35)] hover:bg-[#72253C] transition-all"
          >
            {t('signup.done.goToAccount')}
          </Link>
        )}
      </div>
    )
  }

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
            <p className="text-center text-base text-stone-500 -my-1">{t('signup.step.whoFamily')}</p>
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
              data-tour="signup-your-name"
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
                data-tour="signup-resident-name"
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
                data-tour="signup-room"
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
                onClick={() => { setFamilyConfirmed(true); goForward('contact') }}
                className={primaryBtnCls}
              >
                {t('signup.match.yes')}
              </button>
              <button
                type="button"
                onClick={() => { setFamilyConfirmed(false); setMatch(null); goForward('contact') }}
                className="portal-cta-cap w-full min-h-[52px] rounded-2xl border-2 border-stone-200 bg-white text-stone-700 font-semibold hover:bg-stone-50 active:scale-[0.98] transition-all"
              >
                {t('signup.match.no')}
              </button>
            </StepInput>
          </div>
        )
      case 'contact': {
        // P55 — ONE screen, email OR phone, at least one (owner decision:
        // "we need either your phone number or your email… encourage both").
        const emailOk = EMAIL_RE.test(email.trim())
        const phoneOk = phone.replace(/\D/g, '').length >= 7
        // A2P: a phone number can only proceed with the consent box actively
        // ticked; email-only signups are unaffected.
        const contactValid =
          (emailOk || phoneOk) &&
          (!email.trim() || emailOk) &&
          (!phone.trim() || (phoneOk && smsConsent))
        return (
          <StepInput title={t('signup.step.contact')} hint={t('signup.step.contactHint')}>
            <div className="flex flex-col gap-1.5">
              <label className="text-base font-medium text-stone-600" htmlFor="email">
                {t('signup.step.contactEmailLabel')}
              </label>
              <input
                id="email"
                type="email"
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                maxLength={320}
                aria-label={t('signup.step.contactEmailLabel')}
                className={inputCls}
              />
              {email.trim() && !emailOk && (
                <p className="text-sm text-amber-700">{t('signup.step.contactEmailInvalid')}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-base font-medium text-stone-600" htmlFor="phone">
                {t('signup.step.contactPhoneLabel')}
              </label>
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                maxLength={30}
                aria-label={t('signup.step.contactPhoneLabel')}
                className={inputCls}
                onKeyDown={(e) => { if (e.key === 'Enter' && contactValid) next() }}
              />
              {phone.trim() && !phoneOk && (
                <p className="text-sm text-amber-700">{t('signup.step.contactPhoneInvalid')}</p>
              )}
              {/* P56/A2P — SMS consent is an unchecked CHECKBOX the family
                  actively ticks (carrier requirement — never pre-selected),
                  with Privacy + Terms links. Links open a NEW tab — an
                  in-place nav would wipe the wizard. Campaign-load-bearing:
                  reviewers open this page. */}
              <label className="flex items-start gap-2.5 text-sm text-stone-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smsConsent}
                  onChange={(e) => setSmsConsent(e.target.checked)}
                  className="accent-[#8B2E4A] mt-0.5 h-5 w-5 shrink-0"
                />
                <span>
                  {t('signup.step.contactSmsConsent')}{' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">
                    {t('signup.step.privacyLink')}
                  </a>
                  {' · '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline">
                    {t('signup.step.termsLink')}
                  </a>
                </span>
              </label>
              {phone.trim() && phoneOk && !smsConsent && (
                <p className="text-sm text-amber-700">{t('signup.step.smsConsentRequired')}</p>
              )}
            </div>
            {!email.trim() && !phone.trim() && (
              <p className="text-sm text-stone-500 text-center">{t('signup.step.contactError')}</p>
            )}
            <button
              type="button"
              onClick={next}
              disabled={!contactValid}
              className={primaryBtnCls}
            >
              {t('signup.nav.next')}
            </button>
          </StepInput>
        )
      }
      case 'password':
        // P55 — required password (owner decision): sign in with email or
        // phone + this password. Meter + confirm + show/hide per the spec.
        return (
          <StepInput title={t('signup.step.password')} hint={t('signup.step.passwordHint')}>
            <PasswordFields
              password={password}
              confirm={passwordConfirm}
              onPasswordChange={setPassword}
              onConfirmChange={setPasswordConfirm}
              lang={lang}
            />
            <button
              type="button"
              onClick={next}
              disabled={password.length < 8 || password !== passwordConfirm}
              className={primaryBtnCls}
            >
              {t('signup.nav.next')}
            </button>
          </StepInput>
        )
      case 'review': {
        const rows: Array<[string, string, StepId]> = [
          [t('signup.review.you'), fullName, 'yourName'],
          ...(!isSelf ? ([[t('signup.review.resident'), residentName, 'resident']] as Array<[string, string, StepId]>) : []),
          ...(roomNumber.trim() ? ([[t('signup.review.room'), roomNumber, 'resident']] as Array<[string, string, StepId]>) : []),
          ...(email.trim() ? ([[t('signup.review.email'), email, 'contact']] as Array<[string, string, StepId]>) : []),
          ...(phone.trim() ? ([[t('signup.review.phone'), phone, 'contact']] as Array<[string, string, StepId]>) : []),
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
                    onClick={() => goForward(editStep)}
                    className="shrink-0 text-base font-semibold text-[#8B2E4A] min-h-[44px] px-2"
                  >
                    {t('signup.review.edit')}
                  </button>
                </div>
              ))}
            </div>
            {/* P54 — owner-locked: with payments configured the review step
                flows straight into the card page ("Continue to Payment"). */}
            <button type="button" onClick={handleSubmit} disabled={submitting} className={primaryBtnCls}>
              {submitting
                ? t('signup.creating')
                : paymentsEnabled
                  ? t('signup.review.submit')
                  : t('signup.review.submitNoPay')}
            </button>
          </div>
        )
      }
      default:
        return null
    }
  }

  return (
    <div
      data-tour="signup-wizard"
      className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] overflow-hidden"
    >
      {/* P54 — the P26 value strip is GONE (owner decision: the page should
          just read facility → Create Account → wizard, no marketing copy). */}
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
