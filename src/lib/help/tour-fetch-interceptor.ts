// Phase 12O — Fetch interceptor for tour (demo) mode.
//
// Patches `window.fetch` once. While `isTourModeActive()` is true, any write
// (POST/PUT/PATCH/DELETE) to a same-origin `/api/*` route returns a fake
// success response instead of hitting the server. GETs, HEADs, and external
// URLs always pass through. When the flag is off the patched function is a
// pass-through, so the patch is safe to leave installed for the page lifetime.

import { isTourModeActive } from './tour-mode'

let _installed = false
let _originalFetch: typeof fetch | null = null

export function installTourFetchInterceptor() {
  if (_installed || typeof window === 'undefined') return
  _installed = true
  _originalFetch = window.fetch.bind(window)

  window.fetch = async function patchedFetch(input, init) {
    if (!isTourModeActive()) return _originalFetch!(input, init)

    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase()

    const isApi =
      url.startsWith('/api/') ||
      url.includes(`${window.location.origin}/api/`)
    const isWrite = method !== 'GET' && method !== 'HEAD'
    if (!isApi || !isWrite) return _originalFetch!(input, init)

    return buildFakeResponse(url, method)
  }
}

function fakeResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function buildFakeResponse(url: string, method: string): Response {
  const demoId = `demo-${Date.now()}`

  if (url.includes('/api/bookings') && url.includes('/receipt')) {
    return fakeResponse({ data: { emailSent: true, smsSent: false } })
  }
  if (url.includes('/api/log/ocr/import')) {
    return fakeResponse({ data: { created: { bookings: 0 } } })
  }
  if (url.includes('/api/log/ocr')) {
    return fakeResponse({ data: { sheets: [] } })
  }
  if (url.includes('/api/log') && (method === 'POST' || method === 'PUT')) {
    return fakeResponse({
      data: {
        id: demoId,
        finalized: true,
        finalizedAt: new Date().toISOString(),
        notes: '',
      },
    })
  }
  if (url.includes('/api/bookings') && method === 'POST') {
    return fakeResponse({ data: { id: demoId, status: 'scheduled' } })
  }
  if (
    url.includes('/api/bookings') &&
    (method === 'PUT' || method === 'PATCH')
  ) {
    return fakeResponse({
      data: {
        id: demoId,
        status: 'completed',
        paymentStatus: 'paid',
        priceCents: 0,
      },
    })
  }
  if (url.includes('/api/residents')) {
    return fakeResponse({ data: { id: demoId, name: 'Demo Resident' } })
  }
  return fakeResponse({ data: {}, ok: true })
}
