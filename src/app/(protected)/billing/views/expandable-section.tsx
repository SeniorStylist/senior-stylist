'use client'

import { ReactNode, useState } from 'react'
import { expandTransition, transitionBase } from '@/lib/animations'

export function ExpandableSection({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string
  meta: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between px-5 py-4 ${transitionBase} hover:bg-stone-50`}
      >
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold text-stone-700">{title}</span>
          <span className="text-xs text-stone-500">{meta}</span>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`${transitionBase} ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div
        className={expandTransition}
        style={{ maxHeight: open ? '5000px' : '0px', opacity: open ? 1 : 0 }}
      >
        <div className="border-t border-stone-100">{children}</div>
      </div>
    </div>
  )
}
