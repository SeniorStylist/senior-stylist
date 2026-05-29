// Phase 13-Tutorial — tutorial fetch wrapper.
//
// Unlike the legacy `tour-fetch-interceptor` (which FAKES writes so legacy
// Driver.js/mobile tours can't touch real data), this wrapper lets every
// request through unchanged EXCEPT it stamps an `X-Tutorial-Mode: 1` header on
// same-origin /api/* requests while a scripted tour is active. The server reads
// that header to (a) persist new records with is_demo=true and (b) relax its
// demo read filters so tour-created records are visible mid-tour.
//
// The user's real form `fetch()` calls are unmodified — the wrapper sits on
// window.fetch and only adds the header. It is gated on isScriptedTourActive()
// at call time (NOT install time) so it instantly no-ops the moment a tour ends.

import { isScriptedTourActive } from './tour-mode'

let _installed = false
let _originalFetch: typeof window.fetch | null = null

export const TUTORIAL_HEADER = 'X-Tutorial-Mode'

function isSameOriginApi(url: string): boolean {
  if (url.startsWith('/api/')) return true
  if (typeof window !== 'undefined' && url.startsWith(`${window.location.origin}/api/`)) return true
  return false
}

export function installTutorialFetchWrapper() {
  if (_installed || typeof window === 'undefined') return
  _installed = true
  _originalFetch = window.fetch.bind(window)

  window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const orig = _originalFetch!
    if (!isScriptedTourActive()) return orig(input, init)

    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!isSameOriginApi(url)) return orig(input, init)

    // Clone headers from whichever source carries them and add the tutorial flag.
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )
    headers.set(TUTORIAL_HEADER, '1')

    // A Request object's headers are immutable via init merge, so rebuild it.
    if (input instanceof Request && !init?.headers) {
      return orig(new Request(input, { headers }))
    }
    return orig(input, { ...init, headers })
  }
}
