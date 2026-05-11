'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { TUTORIAL_CATALOG, startTour, type Tutorial } from '@/lib/help/tours'
import { TutorialCard } from '@/components/help/tutorial-card'

interface HelpClientProps {
  role: string
  isMaster: boolean
  completedTours: string[]
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

function visibleFor(role: string, isMaster: boolean, browseAll: boolean): Tutorial[] {
  if (browseAll) return TUTORIAL_CATALOG.filter((t) => isMaster || !t.masterOnly)
  // Master admin sees only master-only cards by default; "Browse all" reveals the rest.
  if (isMaster) return TUTORIAL_CATALOG.filter((t) => t.masterOnly)

  // Admin (and normalized super_admin) sees only admin/super_admin-tagged content.
  // Other role sections are accessible via the "Browse all" toggle.
  if (role === 'admin' || role === 'super_admin') {
    return TUTORIAL_CATALOG.filter(
      (t) =>
        !t.masterOnly &&
        (t.roles.includes('admin') || t.roles.includes('super_admin')),
    )
  }
  return TUTORIAL_CATALOG.filter((t) => !t.masterOnly && t.roles.includes(role as Tutorial['roles'][number]))
}

function groupByCategory(items: Tutorial[]): Record<string, Tutorial[]> {
  const out: Record<string, Tutorial[]> = {}
  for (const t of items) {
    if (!out[t.category]) out[t.category] = []
    out[t.category].push(t)
  }
  return out
}

function HelpInner({ role, isMaster, completedTours }: HelpClientProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [browseAll, setBrowseAll] = useState(false)
  const [localCompleted, setLocalCompleted] = useState<string[]>(completedTours)

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ tourId: string }>).detail?.tourId
      if (id) setLocalCompleted((prev) => (prev.includes(id) ? prev : [...prev, id]))
    }
    window.addEventListener('tour-completed', handler)
    return () => window.removeEventListener('tour-completed', handler)
  }, [])

  const tourParam = searchParams.get('tour')
  useEffect(() => {
    if (!tourParam) return
    void startTour(tourParam)
    // Strip the param so refresh doesn't re-fire
    router.replace('/help', { scroll: false })
  }, [tourParam, router])

  const tutorials = useMemo(
    () => visibleFor(role, isMaster, browseAll),
    [role, isMaster, browseAll],
  )
  const grouped = useMemo(() => groupByCategory(tutorials), [tutorials])
  const adminLike = role === 'admin' || role === 'super_admin' || isMaster

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

      <section>
        <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">
          {browseAll ? 'All Tutorials' : 'Your Guides'}
        </h2>
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
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
          ))}
        </div>
      </section>
    </div>
  )
}

export function HelpClient(props: HelpClientProps) {
  // useSearchParams must be wrapped in <Suspense> for Next.js streaming.
  return (
    <Suspense fallback={null}>
      <HelpInner {...props} />
    </Suspense>
  )
}
