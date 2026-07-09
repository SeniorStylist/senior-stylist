'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { TUTORIAL_CATALOG, type Tutorial } from '@/lib/help/tours'
import { launchTutorial } from '@/lib/help/scripted-tour-map'
import { TutorialCard } from '@/components/help/tutorial-card'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { Search, BookOpen, ArrowRight } from 'lucide-react'

interface HelpClientProps {
  role: string
  isMaster: boolean
  completedTours: string[]
  helpProgress?: { tourId: string; stepIndex: number; scenarioState: Record<string, string> } | null
}

interface PausedTourInfo {
  tourId: string
  stepIndex: number
  title: string
  totalSteps: number
}

function roleLabel(role: string): string {
  return (
    {
      admin: 'Facility Admin',
      super_admin: 'Franchise Admin',
      facility_staff: 'Facility Staff',
      bookkeeper: 'Bookkeeper',
      stylist: 'Stylist',
      viewer: 'Viewer',
    }[role] ?? role
  )
}

function matchesPlatform(t: Tutorial, isMobile: boolean): boolean {
  if (!t.platform || t.platform === 'both') return true
  return t.platform === (isMobile ? 'mobile' : 'desktop')
}

function visibleFor(role: string, isMaster: boolean, browseAll: boolean, isMobile: boolean): Tutorial[] {
  const platformFilter = (t: Tutorial) => matchesPlatform(t, isMobile)
  if (browseAll) return TUTORIAL_CATALOG.filter((t) => (isMaster || !t.masterOnly) && platformFilter(t))
  if (isMaster) return TUTORIAL_CATALOG.filter((t) => t.masterOnly && platformFilter(t))

  if (role === 'admin' || role === 'super_admin') {
    return TUTORIAL_CATALOG.filter(
      (t) =>
        !t.masterOnly &&
        (t.roles.includes('admin') || t.roles.includes('super_admin')) &&
        platformFilter(t),
    )
  }
  return TUTORIAL_CATALOG.filter(
    (t) =>
      !t.masterOnly &&
      t.roles.includes(role as Tutorial['roles'][number]) &&
      platformFilter(t),
  )
}

function groupByCategory(items: Tutorial[]): Record<string, Tutorial[]> {
  const out: Record<string, Tutorial[]> = {}
  for (const t of items) {
    if (!out[t.category]) out[t.category] = []
    out[t.category].push(t)
  }
  return out
}

function filterByQuery(items: Tutorial[], query: string): Tutorial[] {
  if (!query.trim()) return items
  const q = query.toLowerCase()
  return items.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.blurb.toLowerCase().includes(q) ||
      (t.scenarioSummary?.toLowerCase().includes(q) ?? false),
  )
}

function HelpInner({ role, isMaster, completedTours, helpProgress }: HelpClientProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const isMobile = useIsMobile()
  const [browseAll, setBrowseAll] = useState(false)
  const [localCompleted, setLocalCompleted] = useState<string[]>(completedTours)
  const [query, setQuery] = useState('')
  const [pausedTour, setPausedTour] = useState<PausedTourInfo | null>(null)

  // Listen for live tour completions
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ tourId: string }>).detail?.tourId
      if (id) setLocalCompleted((prev) => (prev.includes(id) ? prev : [...prev, id]))
    }
    window.addEventListener('tour-completed', handler)
    return () => window.removeEventListener('tour-completed', handler)
  }, [])

  // Check sessionStorage for a paused scripted tour on mount
  useEffect(() => {
    async function checkPaused() {
      try {
        const raw = sessionStorage.getItem('scriptedTour')
        if (!raw) return
        const saved = JSON.parse(raw) as { tourId: string; stepIndex: number; expiresAt: number }
        if (saved.expiresAt < Date.now()) return

        // Load the tour definitions to get title + totalSteps
        const [{ STYLIST_MOBILE_TOURS }, { STYLIST_DESKTOP_TOURS }] = await Promise.all([
          import('@/lib/help/tours-stylist-mobile'),
          import('@/lib/help/tours-stylist-desktop'),
        ])
        const allScripted = [...STYLIST_MOBILE_TOURS, ...STYLIST_DESKTOP_TOURS]
        const tour = allScripted.find((t) => t.id === saved.tourId)
        if (!tour) return

        setPausedTour({
          tourId: saved.tourId,
          stepIndex: saved.stepIndex,
          title: tour.title,
          totalSteps: tour.steps.length,
        })
      } catch { /* ignore */ }
    }
    checkPaused()
  }, [])

  // Also surface helpProgress from DB as a fallback (persisted across sessions)
  useEffect(() => {
    if (pausedTour || !helpProgress) return
    async function checkDb() {
      if (!helpProgress) return
      try {
        const [{ STYLIST_MOBILE_TOURS }, { STYLIST_DESKTOP_TOURS }] = await Promise.all([
          import('@/lib/help/tours-stylist-mobile'),
          import('@/lib/help/tours-stylist-desktop'),
        ])
        const allScripted = [...STYLIST_MOBILE_TOURS, ...STYLIST_DESKTOP_TOURS]
        const tour = allScripted.find((t) => t.id === helpProgress.tourId)
        if (!tour) return
        setPausedTour({
          tourId: helpProgress.tourId,
          stepIndex: helpProgress.stepIndex,
          title: tour.title,
          totalSteps: tour.steps.length,
        })
      } catch { /* ignore */ }
    }
    checkDb()
  }, [helpProgress, pausedTour])

  const tourParam = searchParams.get('tour')
  useEffect(() => {
    if (!tourParam) return
    // Phase 25 — route through launchTutorial (the single tour entry point) so
    // ?tour= links run the scripted variant + demo seeding like TutorialCard,
    // instead of silently falling back to the legacy engine.
    void launchTutorial(tourParam, isMobile, () => router.refresh())
    router.replace('/help', { scroll: false })
  }, [tourParam, router, isMobile])

  const allTutorials = useMemo(
    () => visibleFor(role, isMaster, browseAll, isMobile),
    [role, isMaster, browseAll, isMobile],
  )
  const tutorials = useMemo(() => filterByQuery(allTutorials, query), [allTutorials, query])
  const grouped = useMemo(() => groupByCategory(tutorials), [tutorials])
  const adminLike = role === 'admin' || role === 'super_admin' || isMaster
  const hasQuery = query.trim().length > 0

  function handleResume() {
    if (!pausedTour) return
    import('@/lib/help/scripted-tour').then((m) => m.resumeScriptedTour())
    setPausedTour(null)
  }

  return (
    <div className="page-enter mx-auto max-w-5xl px-4 py-6 md:py-10" data-tour="help-home">
      <header className="mb-6 md:mb-8">
        <h1
          className="text-3xl md:text-4xl font-normal text-stone-900 mb-2"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Help &amp; Guides
        </h1>
        <p className="text-base text-stone-500">
          Learn how to use Senior Stylist at your own pace.
        </p>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full bg-rose-50 text-[#8B2E4A] border border-rose-100">
            {isMaster ? 'Master Admin' : roleLabel(role)}
          </span>
          {adminLike && (
            <button
              type="button"
              onClick={() => setBrowseAll((v) => !v)}
              className="inline-flex items-center text-[12px] font-medium px-3 py-1 rounded-full border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 transition-colors"
            >
              {browseAll ? '✓ Browsing all' : 'Browse all categories'}
            </button>
          )}
        </div>
      </header>

      {/* Search bar */}
      <div className="relative mb-6">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tutorials…"
          className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-stone-200 bg-white text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50 shadow-[var(--shadow-sm)]"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 text-xs px-1"
          >
            ✕
          </button>
        )}
      </div>

      {/* Resume banner */}
      {pausedTour && !hasQuery && (
        <div className="mb-6 flex items-center gap-4 rounded-2xl border border-[#8B2E4A]/20 bg-rose-50 px-5 py-4 shadow-[var(--shadow-sm)]">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-[#8B2E4A]">
              Resume: {pausedTour.title}
            </p>
            <p className="text-[12px] text-stone-500 mt-0.5">
              Step {pausedTour.stepIndex + 1} of {pausedTour.totalSteps} — you can pick up right where you left off
            </p>
          </div>
          <button
            type="button"
            onClick={handleResume}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#8B2E4A] text-white text-sm font-semibold hover:bg-[#72253C] active:scale-[0.97] transition-all shadow-[0_2px_6px_rgba(139,46,74,0.22)]"
          >
            Resume
            <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* Tutorial grid */}
      <section>
        {!hasQuery && (
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">
            {browseAll ? 'All Tutorials' : 'Your Guides'}
          </h2>
        )}
        {hasQuery && tutorials.length === 0 && (
          <div className="text-center py-12 text-stone-400">
            <BookOpen size={32} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">No tutorials match &ldquo;{query}&rdquo;</p>
          </div>
        )}
        <div className="space-y-6">
          {hasQuery ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tutorials.map((t) => (
                <TutorialCard
                  key={t.id}
                  tutorial={t}
                  completed={localCompleted.includes(t.tourId ?? '')}
                />
              ))}
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <h3 className="text-[13px] font-semibold text-stone-700 mb-3">{category}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {items.map((t) => (
                    <TutorialCard
                      key={t.id}
                      tutorial={t}
                      completed={localCompleted.includes(t.tourId ?? '')}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

export function HelpClient(props: HelpClientProps) {
  return (
    <Suspense fallback={null}>
      <HelpInner {...props} />
    </Suspense>
  )
}
