'use client'

import { useState, useEffect } from 'react'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < 768
  })

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    const mql = window.matchMedia('(max-width: 767px)')
    mql.addEventListener('change', check)
    return () => mql.removeEventListener('change', check)
  }, [])

  return isMobile
}
