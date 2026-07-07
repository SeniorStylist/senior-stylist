'use client'

// Phase 15 F1 — in-app notification bell. Self-fetching (no props needed), so it
// mounts anywhere: desktop TopBar and the mobile facility header. Desktop opens a
// click-outside dropdown; mobile opens the shared BottomSheet.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { useIsMobile } from '@/hooks/use-is-mobile'

interface NotificationRow {
  id: string
  type: string
  title: string
  body: string
  url: string | null
  readAt: string | null
  createdAt: string
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function NotificationBell({ anchor = 'desktop' }: { anchor?: 'desktop' | 'mobile' }) {
  const router = useRouter()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const j = await res.json()
      setRows(j.data.notifications ?? [])
      setUnreadCount(j.data.unreadCount ?? 0)
    } catch {
      // best-effort — the bell just stays dotless
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Desktop: close on click outside
  useEffect(() => {
    if (!open || isMobile) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, isMobile])

  const handleOpen = useCallback(async () => {
    setOpen(true)
    setLoading(true)
    await load()
    setLoading(false)
  }, [load])

  const markAllRead = useCallback(async () => {
    setUnreadCount(0)
    setRows((prev) => prev.map((r) => ({ ...r, readAt: r.readAt ?? new Date().toISOString() })))
    fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {})
  }, [])

  const handleItemClick = useCallback(
    (row: NotificationRow) => {
      if (!row.readAt) {
        setUnreadCount((n) => Math.max(0, n - 1))
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, readAt: new Date().toISOString() } : r)))
        fetch('/api/notifications/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [row.id] }),
        }).catch(() => {})
      }
      setOpen(false)
      if (row.url) router.push(row.url)
    },
    [router],
  )

  const list = (
    <div className="divide-y divide-stone-50">
      {loading && rows.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-stone-400">Loading…</div>
      )}
      {!loading && rows.length === 0 && (
        <div className="px-4 py-8 text-center">
          <p className="text-sm font-medium text-stone-500">No notifications yet</p>
          <p className="text-xs text-stone-400 mt-1">Booking and schedule updates will appear here.</p>
        </div>
      )}
      {rows.map((row) => (
        <button
          key={row.id}
          onClick={() => handleItemClick(row)}
          className={`w-full text-left px-4 py-3 transition-colors duration-[120ms] hover:bg-[#F9EFF2] ${
            row.readAt ? '' : 'bg-rose-50/50'
          }`}
        >
          <div className="flex items-start gap-2">
            {!row.readAt && <span className="mt-1.5 w-2 h-2 rounded-full bg-[#8B2E4A] shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-stone-900 leading-snug">{row.title}</p>
              <p className="text-[11.5px] text-stone-500 leading-snug mt-0.5">{row.body}</p>
              <p className="text-[10.5px] text-stone-400 mt-1">{timeAgo(row.createdAt)}</p>
            </div>
          </div>
        </button>
      ))}
    </div>
  )

  const header = (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-100">
      <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Notifications</p>
      {unreadCount > 0 && (
        <button onClick={markAllRead} className="text-xs font-medium text-[#8B2E4A] hover:underline">
          Mark all read
        </button>
      )}
    </div>
  )

  const trigger = (
    <button
      type="button"
      onClick={() => (open ? setOpen(false) : void handleOpen())}
      className="relative flex items-center justify-center w-8 h-8 rounded-full hover:bg-stone-100 transition-colors"
      aria-label="Notifications"
      title="Notifications"
      {...(anchor === 'mobile' ? { 'data-tour-mobile': 'notification-bell' } : { 'data-tour': 'notification-bell' })}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#8B2E4A] text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  )

  if (isMobile) {
    return (
      <>
        {trigger}
        <BottomSheet isOpen={open} onClose={() => setOpen(false)} title="Notifications">
          {unreadCount > 0 && (
            <div className="px-4 pt-2 flex justify-end">
              <button onClick={markAllRead} className="text-xs font-medium text-[#8B2E4A]">
                Mark all read
              </button>
            </div>
          )}
          <div className="pb-6">{list}</div>
        </BottomSheet>
      </>
    )
  }

  return (
    <div className="relative" ref={containerRef}>
      {trigger}
      {open && (
        <div className="absolute right-0 top-10 z-50 w-[360px] max-h-[480px] overflow-y-auto bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-lg)]">
          {header}
          {list}
        </div>
      )}
    </div>
  )
}
