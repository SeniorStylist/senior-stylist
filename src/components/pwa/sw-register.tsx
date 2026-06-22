'use client'

import { useEffect } from 'react'

export function SWRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('[SWRegister] registration failed:', err))
  }, [])

  return null
}
