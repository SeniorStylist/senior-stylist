'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { startTour } from '@/lib/help/tours'

interface OnboardingModalProps {
  /** User role (already normalized — super_admin → admin) */
  role: string
}

const ROLE_TOUR_ID: Record<string, string> = {
  admin: 'admin-facility-setup',
  facility_staff: 'stylist-residents',
  bookkeeper: 'bookkeeper-scan-logs',
  stylist: 'stylist-calendar',
  viewer: 'stylist-calendar',
}

export function OnboardingModal({ role }: OnboardingModalProps) {
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const markSeen = async () => {
    setBusy(true)
    try {
      await fetch('/api/profile/onboarding-seen', { method: 'POST' })
    } catch {
      // Non-fatal — the modal still closes; flag will retry on next dismiss
    }
  }

  const handleStart = async () => {
    await markSeen()
    setOpen(false)
    void startTour(ROLE_TOUR_ID[role] ?? 'stylist-calendar')
  }

  const handleSkip = async () => {
    await markSeen()
    setOpen(false)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(3px)' }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-stone-100 max-w-md w-full overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-300">
        <div
          className="px-6 pt-6 pb-5 text-white"
          style={{ background: 'linear-gradient(135deg, #8B2E4A 0%, #6B2238 100%)' }}
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
              <Sparkles size={20} />
            </div>
            <h2
              className="text-[24px] font-normal leading-tight"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              Welcome to Senior Stylist 👋
            </h2>
          </div>
          <p className="text-white/85 text-sm leading-snug mt-2">
            Let&apos;s show you around so you feel confident using the app.
          </p>
        </div>

        <div className="p-5 flex flex-col gap-3">
          <button
            type="button"
            onClick={handleStart}
            disabled={busy}
            className="w-full min-h-[52px] px-5 py-3 rounded-xl bg-[#8B2E4A] text-white text-sm font-semibold hover:bg-[#72253C] active:scale-[0.97] transition-all shadow-[0_2px_6px_rgba(139,46,74,0.22)] disabled:opacity-60"
          >
            Start the Tour
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={busy}
            className="w-full min-h-[44px] px-5 py-2.5 rounded-xl text-stone-500 hover:text-stone-700 text-sm font-medium transition-colors disabled:opacity-60"
          >
            Skip for now
          </button>
          <p className="text-[11px] text-stone-400 text-center mt-1">
            You can always find tutorials in the Help section anytime.
          </p>
        </div>
      </div>
    </div>
  )
}
