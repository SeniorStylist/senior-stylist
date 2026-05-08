'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CircleHelp } from 'lucide-react'
import { BottomSheet } from '@/components/ui/bottom-sheet'

interface HelpTipProps {
  /** Tour ID this tip points to (passed via /help?tour=ID query param) */
  tourId: string
  /** Short label/title shown in the popover header */
  label: string
  /** 1–2 sentence description */
  description: string
  /** Optional aria-label override (defaults to "Help: {label}") */
  ariaLabel?: string
}

const useIsMobile = () => {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return mobile
}

export function HelpTip({ tourId, label, description, ariaLabel }: HelpTipProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const isMobile = useIsMobile()
  const helpHref = `/help?tour=${encodeURIComponent(tourId)}`

  useEffect(() => {
    if (!open || isMobile) return
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', escHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', escHandler)
    }
  }, [open, isMobile])

  return (
    <span ref={wrapperRef} className="relative inline-flex items-center align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel ?? `Help: ${label}`}
        className="inline-flex items-center justify-center text-stone-400 hover:text-[#8B2E4A] transition-colors"
      >
        <CircleHelp size={16} strokeWidth={2} />
      </button>

      {open && !isMobile && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 w-72 rounded-2xl border border-stone-200 bg-white p-4 shadow-[var(--shadow-lg)] animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <p className="text-sm font-semibold text-stone-900 mb-1">{label}</p>
          <p className="text-[13px] text-stone-600 leading-snug">{description}</p>
          <Link
            href={helpHref}
            onClick={() => setOpen(false)}
            className="inline-block mt-3 text-[13px] font-medium text-[#8B2E4A] hover:text-[#72253C]"
          >
            See full tutorial →
          </Link>
        </div>
      )}

      {isMobile && (
        <BottomSheet isOpen={open} onClose={() => setOpen(false)} title={label}>
          <div className="px-5 py-4">
            <p className="text-sm text-stone-600 leading-relaxed">{description}</p>
            <Link
              href={helpHref}
              onClick={() => setOpen(false)}
              className="inline-block mt-4 text-sm font-semibold text-[#8B2E4A]"
            >
              See full tutorial →
            </Link>
          </div>
        </BottomSheet>
      )}
    </span>
  )
}
