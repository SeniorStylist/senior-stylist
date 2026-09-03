'use client'

// P60 — Done: a readiness checklist (truth for stylists via GET
// /api/facilities/[id]/stylists), the family QR poster, and the two exits —
// Enter facility (HARD switch) or back where you came from (HARD nav so the
// layout re-reads the busted `facilities` tag).

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Printer, LogIn, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { switchFacility } from '@/lib/facility-switch'
import { openSignupPoster } from '@/lib/signup-poster'
import { Card } from './wizard-ui'
import type { CreatedFacility, WizardCaps, WizardState } from './wizard-types'

interface Props {
  caps: WizardCaps
  facility: CreatedFacility
  state: WizardState
}

function Row({ ok, label, detail, warn }: { ok: boolean; label: string; detail?: string; warn?: boolean }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {ok ? (
        <CheckCircle2 size={22} className="text-emerald-600 shrink-0" />
      ) : (
        <AlertTriangle size={22} className={warn ? 'text-amber-500 shrink-0' : 'text-stone-300 shrink-0'} />
      )}
      <div className="min-w-0">
        <p className="text-base font-semibold text-stone-900">{label}</p>
        {detail && <p className="text-sm text-stone-500 mt-0.5">{detail}</p>}
      </div>
    </li>
  )
}

export function StepDone({ caps, facility, state }: Props) {
  const { toast } = useToast()
  const [stylistCount, setStylistCount] = useState<number | null>(state.stylists.assignedCount)
  const [printing, setPrinting] = useState(false)
  const [entering, setEntering] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/facilities/${facility.id}/stylists`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.data?.stylists) setStylistCount(j.data.stylists.length)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [facility.id])

  const printPoster = async () => {
    if (!facility.facilityCode) return
    setPrinting(true)
    try {
      await openSignupPoster({ facilityName: facility.name, facilityCode: facility.facilityCode })
    } catch {
      toast.error('Could not open the poster — allow pop-ups for this site and try again')
    } finally {
      setPrinting(false)
    }
  }

  const enter = async () => {
    setEntering(true)
    await switchFacility(facility.id, '/dashboard')
  }

  const backLabel = caps.returnTo.startsWith('/master-admin')
    ? 'Back to Master Admin'
    : caps.returnTo.startsWith('/settings')
      ? 'Back to Settings'
      : 'Back'

  const services = state.services?.created ?? 0
  const servicesDone = state.services === null && !caps.canImportServices

  return (
    <div className="space-y-5">
      <div className="text-center py-4">
        <div className="mx-auto w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
          <CheckCircle2 size={34} />
        </div>
        <h2 className="text-2xl font-normal text-stone-900" style={{ fontFamily: "'DM Serif Display', serif" }}>
          {facility.name} is ready
        </h2>
        {facility.facilityCode && (
          <p className="text-base text-stone-500 mt-1">
            Facility code <span className="font-mono font-semibold text-stone-800">{facility.facilityCode}</span>
          </p>
        )}
      </div>

      <Card className="p-0">
        <ul className="divide-y divide-stone-100 px-5" data-tour="wizard-done-checklist">
          <Row ok={!!facility.facilityCode} label="Facility code" detail={facility.facilityCode ? 'Families type or scan this to sign up.' : 'No code — set one in Settings → General.'} />
          <Row ok={!!facility.facilityCode} label="Family sign-up poster" detail={facility.facilityCode ? 'Print it and hang it at the salon door.' : 'Needs a facility code.'} />
          <Row ok label="Salon days & hours" detail={`${state.hours.days.join(' ')} · ${state.hours.startTime}–${state.hours.endTime}`} />
          {caps.canManageStylists ? (
            <Row
              ok={(stylistCount ?? 0) > 0}
              warn
              label={stylistCount === null ? 'Stylists' : `${stylistCount} stylist${stylistCount === 1 ? '' : 's'} working here`}
              detail={
                (stylistCount ?? 0) > 0
                  ? 'Requests from families are routed to them.'
                  : 'Families can’t request visits and there are no working days yet — add a stylist from the Stylists page.'
              }
            />
          ) : (
            <Row ok label="Stylists" detail="Set up by your Senior Stylist bookkeeper." />
          )}
          {caps.canImportServices ? (
            <Row
              ok={services > 0}
              warn
              label={services > 0 ? `${services} service${services === 1 ? '' : 's'} on the price list` : 'Price list'}
              detail={services > 0 ? 'Families pick from these when they request a visit.' : 'No services yet — add them from the Services page.'}
            />
          ) : (
            <Row ok={servicesDone} label="Price list" detail="Set up by your Senior Stylist bookkeeper." />
          )}
          <Row
            ok={state.saved.launch}
            label="Billing & automatic payment"
            detail={state.saved.launch ? 'Saved. Adjust any time in Settings → Billing & Payments.' : 'Not saved — set these in Settings → Billing & Payments.'}
          />
          {caps.canLinkFranchise && state.launch.franchiseId && (
            <Row ok={state.saved.franchise} label="Franchise" detail={state.saved.franchise ? 'Linked.' : 'Link failed — do it from the Franchises tab.'} />
          )}
        </ul>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Button type="button" size="lg" variant="secondary" className="min-h-[52px] text-base" onClick={printPoster} loading={printing} disabled={!facility.facilityCode} data-tour="wizard-done-poster">
          <Printer size={18} /> Print QR poster
        </Button>
        <Button type="button" size="lg" className="min-h-[52px] text-base" onClick={enter} loading={entering} data-tour="wizard-done-enter">
          <LogIn size={18} /> Enter {facility.facilityCode ?? 'facility'}
        </Button>
      </div>
      <div className="text-center">
        <a href={caps.returnTo} className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-500 hover:text-[#8B2E4A]">
          <ArrowLeft size={14} /> {backLabel}
        </a>
      </div>
    </div>
  )
}
