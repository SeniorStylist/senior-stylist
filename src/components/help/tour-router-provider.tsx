'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { setTourRouter } from '@/lib/help/tour-router'

/**
 * Phase 12P — Mounts inside the protected layout to hand the App Router
 * instance to the (out-of-React) tour engines via setTourRouter. Pure
 * side-effect; renders null.
 */
export function TourRouterProvider() {
  const router = useRouter()
  useEffect(() => {
    setTourRouter(router)
  }, [router])
  return null
}
