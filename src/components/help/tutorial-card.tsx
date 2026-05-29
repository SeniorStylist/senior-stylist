'use client'

import { useState } from 'react'
import {
  KeyRound, Calendar, FileText, Users, UserPlus, CheckCircle2, UserCog,
  Building2, Mail, BarChart3, HeartHandshake, ShieldCheck, CreditCard,
  ScanLine, GitMerge, Database, FileSpreadsheet, Wallet, PlusSquare,
  Network, BookOpen, CircleHelp, ClipboardList, PenLine, Play, Compass,
  Clock, Search, PanelRight,
} from 'lucide-react'
import type { Tutorial, TutorialIcon } from '@/lib/help/tours'
import { startTour } from '@/lib/help/tours'
import { useIsMobile } from '@/hooks/use-is-mobile'

// Tours that have an interactive scripted version (Phase 13). Clicking
// "Guided Tour" launches the scripted engine (real demo writes) instead of the
// legacy Driver.js walkthrough, picking the platform variant by viewport.
const SCRIPTED_TOUR_MAP: Record<string, { mobile: string; desktop: string }> = {
  'stylist-getting-started': { mobile: 'scripted-stylist-getting-started-mobile', desktop: 'scripted-stylist-getting-started-desktop' },
  'stylist-calendar': { mobile: 'scripted-stylist-calendar-mobile', desktop: 'scripted-stylist-calendar-desktop' },
  'stylist-daily-log': { mobile: 'scripted-stylist-daily-log-mobile', desktop: 'scripted-stylist-daily-log-desktop' },
  'stylist-checkin': { mobile: 'scripted-stylist-checkin-mobile', desktop: 'scripted-stylist-checkin-desktop' },
  'stylist-finalize-day': { mobile: 'scripted-stylist-finalize-day-mobile', desktop: 'scripted-stylist-finalize-day-desktop' },
  // Master admin tours (desktop-only — no mobile variant; same id for both)
  'master-add-facility': { mobile: 'scripted-master-add-facility', desktop: 'scripted-master-add-facility' },
  'master-stylist-directory': { mobile: 'scripted-master-add-stylist', desktop: 'scripted-master-add-stylist' },
}

// Tours that create their own demo records through the UI flow — no pre-seeding needed.
const UNSEEDED_SCRIPTED_TOURS = new Set([
  'scripted-master-add-facility',
  'scripted-master-add-stylist',
])

const ICON_MAP: Record<TutorialIcon, typeof KeyRound> = {
  KeyRound, Calendar, FileText, Users, UserPlus, CheckCircle2, UserCog,
  Building2, Mail, BarChart3, HeartHandshake, ShieldCheck, CreditCard,
  ScanLine, GitMerge, Database, FileSpreadsheet, Wallet, PlusSquare,
  Network, BookOpen, CircleHelp, ClipboardList, PenLine, Clock, Search, PanelRight,
}

interface TutorialCardProps {
  tutorial: Tutorial
  completed?: boolean
}

export function TutorialCard({ tutorial, completed }: TutorialCardProps) {
  const Icon = ICON_MAP[tutorial.icon] ?? CircleHelp
  const [comingSoonOpen, setComingSoonOpen] = useState<'video' | 'tour' | null>(null)
  const isMobile = useIsMobile()

  const handleTour = () => {
    if (!tutorial.tourId) {
      setComingSoonOpen('tour')
      setTimeout(() => setComingSoonOpen(null), 2000)
      return
    }
    const scripted = SCRIPTED_TOUR_MAP[tutorial.tourId]
    if (scripted) {
      const id = isMobile ? scripted.mobile : scripted.desktop
      void import('@/lib/help/scripted-tour').then((m) => {
        if (UNSEEDED_SCRIPTED_TOURS.has(id)) {
          // Tour creates its own demo records through the UI — no pre-seeding needed
          return m.startScriptedTour(id)
        }
        return m.seedAndStart(id)
      })
    } else {
      void startTour(tutorial.tourId)
    }
  }

  const handleVideo = () => {
    setComingSoonOpen('video')
    setTimeout(() => setComingSoonOpen(null), 2000)
  }

  return (
    <div className="rounded-2xl border border-stone-100 bg-white shadow-[var(--shadow-sm)] p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 shrink-0 rounded-xl bg-rose-50 flex items-center justify-center text-[#8B2E4A]">
          <Icon size={26} strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <h3
            className="text-[18px] font-normal text-stone-900 leading-tight"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            {tutorial.title}
          </h3>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="inline-block text-[11px] font-semibold text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">
              ~{tutorial.estMinutes} min
            </span>
            {completed && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 size={12} />
                Done
              </span>
            )}
          </div>
        </div>
      </div>

      <p className="text-sm text-stone-500 leading-snug">{tutorial.blurb}</p>
      {tutorial.scenarioSummary && (
        <p className="text-[12px] text-stone-400 italic leading-snug">
          &ldquo;{tutorial.scenarioSummary}&rdquo;
        </p>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mt-auto pt-1">
        <button
          type="button"
          onClick={handleVideo}
          className="flex items-center justify-center gap-2 flex-1 min-h-[48px] px-4 py-2.5 rounded-xl border border-stone-200 bg-white text-stone-600 text-sm font-medium hover:bg-stone-50 active:scale-[0.97] transition-all relative"
        >
          <Play size={16} />
          Watch Demo
          {comingSoonOpen === 'video' && (
            <span className="absolute -top-9 left-1/2 -translate-x-1/2 bg-stone-800 text-white text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
              Coming soon
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={handleTour}
          className="flex items-center justify-center gap-2 flex-1 min-h-[48px] px-4 py-2.5 rounded-xl bg-[#8B2E4A] text-white text-sm font-semibold hover:bg-[#72253C] active:scale-[0.97] transition-all shadow-[0_2px_6px_rgba(139,46,74,0.22)] relative"
        >
          <Compass size={16} />
          Guided Tour
          {comingSoonOpen === 'tour' && (
            <span className="absolute -top-9 left-1/2 -translate-x-1/2 bg-stone-800 text-white text-xs px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
              Coming soon
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
