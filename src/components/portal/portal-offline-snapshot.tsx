'use client'

// P28 — family-portal offline card data. The portal is (deliberately) outside
// the service worker's page cache, so when a family member loses connection
// the offline hub used to show them a blank staff-oriented card. Portal pages
// mount this component to keep a tiny localStorage blob current; offline.html
// detects it and renders an elderly-friendly EN/ES card instead of the staff
// hub. Fields merge (home writes the appointment, billing writes the phone).
// Cleared on portal logout alongside clearReadCache (portal-header.tsx).

import { useEffect } from 'react'

export const PORTAL_OFFLINE_KEY = 'ss_portal_offline'

export interface PortalOfflineBlob {
  facilityName?: string
  facilityPhone?: string | null
  residentName?: string
  nextAppointment?: string | null // ISO
  balanceCents?: number
  lang?: string
  at?: number
}

export function PortalOfflineSnapshot(props: PortalOfflineBlob) {
  useEffect(() => {
    try {
      let existing: PortalOfflineBlob = {}
      try {
        existing = JSON.parse(localStorage.getItem(PORTAL_OFFLINE_KEY) ?? '{}') as PortalOfflineBlob
      } catch { /* corrupt — overwrite */ }
      const merged: PortalOfflineBlob = { ...existing, at: Date.now() }
      for (const [k, v] of Object.entries(props)) {
        if (v !== undefined) (merged as Record<string, unknown>)[k] = v
      }
      localStorage.setItem(PORTAL_OFFLINE_KEY, JSON.stringify(merged))
    } catch { /* best-effort */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
