'use client'

// P57 — the working-hours control extracted from Settings → General so the
// New-Facility wizard and Settings share one editor: day chips + start/end.
// Controlled; the parent owns the value.

import { DAY_CHIPS, type WorkingHours } from '@/lib/facility-options'
import { cn } from '@/lib/utils'

interface Props {
  value: WorkingHours
  onChange: (next: WorkingHours) => void
  /** Larger chips + inputs (the wizard's senior-friendly sizing). */
  size?: 'default' | 'lg'
  disabled?: boolean
}

export function WorkingHoursEditor({ value, onChange, size = 'default', disabled = false }: Props) {
  const toggleDay = (day: string) => {
    const has = value.days.includes(day)
    const next = has ? value.days.filter((d) => d !== day) : [...value.days, day]
    // Keep chip order stable (Mon→Sun) regardless of click order.
    onChange({ ...value, days: DAY_CHIPS.filter((d) => next.includes(d)) })
  }

  const chip = size === 'lg' ? 'min-h-[44px] px-4 text-base' : 'px-3 py-1.5 text-xs'
  const input =
    size === 'lg'
      ? 'min-h-[48px] px-4 text-lg rounded-2xl'
      : 'px-3 py-2 text-sm rounded-xl'

  const invalid = value.startTime && value.endTime && value.endTime <= value.startTime

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {DAY_CHIPS.map((day) => {
          const on = value.days.includes(day)
          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onClick={() => toggleDay(day)}
              aria-pressed={on}
              className={cn(
                'rounded-full font-semibold transition-colors border',
                chip,
                on
                  ? 'bg-[#8B2E4A] text-white border-[#8B2E4A]'
                  : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              {day}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-3">
        <label className="flex-1">
          <span className="block text-xs font-semibold text-stone-600 mb-1">Open from</span>
          <input
            type="time"
            value={value.startTime}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, startTime: e.target.value })}
            className={cn('w-full border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]', input)}
          />
        </label>
        <span className="text-stone-400 pt-5">to</span>
        <label className="flex-1">
          <span className="block text-xs font-semibold text-stone-600 mb-1">Until</span>
          <input
            type="time"
            value={value.endTime}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, endTime: e.target.value })}
            className={cn('w-full border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]', input)}
          />
        </label>
      </div>
      {value.days.length === 0 && <p className="text-xs text-amber-700">Pick at least one day.</p>}
      {invalid && <p className="text-xs text-amber-700">The closing time must be after the opening time.</p>}
    </div>
  )
}

/** Shared validity rule (wizard Continue gate + Settings save gate). */
export function workingHoursValid(v: WorkingHours): boolean {
  return v.days.length > 0 && !!v.startTime && !!v.endTime && v.endTime > v.startTime
}
