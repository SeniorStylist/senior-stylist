'use client'

// Phase 16 G11 — style gallery card on the resident detail page. Lazy-loads on
// expand; admin/facility_staff can upload, toggle family sharing, and delete.
// All URLs are short-lived signed URLs from the API — never storage paths.

import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

interface GalleryPhoto {
  id: string
  photoUrl: string | null
  caption: string | null
  sharedWithFamily: boolean
  createdAt: string
}

export function ResidentPhotoGallery({ residentId, canManage }: { residentId: string; canManage: boolean }) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [photos, setPhotos] = useState<GalleryPhoto[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/residents/${residentId}/photos`)
      if (res.ok) {
        const j = await res.json()
        setPhotos(j.data ?? [])
      }
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [residentId])

  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    if (next && !loaded) void load()
  }

  const upload = async (file: File | null) => {
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('sharedWithFamily', 'false')
      const res = await fetch(`/api/residents/${residentId}/photos`, { method: 'POST', body: form })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success('Photo added to the gallery')
        void load()
      } else {
        toast.error(typeof j.error === 'string' ? j.error : 'Upload failed')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const toggleShare = async (photo: GalleryPhoto) => {
    const next = !photo.sharedWithFamily
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, sharedWithFamily: next } : p)))
    const res = await fetch(`/api/residents/${residentId}/photos/${photo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharedWithFamily: next }),
    }).catch(() => null)
    if (!res?.ok) {
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, sharedWithFamily: !next } : p)))
      toast.error('Could not update sharing')
    }
  }

  const remove = async (photo: GalleryPhoto) => {
    const snapshot = photos
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
    const res = await fetch(`/api/residents/${residentId}/photos/${photo.id}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) {
      setPhotos(snapshot)
      toast.error('Could not delete the photo')
    }
  }

  return (
    <div data-tour="resident-photos" className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)]">
      <button
        onClick={toggleOpen}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div>
          <p className="text-sm font-semibold text-stone-800">Style Gallery</p>
          <p className="text-xs text-stone-400 mt-0.5">Photos of finished styles — share favorites with the family</p>
        </div>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5">
          {canManage && (
            <div className="mb-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void upload(e.target.files?.[0] ?? null)}
              />
              <Button size="sm" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
                + Add photo
              </Button>
            </div>
          )}
          {loading && <p className="text-sm text-stone-400 py-3">Loading…</p>}
          {!loading && photos.length === 0 && (
            <p className="text-sm text-stone-400 py-3">No photos yet — stylists can add them from the daily log after an appointment.</p>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {photos.map((p) => (
              <div key={p.id} className="relative group">
                {p.photoUrl && (
                  <a href={p.photoUrl} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.photoUrl}
                      alt={p.caption ?? 'Style photo'}
                      title={p.caption ?? undefined}
                      className="aspect-square w-full object-cover rounded-xl border border-stone-100"
                    />
                  </a>
                )}
                {p.sharedWithFamily && (
                  <span className="absolute top-1 left-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Family
                  </span>
                )}
                {canManage && (
                  <div className="absolute bottom-1 left-1 right-1 flex justify-between gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => void toggleShare(p)}
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-white/90 text-stone-600 border border-stone-200"
                    >
                      {p.sharedWithFamily ? 'Unshare' : 'Share'}
                    </button>
                    <button
                      onClick={() => void remove(p)}
                      aria-label="Delete photo"
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-white/90 text-red-600 border border-red-200"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
