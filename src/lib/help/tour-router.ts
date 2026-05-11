// Phase 12P — Module-level router ref for the tour engines.
//
// The tour engines (tours.ts, mobile-tour.ts) run outside the React tree and
// cannot call useRouter() directly. <TourRouterProvider /> mounted in the
// protected layout populates this ref on first paint; the engines read it via
// getTourRouter() when they need to perform a cross-route hop. Falls back to
// window.location.href + sessionStorage resume when the ref isn't set yet.

import type { useRouter } from 'next/navigation'

type AppRouter = ReturnType<typeof useRouter>

let _router: AppRouter | null = null

export function setTourRouter(router: AppRouter) {
  _router = router
}

export function getTourRouter(): AppRouter | null {
  return _router
}
