'use client'

import { useState, useRef, useCallback } from 'react'

const PULL_THRESHOLD = 64 // px needed to trigger refresh

export function usePullToRefresh(onRefresh: () => Promise<void> | void) {
  const [refreshing, setRefreshing] = useState(false)
  const [pullProgress, setPullProgress] = useState(0) // 0–1
  const startYRef = useRef(0)
  const activeRef = useRef(false)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // Only activate when already at the scroll top
    const el = e.currentTarget as HTMLElement
    if (el.scrollTop === 0) {
      startYRef.current = e.touches[0].clientY
      activeRef.current = true
    }
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!activeRef.current || refreshing) return
    const diff = e.touches[0].clientY - startYRef.current
    if (diff > 0) {
      setPullProgress(Math.min(1, diff / PULL_THRESHOLD))
    }
  }, [refreshing])

  const onTouchEnd = useCallback(async (e: React.TouchEvent) => {
    if (!activeRef.current) return
    activeRef.current = false
    const diff = e.changedTouches[0].clientY - startYRef.current
    if (diff >= PULL_THRESHOLD) {
      setPullProgress(0)
      setRefreshing(true)
      try {
        await Promise.resolve(onRefresh())
      } finally {
        setRefreshing(false)
      }
    } else {
      setPullProgress(0)
    }
  }, [onRefresh])

  return {
    refreshing,
    pullProgress,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  }
}
