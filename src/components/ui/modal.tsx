'use client'

import { useEffect, useRef, ReactNode } from 'react'
import { useDialogFocus } from '@/hooks/use-dialog-focus'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
  /** data-* attribute pass-through for tour anchors etc. */
  [dataAttr: `data-${string}`]: string | boolean | undefined
}

export function Modal({ open, onClose, title, children, className, ...rest }: ModalProps) {
  const dataProps = Object.fromEntries(
    Object.entries(rest).filter(([k]) => k.startsWith('data-')),
  )
  const cardRef = useRef<HTMLDivElement>(null)
  useDialogFocus(cardRef, open)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    // Phase 17 — below md the shared Modal presents as a bottom sheet (slide-up,
    // rounded top, safe-area padding); md+ keeps the centered top-anchored card.
    // One change upgrades every Modal-only dialog on phones.
    <div
      className="fixed inset-0 z-50 flex items-end md:items-start justify-center p-0 md:p-4 md:pt-16"
      style={{ backgroundColor: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'bg-white shadow-2xl border border-stone-100 w-full md:max-w-md outline-none',
          'rounded-t-3xl rounded-b-none md:rounded-2xl mb-0 md:mb-8',
          'max-h-[88dvh] md:max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain',
          'pb-[env(safe-area-inset-bottom)] md:pb-0',
          'animate-in fade-in slide-in-from-bottom-3 duration-[160ms]',
          className
        )}
        {...dataProps}
      >
        {title && (
          <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-stone-100">
            <h2 className="text-base font-semibold text-stone-900">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-stone-400 hover:text-stone-600 transition-colors p-2 -m-2"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
