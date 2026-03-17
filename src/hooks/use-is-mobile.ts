'use client'

import { useState, useEffect } from 'react'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    const mql = window.matchMedia('(max-width: 767px)')
    mql.addEventListener('change', check)
    return () => mql.removeEventListener('change', check)
  }, [])

  return isMobile
}
