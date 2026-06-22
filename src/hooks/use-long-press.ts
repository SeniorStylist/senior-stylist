import { useCallback, useRef } from 'react'

export function useLongPress(onLongPress: () => void, delay = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moved = useRef(false)
  const startX = useRef(0)
  const startY = useRef(0)

  const start = useCallback(
    (e: React.TouchEvent) => {
      moved.current = false
      startX.current = e.touches[0].clientX
      startY.current = e.touches[0].clientY
      timer.current = setTimeout(() => {
        if (!moved.current) onLongPress()
      }, delay)
    },
    [onLongPress, delay]
  )

  const move = useCallback((e: React.TouchEvent) => {
    const dx = Math.abs(e.touches[0].clientX - startX.current)
    const dy = Math.abs(e.touches[0].clientY - startY.current)
    if (dx > 10 || dy > 10) {
      moved.current = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return {
    onTouchStart: start,
    onTouchMove: move,
    onTouchEnd: cancel,
    onTouchCancel: cancel,
  }
}
