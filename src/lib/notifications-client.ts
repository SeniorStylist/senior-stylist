'use client'

// P31 — shared client fetch for GET /api/notifications. The bell is mounted
// TWICE (desktop TopBar + mobile facility header, both always rendered), so
// each page load fired two identical requests. This module-level in-flight
// cache (same pattern as dashboard-panels-client.ts) makes them share one,
// and the subscriber set keeps both instances' badge/list in sync after
// mark-read actions.

export interface NotificationRow {
  id: string
  type: string
  title: string
  body: string
  url: string | null
  readAt: string | null
  createdAt: string
}

export interface NotificationsData {
  notifications: NotificationRow[]
  unreadCount: number
}

type Listener = (data: NotificationsData) => void
const listeners = new Set<Listener>()

let cached: { at: number; p: Promise<NotificationsData | null> } | null = null

export function subscribeNotifications(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function broadcast(data: NotificationsData): void {
  listeners.forEach((cb) => {
    try { cb(data) } catch { /* listener errors never break the fetch */ }
  })
}

/**
 * Fetch notifications, coalescing concurrent callers into one request.
 * `fresh: true` forces a refetch unless one started <500ms ago.
 * Resolves null on network/HTTP failure (callers keep their current state).
 */
export function fetchNotifications(fresh = false): Promise<NotificationsData | null> {
  const now = Date.now()
  if (cached && (!fresh || now - cached.at < 500)) return cached.p
  const p = (async (): Promise<NotificationsData | null> => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return null
      const j = await res.json()
      const data: NotificationsData = {
        notifications: j.data?.notifications ?? [],
        unreadCount: j.data?.unreadCount ?? 0,
      }
      broadcast(data)
      return data
    } catch {
      return null
    }
  })()
  cached = { at: now, p }
  return p
}
