// Single source of truth for "which engine runs which tutorial" (help audit
// 2026-07-07). Both launch surfaces — the /help TutorialCard AND the onboarding
// checklist — go through launchTutorial(), so a given tutorial always runs the
// same engine and completion is recorded consistently.
//
// SCRIPTED_TO_BASE maps a scripted variant id back to its catalog tourId — the
// engine posts the BASE id to /api/profile/complete-tour and dispatches it in the
// tour-completed event, so ✓ Done badges + the checklist light up correctly.

// Tours that have an interactive scripted version (Phase 13). Keys are the
// TUTORIAL_CATALOG tourIds; values pick the platform variant by viewport.
export const SCRIPTED_TOUR_MAP: Record<string, { mobile: string; desktop: string }> = {
  'stylist-getting-started': { mobile: 'scripted-stylist-getting-started-mobile', desktop: 'scripted-stylist-getting-started-desktop' },
  'stylist-calendar': { mobile: 'scripted-stylist-calendar-mobile', desktop: 'scripted-stylist-calendar-desktop' },
  // The catalog carries platform-suffixed ids for the split stylist cards — these
  // MUST be mapped too or the cards silently fall back to the legacy engine
  // (help audit C1: these four were falling through).
  'stylist-getting-started-mobile': { mobile: 'scripted-stylist-getting-started-mobile', desktop: 'scripted-stylist-getting-started-mobile' },
  'stylist-getting-started-desktop': { mobile: 'scripted-stylist-getting-started-desktop', desktop: 'scripted-stylist-getting-started-desktop' },
  'stylist-calendar-mobile': { mobile: 'scripted-stylist-calendar-mobile', desktop: 'scripted-stylist-calendar-mobile' },
  'stylist-calendar-desktop': { mobile: 'scripted-stylist-calendar-desktop', desktop: 'scripted-stylist-calendar-desktop' },
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
  // Phase 15 new-feature tours (2026-07-07)
  'admin-notifications': { mobile: 'scripted-admin-notifications', desktop: 'scripted-admin-notifications' },
  'admin-waitlist': { mobile: 'scripted-admin-waitlist', desktop: 'scripted-admin-waitlist' },
  'admin-birthdays': { mobile: 'scripted-admin-birthdays', desktop: 'scripted-admin-birthdays' },
  'admin-payments-cof': { mobile: 'scripted-admin-payments-cof', desktop: 'scripted-admin-payments-cof' },
  'admin-signage': { mobile: 'scripted-admin-signage', desktop: 'scripted-admin-signage' },
  'admin-coverage-approval': { mobile: 'scripted-admin-coverage-approval', desktop: 'scripted-admin-coverage-approval' },
}

// Tours that create their own demo records through the UI flow — no pre-seeding needed.
export const UNSEEDED_SCRIPTED_TOURS = new Set([
  'scripted-master-add-facility',
  'scripted-master-add-stylist',
  'scripted-facility-staff-residents',
  'scripted-admin-residents',
  // Phase 15 info tours — nothing to seed
  'scripted-admin-notifications',
  'scripted-admin-waitlist',
  'scripted-admin-birthdays',
  'scripted-admin-payments-cof',
  'scripted-admin-signage',
  'scripted-admin-coverage-approval',
])

// Reverse map: scripted variant id → base catalog tourId (first key wins; the
// suffixed stylist entries intentionally resolve to their own catalog ids first
// via explicit ordering below).
export const SCRIPTED_TO_BASE: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const [base, v] of Object.entries(SCRIPTED_TOUR_MAP)) {
    if (!(v.mobile in out)) out[v.mobile] = base
    if (!(v.desktop in out)) out[v.desktop] = base
  }
  return out
})()

/**
 * Launch a tutorial by its CATALOG tourId — scripted engine when mapped
 * (platform variant by viewport, seeding as needed), legacy Driver.js otherwise.
 * `onNavigated` runs after a scripted tour starts (callers pass router.refresh —
 * required so SSR re-renders WITH the tutorial cookie; see TutorialCard notes).
 */
export async function launchTutorial(
  tourId: string,
  isMobile: boolean,
  onNavigated?: () => void,
): Promise<void> {
  const scripted = SCRIPTED_TOUR_MAP[tourId]
  if (scripted) {
    const id = isMobile ? scripted.mobile : scripted.desktop
    const m = await import('@/lib/help/scripted-tour')
    if (UNSEEDED_SCRIPTED_TOURS.has(id)) {
      await m.startScriptedTour(id)
    } else {
      await m.seedAndStart(id)
    }
    onNavigated?.()
    return
  }
  const { startTour } = await import('@/lib/help/tours')
  await startTour(tourId)
}
