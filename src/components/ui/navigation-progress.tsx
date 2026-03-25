'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export function NavigationProgress() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [width, setWidth] = useState(0)
  const prevPathname = useRef(pathname)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const growTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (pathname === prevPathname.current) return
    prevPathname.current = pathname

    // Clear any existing timers
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (growTimer.current) clearTimeout(growTimer.current)

    // Start the bar
    setWidth(0)
    setVisible(true)

    // Grow to 85% quickly
    growTimer.current = setTimeout(() => setWidth(85), 20)

    // Complete and fade after 350ms
    hideTimer.current = setTimeout(() => {
      setWidth(100)
      setTimeout(() => setVisible(false), 200)
    }, 350)

    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (growTimer.current) clearTimeout(growTimer.current)
    }
  }, [pathname])

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: `${width}%`,
        height: '2px',
        backgroundColor: '#0D7377',
        zIndex: 9999,
        transition: width === 100 ? 'width 150ms ease-out, opacity 200ms ease-out' : 'width 300ms ease-out',
        opacity: width === 100 ? 0 : 1,
        pointerEvents: 'none',
      }}
    />
  )
}
