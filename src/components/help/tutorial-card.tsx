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
  // Facility-staff + admin residents (same UI on both platforms; resolveQuery maps anchors)
  'facility-staff-residents': { mobile: 'scripted-facility-staff-residents', desktop: 'scripted-facility-staff-residents' },
  'admin-residents': { mobile: 'scripted-admin-residents', desktop: 'scripted-admin-residents' },
  // Facility-staff scheduling (FAB on mobile, calendar grid on desktop)
  'facility-staff-scheduling': { mobile: 'scripted-facility-staff-scheduling-mobile', desktop: 'scripted-facility-staff-scheduling-desktop' },
  // Facility-staff sign-up sheet (same panel on both platforms)
  'facility-staff-signup-sheet': { mobile: 'scripted-facility-staff-signup-sheet', desktop: 'scripted-facility-staff-signup-sheet' },
  // Bookkeeper manual walk-in entry (same UI on both platforms)
  'bookkeeper-manual-entry': { mobile: 'scripted-bookkeeper-manual-entry', desktop: 'scripted-bookkeeper-manual-entry' },
  // Stylist remaining tours (same UI on both platforms)
  'stylist-my-account': { mobile: 'scripted-stylist-my-account', desktop: 'scripted-stylist-my-account' },
  'stylist-signup-sheet': { mobile: 'scripted-stylist-signup-sheet', desktop: 'scripted-stylist-signup-sheet' },
  'stylist-residents': { mobile: 'scripted-stylist-residents', desktop: 'scripted-stylist-residents' },
  // Facility staff remaining tours
  'staff-getting-started': { mobile: 'scripted-staff-getting-started', desktop: 'scripted-staff-getting-started' },
  'staff-daily-log': { mobile: 'scripted-staff-daily-log', desktop: 'scripted-staff-daily-log' },
  'staff-daily-log-readonly': { mobile: 'scripted-staff-daily-log-readonly', desktop: 'scripted-staff-daily-log-readonly' },
  // Admin remaining tours (desktop, same id for both)
  'admin-getting-started': { mobile: 'scripted-admin-getting-started', desktop: 'scripted-admin-getting-started' },
  'admin-facility-setup': { mobile: 'scripted-admin-facility-setup', desktop: 'scripted-admin-facility-setup' },
  'admin-inviting-staff': { mobile: 'scripted-admin-inviting-staff', desktop: 'scripted-admin-inviting-staff' },
  'admin-reports': { mobile: 'scripted-admin-reports', desktop: 'scripted-admin-reports' },
  'admin-family-portal': { mobile: 'scripted-admin-family-portal', desktop: 'scripted-admin-family-portal' },
  'admin-compliance': { mobile: 'scripted-admin-compliance', desktop: 'scripted-admin-compliance' },
  'admin-command-palette': { mobile: 'scripted-admin-command-palette', desktop: 'scripted-admin-command-palette' },
  'admin-peek-drawer': { mobile: 'scripted-admin-peek-drawer', desktop: 'scripted-admin-peek-drawer' },
  // Bookkeeper remaining + new tours
  'bookkeeper-getting-started': { mobile: 'scripted-bookkeeper-getting-started-mobile', desktop: 'scripted-bookkeeper-getting-started' },
  'bookkeeper-scan-logs': { mobile: 'scripted-bookkeeper-scan-logs', desktop: 'scripted-bookkeeper-scan-logs' },
  'bookkeeper-duplicates': { mobile: 'scripted-bookkeeper-duplicates', desktop: 'scripted-bookkeeper-duplicates' },
  'bookkeeper-billing-dashboard': { mobile: 'scripted-bookkeeper-billing-dashboard', desktop: 'scripted-bookkeeper-billing-dashboard' },
  'bookkeeper-payroll': { mobile: 'scripted-bookkeeper-payroll', desktop: 'scripted-bookkeeper-payroll' },
  'bookkeeper-export-logs': { mobile: 'scripted-bookkeeper-export-logs', desktop: 'scripted-bookkeeper-export-logs' },
  'bookkeeper-quickbooks': { mobile: 'scripted-bookkeeper-quickbooks', desktop: 'scripted-bookkeeper-quickbooks' },
  'bookkeeper-financial-reports': { mobile: 'scripted-bookkeeper-financial-reports', desktop: 'scripted-bookkeeper-financial-reports' },
  // Master remaining + new tours (desktop-only)
  'master-getting-started': { mobile: 'scripted-master-getting-started', desktop: 'scripted-master-getting-started' },
  'master-applicant-pipeline': { mobile: 'scripted-master-applicant-pipeline', desktop: 'scripted-master-applicant-pipeline' },
  'master-quickbooks-setup': { mobile: 'scripted-master-quickbooks-setup', desktop: 'scripted-master-quickbooks-setup' },
  'master-analytics': { mobile: 'scripted-master-analytics', desktop: 'scripted-master-analytics' },
  'master-franchise': { mobile: 'scripted-master-franchise', desktop: 'scripted-master-franchise' },
  'master-cross-facility-analytics': { mobile: 'scripted-master-cross-facility-analytics', desktop: 'scripted-master-cross-facility-analytics' },
  'master-merge-duplicates': { mobile: 'scripted-master-merge-duplicates', desktop: 'scripted-master-merge-duplicates' },
  'master-team-roster': { mobile: 'scripted-master-team-roster', desktop: 'scripted-master-team-roster' },
  // Master admin mobile tours (mobile-only cards — the bottom nav surfaces these screens)
  'master-getting-started-mobile': { mobile: 'scripted-master-getting-started-mobile', desktop: 'scripted-master-getting-started-mobile' },
  'master-calendar-mobile': { mobile: 'scripted-master-calendar-mobile', desktop: 'scripted-master-calendar-mobile' },
  'master-daily-log-mobile': { mobile: 'scripted-master-daily-log-mobile', desktop: 'scripted-master-daily-log-mobile' },
  'master-residents-mobile': { mobile: 'scripted-master-residents-mobile', desktop: 'scripted-master-residents-mobile' },
  'master-analytics-mobile': { mobile: 'scripted-master-analytics-mobile', desktop: 'scripted-master-analytics-mobile' },
  'master-payroll-mobile': { mobile: 'scripted-master-payroll-mobile', desktop: 'scripted-master-payroll-mobile' },
  'master-settings-mobile': { mobile: 'scripted-master-settings-mobile', desktop: 'scripted-master-settings-mobile' },
}

// Tours that create their own demo records through the UI flow — no pre-seeding needed.
const UNSEEDED_SCRIPTED_TOURS = new Set([
  'scripted-master-add-facility',
  'scripted-master-add-stylist',
  'scripted-facility-staff-residents',
  'scripted-admin-residents',
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
