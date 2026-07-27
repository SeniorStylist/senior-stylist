'use client'

// Searchable service picker — typing filters the list ("Shampoo" → only
// services containing Shampoo), replacing the plain <select>s in the daily-log
// edit form, OCR scan review, and walk-in form (bookkeeper request 2026-07-27).
//
// Mechanics mirror FacilityCombobox (scan-check-modal): container-blur close via
// relatedTarget, onMouseDown+preventDefault on tabIndex={0} option buttons so
// selection lands before blur. NEVER a <datalist> — it renders as an invisible
// free-text field on most browsers (see the ocr-import-modal service comment).
//
// Contract with the parent:
// - `searchValue` is the free-typed text (create-mode service name for OCR
//   entries). When `selectedId` is set the input DISPLAYS the selected service's
//   name instead — so programmatic selection (P26 usual-service default) stays
//   in sync with no extra bookkeeping.
// - `onSearchChange` fires on typing; the parent must clear its selection there.
// - `onCreate` (optional) renders an inline `➕ Create "<typed>"` row.

import { useCallback, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { sortCategoryGroups, sortServicesWithinCategory } from '@/lib/service-sort'

export interface ServiceComboboxOption {
  id: string
  name: string
  pricingType: string
  category?: string | null
  sortOrder?: number
}

interface ServiceComboboxProps<T extends ServiceComboboxOption> {
  services: T[]
  selectedId: string | null
  searchValue: string
  onSearchChange: (v: string) => void
  onSelect: (svc: T) => void
  /** Offer an inline `Create "<typed>"` row (replaces the old __create__ sentinel option). */
  onCreate?: (typedName: string) => void
  onClear?: () => void
  /** Group results under category headers (walk-in form). */
  groupByCategory?: boolean
  /** Category ordering from buildCategoryPriority(facility.serviceCategoryOrder). */
  categoryPriority?: Record<string, number>
  /** Per-option price/pricing suffix, e.g. formatPricingLabel or formatCents. */
  priceLabel?: (svc: T) => string | null
  placeholder?: string
  /** Red-border invalid state (OCR entries with no service resolved). */
  invalid?: boolean
  inputClassName?: string
  dataTour?: string
  /** data-tour on option rows — scripted-tour advanceSelector target. */
  optionDataTour?: string
}

export function ServiceCombobox<T extends ServiceComboboxOption>({
  services,
  selectedId,
  searchValue,
  onSearchChange,
  onSelect,
  onCreate,
  onClear,
  groupByCategory,
  categoryPriority,
  priceLabel,
  placeholder = 'Type to search services…',
  invalid,
  inputClassName,
  dataTour,
  optionDataTour,
}: ServiceComboboxProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const selected = selectedId ? services.find((s) => s.id === selectedId) : undefined
  const displayValue = selected ? selected.name : searchValue
  // With a selection active the text is the selected name, not a query — show
  // the full list so the user can browse to a different service.
  const query = selected ? '' : searchValue.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!query) return services
    return services.filter((s) => s.name.toLowerCase().includes(query))
  }, [services, query])

  const grouped = useMemo(() => {
    if (!groupByCategory) return null
    const map = new Map<string, T[]>()
    for (const s of filtered) {
      const key = s.category?.trim() || 'Other'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    const ordered = sortCategoryGroups([...map.entries()], categoryPriority ?? {})
    return ordered.map(([category, list]) => [category, sortServicesWithinCategory(list)] as const)
  }, [filtered, groupByCategory, categoryPriority])

  const showCreateRow =
    !!onCreate &&
    !selected &&
    searchValue.trim().length >= 2 &&
    !services.some((s) => s.name.trim().toLowerCase() === searchValue.trim().toLowerCase())

  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
      setOpen(false)
    }
  }, [])

  const pick = (svc: T) => {
    onSelect(svc)
    setOpen(false)
  }

  const optionRow = (s: T) => {
    const suffix = priceLabel?.(s)
    return (
      <li key={s.id}>
        <button
          type="button"
          tabIndex={0}
          {...(optionDataTour ? { 'data-tour': optionDataTour } : {})}
          onMouseDown={(e) => {
            e.preventDefault()
            pick(s)
          }}
          className={cn(
            'w-full text-left px-3 py-2 text-sm hover:bg-stone-50 cursor-pointer',
            s.id === selectedId ? 'bg-rose-50 text-[#8B2E4A] font-medium' : 'text-stone-800',
          )}
        >
          {s.name}
          {suffix && <span className="text-stone-400 ml-1.5 text-xs">· {suffix}</span>}
        </button>
      </li>
    )
  }

  return (
    <div ref={containerRef} onBlur={handleBlur} className="relative">
      <input
        type="text"
        value={displayValue}
        placeholder={placeholder}
        {...(dataTour ? { 'data-tour': dataTour } : {})}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onSearchChange(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          if (e.key === 'Enter') {
            // Never submit an enclosing form; pick the first match when filtering.
            e.preventDefault()
            if (open && query && filtered.length > 0) pick(filtered[0])
          }
        }}
        className={cn(
          'w-full bg-white border rounded-lg px-2 py-1.5 pr-7 text-sm text-stone-900 focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20',
          invalid ? 'border-red-300' : 'border-stone-200',
          inputClassName,
        )}
      />
      {(selected || searchValue) && onClear && (
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => {
            e.preventDefault()
            onClear()
            setOpen(false)
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 text-base leading-none"
          aria-label="Clear service"
        >
          ×
        </button>
      )}
      {open && (filtered.length > 0 || showCreateRow) && (
        <ul className="absolute z-50 mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
          {grouped
            ? grouped.map(([category, list]) => (
                <li key={category}>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-stone-400 uppercase tracking-wide">
                    {category}
                  </div>
                  <ul>{list.map(optionRow)}</ul>
                </li>
              ))
            : sortServicesWithinCategory(filtered).map(optionRow)}
          {showCreateRow && (
            <li>
              <button
                type="button"
                tabIndex={0}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onCreate!(searchValue.trim())
                  setOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-sm text-[#8B2E4A] font-medium hover:bg-rose-50 cursor-pointer border-t border-stone-100"
              >
                ➕ Create &ldquo;{searchValue.trim()}&rdquo;
              </button>
            </li>
          )}
        </ul>
      )}
      {open && filtered.length === 0 && !showCreateRow && query && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg px-3 py-2 text-sm text-stone-400">
          No services found
        </div>
      )}
    </div>
  )
}
