'use client'

// P60 — Step 1: the facility itself. Name + (master/bookkeeper) F-code +
// address/phone/contact + timezone. Duplicate-name feedback is zero-network
// (the page ships the name directory) and the server re-checks in its tx.

import { TIMEZONES } from '@/lib/facility-options'
import { FacilityCodeField, facilityCodeProblem } from './facility-code-field'
import { Card, Field, InlineError, StepIntro, WIZ_INPUT } from './wizard-ui'
import type { WizardCaps, WizardState } from './wizard-types'

interface Props {
  caps: WizardCaps
  value: WizardState['basics']
  onChange: (next: WizardState['basics']) => void
  locked: boolean
  facilityCode: string | null
  conflict: WizardState['conflict']
  suggestedCodeFromServer: string | null
  error: string | null
  onUseInactiveAnyway: () => void
}

export function nameDuplicate(name: string, caps: WizardCaps) {
  const n = name.trim().toLowerCase()
  if (!n) return null
  return caps.nameDirectory.find((f) => f.name.trim().toLowerCase() === n) ?? null
}

export function basicsValid(v: WizardState['basics'], caps: WizardCaps, allowInactive: boolean): boolean {
  if (!v.name.trim()) return false
  if (v.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.contactEmail.trim())) return false
  if (caps.canEditCode) {
    if (!v.facilityCode.trim()) return false
    if (facilityCodeProblem(v.facilityCode, caps.codeDirectory)) return false
  }
  const dup = nameDuplicate(v.name, caps)
  if (dup && (dup.active || !allowInactive)) return false
  return true
}

export function StepBasics({
  caps,
  value,
  onChange,
  locked,
  facilityCode,
  conflict,
  suggestedCodeFromServer,
  error,
  onUseInactiveAnyway,
}: Props) {
  const set = (patch: Partial<WizardState['basics']>) => onChange({ ...value, ...patch })
  const dup = nameDuplicate(value.name, caps)
  const emailBad = value.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.contactEmail.trim())

  if (locked) {
    return (
      <>
        <StepIntro title="Facility" blurb="Created. Edit these later in Settings → General." />
        <Card className="space-y-2">
          <p className="text-lg font-semibold text-stone-900">
            {facilityCode && <span className="font-mono text-stone-500 mr-2">{facilityCode}</span>}
            {value.name}
          </p>
          {value.address && <p className="text-sm text-stone-600">{value.address}</p>}
          <p className="text-sm text-stone-500">
            {[value.phone, value.contactEmail, TIMEZONES.find((t) => t.value === value.timezone)?.label]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </Card>
      </>
    )
  }

  return (
    <>
      <StepIntro title="Tell us about the community" blurb="Just the basics — everything else can be set up afterwards." />
      <div className="space-y-5">
        <InlineError message={error} />
        {caps.isMaster && (
          <p className="text-sm text-stone-500">
            Adding many communities at once?{' '}
            <a href="/master-admin/import-facilities-csv" className="font-semibold text-[#8B2E4A] hover:underline">
              Import your facility sheet →
            </a>
          </p>
        )}

        {conflict && (
          <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 space-y-2">
            {conflict.active ? (
              <p>
                <span className="font-semibold">{conflict.name}</span>
                {conflict.facilityCode ? ` (${conflict.facilityCode})` : ''} already exists and is active. Use the switcher to open it, or
                change the name if this is a different community.
              </p>
            ) : (
              <>
                <p>
                  A deactivated facility named <span className="font-semibold">{conflict.name}</span>
                  {conflict.facilityCode ? ` (${conflict.facilityCode})` : ''} exists. Its old records stay with it — a new facility starts clean.
                </p>
                {caps.canEditCode && (
                  <button type="button" onClick={onUseInactiveAnyway} className="text-sm font-semibold text-[#8B2E4A] hover:underline">
                    Create a new facility with this name anyway →
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <Card className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field
            label="Facility name"
            htmlFor="facility-name"
            className="md:col-span-2"
            error={dup ? (dup.active ? `${dup.name} already exists (${dup.facilityCode ?? 'no code'})` : null) : null}
            hint={
              dup && !dup.active
                ? `A deactivated facility has this name (${dup.facilityCode ?? 'no code'}). Continue creates a new one.`
                : 'The community’s full name, as families know it.'
            }
          >
            <input
              id="facility-name"
              type="text"
              value={value.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="The Fitzgerald of Palisades"
              autoComplete="organization"
              data-tour="wizard-basics-name"
              className={WIZ_INPUT}
            />
          </Field>

          {caps.canEditCode ? (
            <FacilityCodeField
              value={value.facilityCode}
              suggested={caps.suggestedCode}
              directory={caps.codeDirectory}
              onChange={(next) => set({ facilityCode: next })}
              serverSuggestion={suggestedCodeFromServer}
              inputClassName={WIZ_INPUT}
            />
          ) : (
            <Field label="Facility code" hint="Assigned automatically when you continue — it goes on the family sign-up poster.">
              <div className={`${WIZ_INPUT} flex items-center text-stone-500`}>Assigned automatically</div>
            </Field>
          )}

          <Field label="Time zone" htmlFor="facility-tz">
            <select id="facility-tz" value={value.timezone} onChange={(e) => set({ timezone: e.target.value })} className={WIZ_INPUT}>
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Address" htmlFor="facility-address" className="md:col-span-2">
            <input
              id="facility-address"
              type="text"
              value={value.address}
              onChange={(e) => set({ address: e.target.value })}
              placeholder="123 Main St, City, ST"
              autoComplete="street-address"
              className={WIZ_INPUT}
            />
          </Field>

          <Field label="Front desk phone" htmlFor="facility-phone">
            <input
              id="facility-phone"
              type="tel"
              value={value.phone}
              onChange={(e) => set({ phone: e.target.value })}
              placeholder="(555) 000-0000"
              autoComplete="tel"
              className={WIZ_INPUT}
            />
          </Field>

          <Field
            label="Contact email"
            htmlFor="facility-email"
            error={emailBad ? 'That doesn’t look like an email address' : null}
            hint="Where statements and the day log are sent."
          >
            <input
              id="facility-email"
              type="email"
              value={value.contactEmail}
              onChange={(e) => set({ contactEmail: e.target.value })}
              placeholder="office@community.com"
              autoComplete="email"
              className={WIZ_INPUT}
            />
          </Field>
        </Card>
      </div>
    </>
  )
}
