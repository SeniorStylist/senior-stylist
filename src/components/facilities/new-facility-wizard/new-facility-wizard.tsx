'use client'

// P60 — THE facility-creation flow. Replaces the three inline forms
// (master-admin, Settings → Advanced, /onboarding) with one full-page wizard:
//   Facility → Hours → [Stylists] → [Services] → Billing → Done
// The bracketed steps render for the manage tier only (the page decides).
//
// Contract: POST /api/facilities fires ONCE, on Hours → Continue; after a
// 201 the first two steps become read-only summaries so a second create is
// impossible. Every later write names the facility explicitly
// (resolveFacilityWrite server-side) — the wizard never relies on the
// selected-facility cookie.

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { Building2, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { workingHoursValid } from '@/components/facilities/working-hours-editor'
import { DEFAULT_WORKING_HOURS } from '@/lib/facility-options'
import { cn } from '@/lib/utils'
import { StepBasics, basicsValid, nameDuplicate } from './step-basics'
import { StepHours } from './step-hours'
import { StepStylists } from './step-stylists'
import { StepServices } from './step-services'
import { StepLaunch, launchValid } from './step-launch'
import { StepDone } from './step-done'
import type { StepId, WizardCaps, WizardState } from './wizard-types'

type Action =
  | { type: 'patch'; patch: Partial<WizardState> }
  | { type: 'step'; step: StepId }
  | { type: 'busy'; busy: boolean }
  | { type: 'error'; error: string | null }

function reducer(s: WizardState, a: Action): WizardState {
  switch (a.type) {
    case 'patch':
      return { ...s, ...a.patch }
    case 'step':
      return { ...s, step: a.step, error: null }
    case 'busy':
      return { ...s, busy: a.busy }
    case 'error':
      return { ...s, error: a.error }
  }
}

const STEP_LABEL: Record<StepId, string> = {
  basics: 'Facility',
  hours: 'Hours',
  stylists: 'Stylists',
  services: 'Services',
  launch: 'Billing',
  done: 'Done',
}

function initialState(caps: WizardCaps): WizardState {
  return {
    step: 'basics',
    facility: null,
    basics: { name: '', facilityCode: caps.canEditCode ? caps.suggestedCode : '', address: '', phone: '', contactEmail: '', timezone: 'America/New_York' },
    hours: DEFAULT_WORKING_HOURS,
    stylists: { picked: [], imported: null, assignedCount: null },
    services: null,
    launch: { paymentType: 'ip', revSharePercentage: '', qbRevShareType: 'we_deduct', autopayMode: 'on_completion', autopaySweepCadence: 'nightly', franchiseId: '' },
    saved: { launch: false, franchise: false },
    busy: false,
    error: null,
    conflict: null,
    suggestedCodeFromServer: null,
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>
}

export function NewFacilityWizard({ caps }: { caps: WizardCaps }) {
  const { toast } = useToast()
  const [state, dispatch] = useReducer(reducer, caps, initialState)
  const [allowInactive, setAllowInactive] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)

  const steps = useMemo<StepId[]>(
    () => ['basics', 'hours', ...(caps.canManageStylists ? (['stylists'] as StepId[]) : []), ...(caps.canImportServices ? (['services'] as StepId[]) : []), 'launch', 'done'],
    [caps.canManageStylists, caps.canImportServices],
  )
  const idx = steps.indexOf(state.step)
  const visibleSteps = steps.filter((s) => s !== 'done')
  const progress = state.step === 'done' ? 100 : Math.round(((idx + 1) / visibleSteps.length) * 100)
  const locked = state.facility !== null

  // Leave-guard: a half-configured facility already exists.
  const dirtyFacility = locked && state.step !== 'done'
  useEffect(() => {
    if (!dirtyFacility) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirtyFacility])

  const patch = useCallback((p: Partial<WizardState>) => dispatch({ type: 'patch', patch: p }), [])
  const setError = useCallback((error: string | null) => dispatch({ type: 'error', error }), [])
  // A step change clears the previous step's error, so anything that sends the
  // user BACK with a message must dispatch the step first and the message
  // second — otherwise a code-clash 409 bounced to Basics with no explanation
  // at all (the conflict card only covers duplicate names).
  const go = (step: StepId) => {
    dispatch({ type: 'step', step })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
    document.querySelector('.main-content')?.scrollTo({ top: 0 })
  }

  // ── Create (Hours → Continue) ──────────────────────────────────────────
  const createFacility = async (): Promise<boolean> => {
    dispatch({ type: 'busy', busy: true })
    setError(null)
    try {
      const b = state.basics
      const res = await fetch('/api/facilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: b.name.trim(),
          ...(caps.canEditCode && b.facilityCode.trim() ? { facilityCode: b.facilityCode.trim().toUpperCase() } : {}),
          ...(b.address.trim() ? { address: b.address.trim() } : {}),
          ...(b.phone.trim() ? { phone: b.phone.trim() } : {}),
          ...(b.contactEmail.trim() ? { contactEmail: b.contactEmail.trim() } : {}),
          timezone: b.timezone,
          workingHours: state.hours,
          ...(allowInactive ? { allowInactiveNameMatch: true } : {}),
        }),
      })
      const j = await readJson(res)
      if (res.status === 409) {
        const conflict = j.conflict as WizardState['conflict'] | undefined
        const suggestedCode = typeof j.suggestedCode === 'string' ? j.suggestedCode : null
        go('basics')
        patch({
          conflict: conflict ?? null,
          suggestedCodeFromServer: suggestedCode,
          error: typeof j.error === 'string' ? j.error : 'That facility already exists',
        })
        return false
      }
      if (!res.ok) {
        setError(typeof j.error === 'string' ? j.error : 'Could not create the facility')
        return false
      }
      const data = j.data as { id: string; name: string; facilityCode: string | null; codeWasGenerated?: boolean }
      patch({ facility: { id: data.id, name: data.name, facilityCode: data.facilityCode }, conflict: null, suggestedCodeFromServer: null })
      toast.success(`${data.facilityCode ? `${data.facilityCode} · ` : ''}${data.name} created`)
      return true
    } catch {
      setError('Network error — nothing was created. Try again.')
      return false
    } finally {
      dispatch({ type: 'busy', busy: false })
    }
  }

  // ── Stylists → Continue ────────────────────────────────────────────────
  const commitStylists = async (): Promise<boolean> => {
    if (!state.facility || state.stylists.picked.length === 0) return true
    dispatch({ type: 'busy', busy: true })
    setError(null)
    try {
      const res = await fetch(`/api/facilities/${state.facility.id}/stylists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: state.stylists.picked.map((p) => ({ stylistId: p.id, days: p.days })),
          hours: { startTime: state.hours.startTime, endTime: state.hours.endTime },
        }),
      })
      const j = await readJson(res)
      if (!res.ok) {
        setError(typeof j.error === 'string' ? j.error : 'Could not assign the stylists')
        return false
      }
      const d = j.data as { assigned: number; availabilityCreated: number }
      patch({ stylists: { ...state.stylists, assignedCount: d.assigned } })
      toast.success(`${d.assigned} stylist${d.assigned === 1 ? '' : 's'} now work at ${state.facility.name}`)
      return true
    } catch {
      setError('Network error — the stylists were not assigned')
      return false
    } finally {
      dispatch({ type: 'busy', busy: false })
    }
  }

  // ── Billing → Finish ───────────────────────────────────────────────────
  const commitLaunch = async (): Promise<boolean> => {
    if (!state.facility) return false
    dispatch({ type: 'busy', busy: true })
    setError(null)
    try {
      const l = state.launch
      const pct = l.revSharePercentage.trim() === '' ? null : Number(l.revSharePercentage)
      const res = await fetch(`/api/facilities/${state.facility.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentType: l.paymentType,
          ...(caps.canSetRevShare ? { revSharePercentage: pct, qbRevShareType: l.qbRevShareType } : {}),
          ...(caps.canSetAutopay ? { autopayMode: l.autopayMode, autopaySweepCadence: l.autopaySweepCadence } : {}),
        }),
      })
      const j = await readJson(res)
      if (!res.ok) {
        setError(typeof j.error === 'string' ? j.error : 'Could not save the billing settings')
        return false
      }
      let franchiseOk = false
      if (caps.canLinkFranchise && l.franchiseId) {
        const fr = caps.franchises.find((f) => f.id === l.franchiseId)
        const ids = [...new Set([...(fr?.facilityIds ?? []), state.facility.id])]
        const fres = await fetch(`/api/super-admin/franchises/${l.franchiseId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ facilityIds: ids }),
        })
        franchiseOk = fres.ok
        if (!fres.ok) toast.error('Billing saved, but the franchise link failed — add it from the Franchises tab')
      }
      patch({ saved: { launch: true, franchise: franchiseOk } })
      return true
    } catch {
      setError('Network error — the billing settings were not saved')
      return false
    } finally {
      dispatch({ type: 'busy', busy: false })
    }
  }

  const canContinue = (() => {
    switch (state.step) {
      case 'basics':
        return locked || basicsValid(state.basics, caps, allowInactive)
      case 'hours':
        return locked || workingHoursValid(state.hours)
      case 'stylists':
      case 'services':
        return true
      case 'launch':
        return launchValid(state.launch)
      default:
        return false
    }
  })()

  const next = async () => {
    if (state.busy) return
    const cur = state.step
    if (cur === 'hours' && !locked) {
      if (!(await createFacility())) return
    } else if (cur === 'stylists') {
      if (!(await commitStylists())) return
    } else if (cur === 'launch') {
      if (!(await commitLaunch())) return
    }
    const n = steps[idx + 1]
    if (n) go(n)
  }
  const back = () => {
    if (state.busy) return
    const p = steps[idx - 1]
    if (p) go(p)
  }

  const primaryLabel = (() => {
    if (state.step === 'hours' && !locked) return 'Create facility'
    if (state.step === 'stylists') return state.stylists.picked.length > 0 ? 'Save & continue' : 'Skip for now'
    if (state.step === 'services') return state.services ? 'Continue' : 'Skip for now'
    if (state.step === 'launch') return 'Finish'
    return 'Continue'
  })()

  const onCancel = () => {
    if (dirtyFacility) setLeaveOpen(true)
    else window.location.assign(caps.returnTo)
  }

  return (
    <div className="page-enter max-w-3xl mx-auto px-4 pt-6 pb-8">
      <div className="flex items-start justify-between gap-3 mb-5">
        <PageHeader
          icon={Building2}
          title="New facility"
          subtitle={state.step === 'done' ? 'All set' : `Step ${idx + 1} of ${visibleSteps.length} · ${STEP_LABEL[state.step]}`}
        />
        {state.step !== 'done' && (
          <button type="button" onClick={onCancel} aria-label="Cancel" className="w-10 h-10 rounded-xl flex items-center justify-center text-stone-400 hover:text-stone-700 hover:bg-stone-100">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden mb-6" aria-hidden>
        <div className="h-full bg-[#8B2E4A] transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>

      <ol className="hidden md:flex items-center gap-2 mb-6 text-xs font-semibold" aria-label="Steps">
        {visibleSteps.map((s, i) => {
          const done = i < idx || state.step === 'done'
          const active = s === state.step
          return (
            <li key={s} className="flex items-center gap-2">
              <span
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-[11px]',
                  done ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-[#8B2E4A] text-white' : 'bg-stone-100 text-stone-500',
                )}
              >
                {done ? '✓' : i + 1}
              </span>
              <span className={active ? 'text-stone-900' : 'text-stone-400'}>{STEP_LABEL[s]}</span>
              {i < visibleSteps.length - 1 && <span className="w-6 h-px bg-stone-200" />}
            </li>
          )
        })}
      </ol>

      <div className="min-h-[40vh]">
        {state.step === 'basics' && (
          <StepBasics
            caps={caps}
            value={state.basics}
            onChange={(basics) => patch({ basics, conflict: null, error: null })}
            locked={locked}
            facilityCode={state.facility?.facilityCode ?? null}
            conflict={state.conflict}
            suggestedCodeFromServer={state.suggestedCodeFromServer}
            error={state.error}
            onUseInactiveAnyway={() => {
              setAllowInactive(true)
              patch({ conflict: null, error: null })
            }}
          />
        )}
        {state.step === 'hours' && <StepHours value={state.hours} onChange={(hours) => patch({ hours })} locked={locked} error={state.error} />}
        {state.step === 'stylists' && state.facility && (
          <StepStylists caps={caps} facility={state.facility} hours={state.hours} value={state.stylists} onChange={(stylists) => patch({ stylists })} error={state.error} onError={setError} />
        )}
        {state.step === 'services' && state.facility && (
          <StepServices facility={state.facility} value={state.services} onChange={(services) => patch({ services })} error={state.error} onError={setError} />
        )}
        {state.step === 'launch' && <StepLaunch caps={caps} value={state.launch} onChange={(launch) => patch({ launch })} error={state.error} />}
        {state.step === 'done' && state.facility && <StepDone caps={caps} facility={state.facility} state={state} />}
      </div>

      {state.step !== 'done' && (
        <div
          className="sticky bottom-0 -mx-4 px-4 mt-8 py-3 bg-white/95 backdrop-blur-sm border-t border-stone-100 flex items-center justify-between gap-3"
          style={{ paddingBottom: 'calc(0.75rem + var(--app-safe-bottom, 0px))' }}
        >
          <Button type="button" variant="ghost" size="lg" className="min-h-[48px]" onClick={back} disabled={idx === 0 || state.busy}>
            Back
          </Button>
          <div className="flex items-center gap-3">
            {state.basics.name.trim() && !locked && state.step === 'basics' && nameDuplicate(state.basics.name, caps)?.active && (
              <span className="text-xs text-red-600 hidden sm:inline">Name already in use</span>
            )}
            <Button type="button" size="lg" className="min-h-[48px] min-w-[160px] text-base" onClick={next} disabled={!canContinue} loading={state.busy} data-tour="wizard-footer-next">
              {primaryLabel}
            </Button>
          </div>
        </div>
      )}

      <Modal open={leaveOpen} onClose={() => setLeaveOpen(false)} title="Leave setup?">
        <div className="space-y-4">
          <p className="text-sm text-stone-700">
            <span className="font-semibold">
              {state.facility?.facilityCode ? `${state.facility.facilityCode} · ` : ''}
              {state.facility?.name}
            </span>{' '}
            already exists. You can finish stylists, services and billing later from Settings.
          </p>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={() => setLeaveOpen(false)}>
              Keep going
            </Button>
            <Button type="button" variant="secondary" onClick={() => window.location.assign(caps.returnTo)}>
              Leave
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
