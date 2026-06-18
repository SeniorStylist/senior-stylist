import { useCallback, useRef } from 'react'

interface LongPressOptions {
  threshold?: number // ms before triggering (default 450)
  moveCancelDistance?: number // px of movement to cancel (default 8)
}

/**
 * Touch-based long-press hook.
 * Returns event handlers to spread onto the target element.
 * Movement cancels the press so normal scrolling is unaffected.
 */
export function useLongPress(
  onLongPress: () => void,
  { threshold = 450, moveCancelDistance = 8 }: LongPressOptions = {}
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPosRef = useRef<{ x: number; y: number } | null>(null)
  const firedRef = useRef(false)

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    startPosRef.current = null
    firedRef.current = false
  }, [])

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      firedRef.current = false
      startPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      timerRef.current = setTimeout(() => {
        firedRef.current = true
        onLongPress()
      }, threshold)
    },
    [onLongPress, threshold]
  )

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startPosRef.current || firedRef.current) return
      const dx = e.touches[0].clientX - startPosRef.current.x
      const dy = e.touches[0].clientY - startPosRef.current.y
      if (Math.sqrt(dx * dx + dy * dy) > moveCancelDistance) cancel()
    },
    [cancel, moveCancelDistance]
  )

  const onTouchEnd = useCallback(() => {
    cancel()
  }, [cancel])

  return { onTouchStart, onTouchMove, onTouchEnd }
}
