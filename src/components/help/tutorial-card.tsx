'use client'

import { useState } from 'react'
import {
  KeyRound, Calendar, FileText, Users, UserPlus, CheckCircle2, UserCog,
  Building2, Mail, BarChart3, HeartHandshake, ShieldCheck, CreditCard,
  ScanLine, GitMerge, Database, FileSpreadsheet, Wallet, PlusSquare,
  Network, BookOpen, CircleHelp, Play, Compass,
} from 'lucide-react'
import type { Tutorial, TutorialIcon } from '@/lib/help/tours'
import { startTour } from '@/lib/help/tours'

const ICON_MAP: Record<TutorialIcon, typeof KeyRound> = {
  KeyRound, Calendar, FileText, Users, UserPlus, CheckCircle2, UserCog,
  Building2, Mail, BarChart3, HeartHandshake, ShieldCheck, CreditCard,
  ScanLine, GitMerge, Database, FileSpreadsheet, Wallet, PlusSquare,
  Network, BookOpen, CircleHelp,
}

interface TutorialCardProps {
  tutorial: Tutorial
}

export function TutorialCard({ tutorial }: TutorialCardProps) {
  const Icon = ICON_MAP[tutorial.icon] ?? CircleHelp
  const [comingSoonOpen, setComingSoonOpen] = useState<'video' | 'tour' | null>(null)

  const handleTour = () => {
    if (tutorial.tourId) {
      void startTour(tutorial.tourId)
    } else {
      setComingSoonOpen('tour')
      setTimeout(() => setComingSoonOpen(null), 2000)
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
          <span className="inline-block mt-1 text-[11px] font-semibold text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">
            ~{tutorial.estMinutes} min
          </span>
        </div>
      </div>

      <p className="text-sm text-stone-500 leading-snug">{tutorial.blurb}</p>

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
