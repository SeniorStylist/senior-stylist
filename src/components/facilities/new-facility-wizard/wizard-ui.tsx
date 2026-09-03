'use client'

// P60 — tiny shared primitives for the New-Facility wizard steps (senior-
// friendly sizing: 18px inputs so iOS never zooms, ≥48px targets).

import { cn } from '@/lib/utils'

export const WIZ_INPUT =
  'w-full min-h-[48px] px-4 text-lg rounded-2xl border border-stone-200 bg-white text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50 disabled:bg-stone-50 disabled:text-stone-500'

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  hint?: React.ReactNode
  error?: string | null
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-base font-medium text-stone-600">
        {label}
      </label>
      {children}
      {error ? <p className="text-sm text-red-600">{error}</p> : hint ? <p className="text-sm text-stone-500">{hint}</p> : null}
    </div>
  )
}

export function StepIntro({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-normal text-stone-900" style={{ fontFamily: "'DM Serif Display', serif" }}>
        {title}
      </h2>
      <p className="text-base text-stone-500 mt-1">{blurb}</p>
    </div>
  )
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-stone-100 bg-white p-5 shadow-[var(--shadow-sm)]', className)}>
      {children}
    </div>
  )
}

/** A big tappable radio card (billing type / autopay rule). */
export function ChoiceCard({
  selected,
  label,
  blurb,
  onSelect,
  disabled,
  dataTour,
}: {
  selected: boolean
  label: string
  blurb: string
  onSelect: () => void
  disabled?: boolean
  dataTour?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      data-tour={dataTour}
      className={cn(
        'w-full text-left rounded-2xl border px-4 py-3.5 transition-colors',
        selected ? 'border-[#8B2E4A] bg-[#F9EFF2]' : 'border-stone-200 bg-white hover:bg-stone-50',
        disabled && 'opacity-60 cursor-not-allowed',
      )}
    >
      <span className="flex items-start gap-3">
        <span
          className={cn(
            'mt-1 w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center',
            selected ? 'border-[#8B2E4A]' : 'border-stone-300',
          )}
        >
          {selected && <span className="w-2.5 h-2.5 rounded-full bg-[#8B2E4A]" />}
        </span>
        <span className="min-w-0">
          <span className="block text-base font-semibold text-stone-900">{label}</span>
          <span className="block text-sm text-stone-500 mt-0.5">{blurb}</span>
        </span>
      </span>
    </button>
  )
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  )
}
