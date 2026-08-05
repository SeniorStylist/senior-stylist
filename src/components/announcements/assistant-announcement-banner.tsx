'use client'

// One-time top banner announcing the AI assistant to EVERY signed-in user
// (Josh, 2026-08-05): tells people they can ask it where things are or have it
// do things for them, with a one-tap guided tour.
//
// Gating: ZERO new schema — reuses profiles.changelog_last_read_at exactly like
// the megaphone widget. Shown while changelogLastReadAt < ANNOUNCEMENT_DATE;
// every dismiss path POSTs the existing /api/profile/changelog-seen (which also
// clears the megaphone dot — acceptable: the banner IS the announcement). DB
// flag over localStorage so staff who use both a phone and a desk browser see
// it once, not once per device.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isMobile } from '@/lib/help/tour-dom'

/** Bump ONLY when shipping a new banner-worthy announcement (must be > the
 *  previous changelog dates — see the 5.8/5.9 same-date gotcha in changelog.ts). */
const ANNOUNCEMENT_DATE = '2026-08-05'

export function AssistantAnnouncementBanner({
  changelogLastReadAt,
}: {
  changelogLastReadAt: string | null
}) {
  const router = useRouter()
  const [dismissed, setDismissed] = useState(false)
  // Hide while a guided tour runs — this slot collides with TourModeBanner
  const [tourActive, setTourActive] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ active: boolean }>).detail
      if (detail) setTourActive(detail.active)
    }
    window.addEventListener('tour-mode-change', handler)
    return () => window.removeEventListener('tour-mode-change', handler)
  }, [])

  const unseen = !changelogLastReadAt || changelogLastReadAt.slice(0, 10) < ANNOUNCEMENT_DATE
  const visible = unseen && !dismissed && !tourActive

  const markSeen = () => {
    setDismissed(true)
    void fetch('/api/profile/changelog-seen', { method: 'POST' }).catch(() => {})
  }

  const takeTour = async () => {
    markSeen()
    const { launchTutorial } = await import('@/lib/help/scripted-tour-map')
    void launchTutorial('meet-assistant', isMobile(), () => router.refresh())
  }

  const askNow = () => {
    markSeen()
    window.dispatchEvent(new CustomEvent('open-assistant'))
  }

  if (!unseen) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[49] bg-[#8B2E4A] shadow-[var(--shadow-md)] pb-2 px-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 transition-transform duration-200 ease-out"
      style={{
        // Edge-to-edge under the notch; text sits below the safe area. top:0 +
        // translateY(-100%) so hiding never leaves a peeking strip.
        paddingTop: 'calc(0.5rem + env(safe-area-inset-top))',
        transform: visible ? 'translateY(0)' : 'translateY(-100%)',
        pointerEvents: visible ? 'auto' : 'none',
      }}
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
    >
      <span className="text-white text-xs font-medium">
        ✨ New: your AI assistant — ask it where anything is, or tell it what to do
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void takeTour()}
          className="text-xs font-semibold bg-white text-[#8B2E4A] rounded-full px-3 py-1 hover:bg-rose-50 transition-colors"
        >
          Take the 1-min tour
        </button>
        <button
          type="button"
          onClick={askNow}
          className="text-xs font-semibold text-white/90 underline underline-offset-2 hover:text-white"
        >
          Ask it now
        </button>
        <button
          type="button"
          onClick={markSeen}
          aria-label="Dismiss announcement"
          className="text-white/70 hover:text-white text-base leading-none px-1"
        >
          ×
        </button>
      </span>
    </div>
  )
}
