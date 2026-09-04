'use client'

// P60 — Step 5: the money rules. Billing type, rev-share (master), the
// autopay rule (never promises a charge unless payments are live), sweep
// cadence, franchise link (master).

import { AUTOPAY_MODES, PAYMENT_TYPES } from '@/lib/facility-options'
import { Card, ChoiceCard, Field, InlineError, StepIntro, WIZ_INPUT } from './wizard-ui'
import type { WizardCaps, WizardState } from './wizard-types'

interface Props {
  caps: WizardCaps
  value: WizardState['launch']
  onChange: (next: WizardState['launch']) => void
  error: string | null
}

const PAYMENTS_NOTE: Record<WizardCaps['paymentsStatus'], string> = {
  live: 'Payments are live — saved cards will be charged.',
  test: 'Payments are in TEST mode — only test cards are charged until the owner flips payments live.',
  blocked: 'Live Stripe keys are present but payments are switched off — nothing is charged until the owner enables them.',
  not_configured: 'Card payments aren’t connected yet — this only sets the rule. Nothing is charged until Stripe is configured.',
}

export function StepLaunch({ caps, value, onChange, error }: Props) {
  const set = (patch: Partial<WizardState['launch']>) => onChange({ ...value, ...patch })
  const pctNum = value.revSharePercentage.trim() === '' ? null : Number(value.revSharePercentage)
  const pctBad = pctNum !== null && (!Number.isInteger(pctNum) || pctNum < 0 || pctNum > 100)

  return (
    <>
      <StepIntro title="How does billing work here?" blurb="These can all be changed later in Settings → Billing & Payments." />
      <div className="space-y-5">
        <InlineError message={error} />

        <Card className="space-y-3">
          <p className="text-sm font-semibold text-stone-700">Who pays for visits?</p>
          <div role="radiogroup" className="grid grid-cols-1 md:grid-cols-2 gap-2" data-tour="wizard-launch-payment-type">
            {PAYMENT_TYPES.map((pt) => (
              <ChoiceCard
                key={pt.value}
                selected={value.paymentType === pt.value}
                label={pt.label}
                blurb={pt.blurb}
                onSelect={() => set({ paymentType: pt.value })}
              />
            ))}
          </div>
        </Card>

        {caps.canSetRevShare && (
          <Card className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="Revenue share to the facility (%)"
              htmlFor="rev-share"
              error={pctBad ? 'Whole number from 0 to 100' : null}
              hint="Leave blank when the facility takes no share."
            >
              <input
                id="rev-share"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                value={value.revSharePercentage}
                onChange={(e) => set({ revSharePercentage: e.target.value })}
                placeholder="0"
                className={WIZ_INPUT}
              />
            </Field>
            <Field label="How the share is settled" htmlFor="rev-share-type">
              <select
                id="rev-share-type"
                value={value.qbRevShareType}
                onChange={(e) => set({ qbRevShareType: e.target.value as 'we_deduct' | 'they_pay' })}
                className={WIZ_INPUT}
                disabled={pctNum === null || pctNum === 0}
              >
                <option value="we_deduct">We deduct it before paying the facility</option>
                <option value="they_pay">The facility deducts it before paying us</option>
              </select>
            </Field>
          </Card>
        )}

        {caps.canSetAutopay && (
          <Card className="space-y-3">
            <p className="text-sm font-semibold text-stone-700">When are saved cards charged?</p>
            <div role="radiogroup" className="grid grid-cols-1 gap-2" data-tour="wizard-launch-autopay">
              {AUTOPAY_MODES.map((m) => (
                <ChoiceCard
                  key={m.value}
                  selected={value.autopayMode === m.value}
                  label={m.label}
                  blurb={m.blurb}
                  onSelect={() => set({ autopayMode: m.value })}
                />
              ))}
            </div>
            <p className="text-xs text-stone-500">{PAYMENTS_NOTE[caps.paymentsStatus]}</p>
            <Field label="Catch-up sweep for anything left unpaid" htmlFor="sweep" hint="Runs overnight for residents who turned on automatic payment.">
              <select
                id="sweep"
                value={value.autopaySweepCadence}
                onChange={(e) => set({ autopaySweepCadence: e.target.value as WizardState['launch']['autopaySweepCadence'] })}
                className={WIZ_INPUT}
              >
                <option value="off">Off</option>
                <option value="nightly">Every night</option>
                <option value="biweekly">Every two weeks</option>
                <option value="monthly">Monthly</option>
              </select>
            </Field>
          </Card>
        )}

        {caps.canLinkFranchise && caps.franchises.length > 0 && (
          <Card>
            <Field label="Franchise" htmlFor="franchise" hint="Optional — the franchise owner sees this facility on their Franchise page.">
              <select id="franchise" value={value.franchiseId} onChange={(e) => set({ franchiseId: e.target.value })} className={WIZ_INPUT}>
                <option value="">Not part of a franchise</option>
                {caps.franchises.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
          </Card>
        )}
      </div>
    </>
  )
}

export function launchValid(v: WizardState['launch']): boolean {
  const s = v.revSharePercentage.trim()
  if (s === '') return true
  const n = Number(s)
  return Number.isInteger(n) && n >= 0 && n <= 100
}
