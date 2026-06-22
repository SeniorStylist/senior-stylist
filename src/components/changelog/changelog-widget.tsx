'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/modal'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { CHANGELOG, LATEST_CHANGELOG_DATE } from '@/lib/changelog'

interface Props {
  changelogLastReadAt: string | null // ISO string or null
}

export function ChangelogWidget({ changelogLastReadAt }: Props) {
  const [open, setOpen] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    const lastRead = changelogLastReadAt ? new Date(changelogLastReadAt) : null
    const newest = new Date(LATEST_CHANGELOG_DATE)
    setHasUnread(!lastRead || newest > lastRead)
  }, [changelogLastReadAt])

  const handleOpen = useCallback(async () => {
    setOpen(true)
    if (hasUnread) {
      setHasUnread(false)
      fetch('/api/profile/changelog-seen', { method: 'POST' }).catch(() => {})
    }
  }, [hasUnread])

  const content = (
    <div className="space-y-5">
      {CHANGELOG.map((entry) => (
        <div key={entry.version} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-semibold text-stone-500">v{entry.version}</span>
            <span className="text-xs text-stone-400">{new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
          <p className="text-sm font-semibold text-stone-800">{entry.title}</p>
          <ul className="space-y-0.5">
            {entry.items.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-stone-600">
                <span className="mt-[3px] w-1 h-1 rounded-full bg-[#8B2E4A]/60 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )

  const trigger = (
    <button
      type="button"
      onClick={handleOpen}
      className="relative flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/10 transition-colors"
      aria-label="What's new"
      title="What's new"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {hasUnread && (
        <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#8B2E4A] border-2 border-white" />
      )}
    </button>
  )

  if (isMobile) {
    return (
      <>
        {trigger}
        <BottomSheet isOpen={open} onClose={() => setOpen(false)} title="What's New">
          <div className="px-4 pb-6">{content}</div>
        </BottomSheet>
      </>
    )
  }

  return (
    <>
      {trigger}
      <Modal open={open} onClose={() => setOpen(false)} title="What's New">
        <div className="p-6 pt-0 max-h-[500px] overflow-y-auto">{content}</div>
      </Modal>
    </>
  )
}
