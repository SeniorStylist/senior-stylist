'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { CHANGELOG, NEWEST_CHANGELOG_DATE } from '@/lib/changelog'

interface ChangelogWidgetProps {
  changelogLastReadAt: Date | null
}

export function ChangelogWidget({ changelogLastReadAt }: ChangelogWidgetProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    // Unread if the user has never read or read before the newest entry
    const unread =
      !changelogLastReadAt ||
      new Date(changelogLastReadAt) < new Date(NEWEST_CHANGELOG_DATE + 'T00:00:00')
    setHasUnread(unread)
  }, [changelogLastReadAt])

  const handleOpen = () => {
    setOpen(true)
    if (hasUnread) {
      setHasUnread(false)
      // Fire-and-forget — stamp the read timestamp server-side
      fetch('/api/profile/changelog-seen', { method: 'POST' }).catch(() => {})
    }
  }

  const handleClose = () => setOpen(false)

  if (!mounted || typeof document === 'undefined') return null

  const content = (
    <div className="flex flex-col divide-y divide-stone-100">
      {CHANGELOG.map((entry) => (
        <div key={entry.version} className="px-5 py-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-semibold font-mono bg-[#F9EFF2] text-[#8B2E4A] rounded-full px-2.5 py-0.5">
              v{entry.version}
            </span>
            <span className="text-[11px] text-stone-400">
              {new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
          <p className="text-sm font-semibold text-stone-900 mb-1.5">{entry.title}</p>
          <ul className="space-y-1">
            {entry.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-stone-600">
                <span className="mt-0.5 w-1 h-1 rounded-full bg-[#8B2E4A] shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )

  const triggerButton = (
    <button
      type="button"
      onClick={handleOpen}
      aria-label="What's new"
      title="What's new"
      data-tour="changelog-button"
      className="fixed z-30 w-10 h-10 rounded-full flex items-center justify-center text-white shadow-[var(--shadow-md)] opacity-45 hover:opacity-100 focus-visible:opacity-100 active:scale-95 transition-all duration-200"
      style={{
        right: '0.875rem',
        bottom: 'calc(var(--app-floating-bottom) + 116px)',
        backgroundColor: '#1C0A12',
      }}
    >
      {/* Bell icon */}
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </svg>
      {hasUnread && (
        <span
          className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-[#1C0A12]"
          aria-hidden
        />
      )}
    </button>
  )

  const panel = isMobile ? (
    <BottomSheet isOpen={open} onClose={handleClose} title="What's New">
      {content}
    </BottomSheet>
  ) : (
    open && (
      <>
        <div className="fixed inset-0 z-[85]" onClick={handleClose} aria-hidden />
        <div
          className="fixed z-[86] w-[380px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-xl)] overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-[160ms]"
          style={{ right: '1.25rem', bottom: 'calc(var(--app-floating-bottom) + 116px)' }}
          role="dialog"
          aria-label="What's new"
        >
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-100">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">What&apos;s New</h2>
              <p className="text-[11px] text-stone-400 mt-0.5">Latest updates and improvements</p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="text-stone-400 hover:text-stone-600 transition-colors p-1"
              aria-label="Close"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">{content}</div>
        </div>
      </>
    )
  )

  return createPortal(
    <>
      {triggerButton}
      {panel}
    </>,
    document.body,
  )
}
