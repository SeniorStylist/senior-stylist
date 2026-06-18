'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr.buffer
}

export function PushNotificationCard() {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_KEY) return
    setSupported(true)
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => setEnabled(!!sub))
    )
  }, [])

  if (!supported) return null

  async function toggle() {
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      if (enabled) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await fetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          })
          await sub.unsubscribe()
        }
        setEnabled(false)
      } else {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') return
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
        })
        const json = sub.toJSON()
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: sub.endpoint,
            p256dh: json.keys?.p256dh ?? '',
            auth: json.keys?.auth ?? '',
          }),
        })
        setEnabled(true)
      }
    } catch (err) {
      console.error('[push] toggle error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'rgba(139,46,74,0.08)' }}
        >
          {enabled ? (
            <Bell size={18} style={{ color: '#8B2E4A' }} />
          ) : (
            <BellOff size={18} className="text-stone-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-stone-900">Booking alerts</p>
          <p className="text-xs text-stone-500 mt-0.5">
            {enabled ? 'Push notifications are on' : 'Get notified when you have a new booking'}
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={loading}
          className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-xl whitespace-nowrap transition-colors disabled:opacity-50"
          style={enabled ? { backgroundColor: '#F3F4F6', color: '#374151' } : { backgroundColor: '#8B2E4A', color: 'white' }}
        >
          {loading ? '…' : enabled ? 'Turn off' : 'Enable'}
        </button>
      </div>
    </div>
  )
}
