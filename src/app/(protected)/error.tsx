'use client'

// Phase 22 — protected-route error boundary. Any SSR/render throw on a
// protected page (master-admin, dashboard, billing, …) shows this recoverable
// card instead of the stark platform "A server error occurred" screen.
// NOTE: this catches THROWS, not platform function timeouts — a slow cold
// render that gets killed never reaches React; maxDuration on the page is what
// covers that. Both are needed.

import { useEffect } from 'react'
import Link from 'next/link'

export default function ProtectedError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[protected error boundary]', error)
  }, [error])

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-lg)] p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-[#F9EFF2] flex items-center justify-center mx-auto mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h1
          className="text-xl text-stone-900 mb-1"
          style={{ fontFamily: "'DM Serif Display', serif", fontWeight: 400 }}
        >
          Something went wrong
        </h1>
        <p className="text-sm text-stone-500 mb-6">
          This page didn&apos;t load. It&apos;s usually temporary — try again in a moment.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-2.5 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] transition-colors"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center bg-stone-100 text-stone-700 text-sm font-semibold rounded-xl px-5 py-2.5 hover:bg-stone-200 transition-colors"
          >
            Go to dashboard
          </Link>
        </div>
        {error.digest && (
          <p className="text-[11px] text-stone-300 mt-4 font-mono">ref {error.digest}</p>
        )}
      </div>
    </div>
  )
}
