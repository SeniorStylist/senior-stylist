'use client'

// P57 — Step 2: salon days + hours. These bound the booking modal's time
// slots AND seed each assigned stylist's availability in the next step, so
// the community has working days the moment it exists.

import { WorkingHoursEditor } from '@/components/facilities/working-hours-editor'
import type { WorkingHours } from '@/lib/facility-options'
import { Card, InlineError, StepIntro } from './wizard-ui'

interface Props {
  value: WorkingHours
  onChange: (next: WorkingHours) => void
  locked: boolean
  error: string | null
}

export function StepHours({ value, onChange, locked, error }: Props) {
  return (
    <>
      <StepIntro
        title={locked ? 'Salon days & hours' : 'When is the salon open?'}
        blurb={
          locked
            ? 'Saved. Change these later in Settings → General.'
            : 'Appointments can only be placed inside these hours. Stylists you add next start with these days.'
        }
      />
      <div className="space-y-5">
        <InlineError message={error} />
        <Card>
          <div data-tour="wizard-hours">
            <WorkingHoursEditor value={value} onChange={onChange} size="lg" disabled={locked} />
          </div>
        </Card>
      </div>
    </>
  )
}
