'use client'

// P60 — suggested-but-editable facility code with ZERO-network clash
// feedback (the page ships the code directory; the server re-checks inside
// its transaction and returns `suggestedCode` on a race).

import { FACILITY_CODE_RE } from '@/lib/facility-code'
import { cn } from '@/lib/utils'

interface Props {
  value: string
  suggested: string
  directory: { code: string; name: string; active: boolean }[]
  onChange: (next: string) => void
  /** a 409 from the server carrying a fresh suggestion */
  serverSuggestion?: string | null
  inputClassName: string
}

export function facilityCodeProblem(
  value: string,
  directory: { code: string; name: string; active: boolean }[],
): { kind: 'format' | 'taken' | 'retired'; message: string } | null {
  const v = value.trim().toUpperCase()
  if (!v) return null
  if (!FACILITY_CODE_RE.test(v)) return { kind: 'format', message: 'Must look like F240' }
  const hit = directory.find((d) => d.code.toUpperCase() === v)
  if (hit && hit.active) return { kind: 'taken', message: `Taken by ${hit.name}` }
  if (hit && !hit.active) {
    return { kind: 'retired', message: `${v} belonged to ${hit.name} (deactivated) — codes are never reused` }
  }
  return null
}

export function FacilityCodeField({ value, suggested, directory, onChange, serverSuggestion, inputClassName }: Props) {
  const problem = facilityCodeProblem(value, directory)
  const isSuggested = value.trim().toUpperCase() === suggested

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-base font-medium text-stone-600" htmlFor="facility-code">
          Facility code
        </label>
        <span
          className={cn(
            'text-[10.5px] font-semibold px-2.5 py-1 rounded-full',
            isSuggested ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-600',
          )}
        >
          {isSuggested ? 'Suggested' : 'Custom'}
        </span>
      </div>
      <input
        id="facility-code"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder={suggested || 'F240'}
        maxLength={6}
        data-tour="wizard-basics-code"
        className={cn(inputClassName, 'font-mono uppercase', problem && 'border-amber-400')}
      />
      {problem ? (
        <p className={cn('text-sm', problem.kind === 'taken' ? 'text-red-600' : 'text-amber-700')}>{problem.message}</p>
      ) : (
        <p className="text-sm text-stone-500">
          Printed on the family sign-up poster and typed by families who can&apos;t scan. Next free code is{' '}
          <span className="font-mono">{suggested}</span>.
        </p>
      )}
      {serverSuggestion && serverSuggestion !== value && (
        <button
          type="button"
          onClick={() => onChange(serverSuggestion)}
          className="self-start text-sm font-semibold text-[#8B2E4A] hover:underline"
        >
          Use {serverSuggestion} instead
        </button>
      )}
      {!isSuggested && suggested && !serverSuggestion && (
        <button
          type="button"
          onClick={() => onChange(suggested)}
          className="self-start text-sm font-semibold text-[#8B2E4A] hover:underline"
        >
          Use suggested {suggested}
        </button>
      )}
    </div>
  )
}
