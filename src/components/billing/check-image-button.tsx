'use client'

// Camera icon button that fetches a 1-hour signed URL for a payment's scanned
// check image and shows it in a lightbox. Signed URLs are never persisted —
// each open re-fetches within the TTL window.

import { useState } from 'react'
import { createPortal } from 'react-dom'

export function CheckImageButton({ paymentId }: { paymentId: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  async function openImage(e: React.MouseEvent) {
    e.stopPropagation()
    if (loading) return
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/billing/check-image/${paymentId}`)
      if (!res.ok) throw new Error()
      const body = (await res.json()) as { data?: { url?: string } }
      if (!body.data?.url) throw new Error()
      setImageUrl(body.data.url)
    } catch {
      setFailed(true)
      setTimeout(() => setFailed(false), 2500)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openImage}
        aria-label="View check image"
        title={failed ? 'Could not load image' : 'View check image'}
        className={`inline-flex items-center justify-center w-6 h-6 rounded-md border transition-colors shrink-0 align-middle ${
          failed
            ? 'border-red-200 bg-red-50 text-red-500'
            : 'border-stone-200 bg-white text-stone-400 hover:text-[#8B2E4A] hover:border-[#C4687A]'
        } ${loading ? 'opacity-50 cursor-wait' : ''}`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="12" cy="12" r="3.5" />
        </svg>
      </button>
      {imageUrl &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
            onClick={() => setImageUrl(null)}
            role="dialog"
            aria-label="Check image"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="Scanned check"
              className="max-w-full max-h-full rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              onClick={() => setImageUrl(null)}
              aria-label="Close"
              className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>,
          document.body
        )}
    </>
  )
}
