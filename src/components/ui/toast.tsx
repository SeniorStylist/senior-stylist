'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { haptics } from '@/lib/haptics'

type ToastType = 'success' | 'error' | 'info' | 'loading'

interface ToastAction {
  label: string
  onClick: () => void
}

interface Toast {
  id: string
  type: ToastType
  message: string
  visible: boolean
  action?: ToastAction
}

type ToastOptions = { action?: ToastAction }

type ToastFn = ((message: string, type?: ToastType, opts?: ToastOptions) => void) & {
  success: (message: string, opts?: ToastOptions) => void
  error: (message: string, opts?: ToastOptions) => void
  info: (message: string, opts?: ToastOptions) => void
  loading: (message: string, opts?: ToastOptions) => void
}

interface ToastContextValue {
  toast: ToastFn
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counterRef = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, visible: false } : t)))
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 160)
  }, [])

  const push = useCallback(
    (message: string, type: ToastType = 'success', opts?: ToastOptions) => {
      counterRef.current += 1
      const id = `toast-${counterRef.current}`
      // N2: haptic at toast creation — the single chokepoint every success/error
      // flows through (booking save, payment collected, check-in, walk-in, …).
      // Fires once here, never per render; no-op outside the native app.
      // Do NOT also call haptics.success/error at toast call sites — double-buzz.
      if (type === 'success') haptics.success()
      else if (type === 'error') haptics.error()
      setToasts((prev) => {
        const next = [...prev, { id, type, message, visible: true, action: opts?.action }]
        return next.slice(-3)
      })
      // Toasts with actions don't auto-dismiss — user must click action or X
      if (type !== 'error' && type !== 'loading' && !opts?.action) {
        setTimeout(() => dismiss(id), 3500)
      }
    },
    [dismiss]
  )

  const toast = useMemo(() => {
    const fn = ((message: string, type?: ToastType, opts?: ToastOptions) => push(message, type, opts)) as ToastFn
    fn.success = (message: string, opts?: ToastOptions) => push(message, 'success', opts)
    fn.error = (message: string, opts?: ToastOptions) => push(message, 'error', opts)
    fn.info = (message: string, opts?: ToastOptions) => push(message, 'info', opts)
    fn.loading = (message: string, opts?: ToastOptions) => push(message, 'loading', opts)
    return fn
  }, [push])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

const TYPE_STYLES: Record<ToastType, string> = {
  success: 'bg-white border border-emerald-200 text-stone-800',
  error: 'bg-white border border-red-200 text-stone-800',
  info: 'bg-white border border-stone-200 text-stone-700',
  loading: 'bg-white border border-stone-200 text-stone-700',
}

const ICON_COLOR: Record<ToastType, string> = {
  success: 'text-emerald-600',
  error: 'text-red-600',
  info: 'text-stone-500',
  loading: 'text-stone-500',
}

const TYPE_ICONS: Record<ToastType, React.ReactNode> = {
  success: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="16 10 11 15 8 12" />
    </svg>
  ),
  error: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  loading: (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  ),
}

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null

  return (
    <div
      className={cn(
        'fixed z-[9999] flex flex-col gap-2 pointer-events-none',
        'left-1/2 -translate-x-1/2 items-center',
        'md:right-6 md:left-auto md:translate-x-0 md:items-end'
      )}
      style={{ bottom: 'var(--app-floating-bottom)' }}
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const mounted = useRef(false)
  const [entered, setEntered] = useState(false)
  // Swipe-to-dismiss (horizontal) — native notification feel on touch devices.
  const [swipeX, setSwipeX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      requestAnimationFrame(() => setEntered(true))
    }
  }, [])

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    setSwiping(true)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const dx = e.touches[0].clientX - touchStartRef.current.x
    const dy = e.touches[0].clientY - touchStartRef.current.y
    // Horizontal intent only — vertical motion stays a page scroll.
    if (Math.abs(dx) > Math.abs(dy)) setSwipeX(dx)
  }
  const onTouchEnd = () => {
    setSwiping(false)
    if (Math.abs(swipeX) > 72) {
      // fling off-screen in the swipe direction, then remove
      setSwipeX(swipeX > 0 ? 400 : -400)
      setTimeout(() => onDismiss(toast.id), 160)
    } else {
      setSwipeX(0)
    }
    touchStartRef.current = null
  }

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className={cn(
        'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-[var(--shadow-lg)] text-sm font-medium min-w-[280px] max-w-[360px]',
        swiping ? 'transition-opacity duration-200 ease-out' : 'transition-all duration-200 ease-out',
        TYPE_STYLES[toast.type],
        entered && toast.visible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-3'
      )}
      style={{
        transform: swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
        opacity: entered && toast.visible ? Math.max(0.2, 1 - Math.abs(swipeX) / 250) : undefined,
        touchAction: 'pan-y',
      }}
    >
      <span className={cn('shrink-0', ICON_COLOR[toast.type])}>{TYPE_ICONS[toast.type]}</span>
      <span className="flex-1">{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => { toast.action!.onClick(); onDismiss(toast.id) }}
          className="shrink-0 text-[#8B2E4A] font-semibold text-xs hover:text-[#6A2237] transition-colors"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={() => onDismiss(toast.id)}
        className="ml-1 text-stone-400 hover:text-stone-600 shrink-0"
        aria-label="Dismiss"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
