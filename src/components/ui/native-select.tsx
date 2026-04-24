'use client'

import { useIsMobile } from '@/hooks/use-is-mobile'

interface NativeSelectProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  className?: string
}

export function NativeSelect({ value, onChange, options, placeholder, className }: NativeSelectProps) {
  const isMobile = useIsMobile()
  const selectedLabel = options.find((o) => o.value === value)?.label ?? placeholder ?? 'Select…'

  if (isMobile) {
    return (
      <div className={`relative ${className ?? ''}`}>
        <div className="flex items-center justify-between w-full border border-stone-200 rounded-xl px-3 py-2 text-sm bg-white">
          <span className={value ? 'text-stone-900' : 'text-stone-400'}>{selectedLabel}</span>
          <svg className="w-4 h-4 text-stone-400 shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
          aria-label={placeholder}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full border border-stone-200 rounded-xl px-3 py-2 text-sm bg-white text-stone-900 focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20 transition-[border-color,box-shadow] duration-150 ease-out ${className ?? ''}`}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
