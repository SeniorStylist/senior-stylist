'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'info' | 'loading'

interface Toast {
  id: string
  type: ToastType
  message: string
  visible: boolean
}

type ToastFn = ((message: string, type?: ToastType) => void) & {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  loading: (message: string) => void
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
    (message: string, type: ToastType = 'success') => {
      counterRef.current += 1
      const id = `toast-${counterRef.current}`
      setToasts((prev) => {
        const next = [...prev, { id, type, message, visible: true }]
        return next.slice(-3)
      })
      if (type !== 'error' && type !== 'loading') {
        setTimeout(() => dismiss(id), 3500)
      }
    },
    [dismiss]
  )

  const toast = useMemo(() => {
    const fn = ((message: string, type?: ToastType) => push(message, type)) as ToastFn
    fn.success = (message: string) => push(message, 'success')
    fn.error = (message: string) => push(message, 'error')
    fn.info = (message: string) => push(message, 'info')
    fn.loading = (message: string) => push(message, 'loading')
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
        'bottom-4 left-1/2 -translate-x-1/2 items-center',
        'md:bottom-6 md:right-6 md:left-auto md:translate-x-0 md:items-end'
      )}
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

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      requestAnimationFrame(() => setEntered(true))
    }
  }, [])

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-[var(--shadow-lg)] text-sm font-medium min-w-[280px] max-w-[360px]',
        'transition-all duration-200 ease-out',
        TYPE_STYLES[toast.type],
        entered && toast.visible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-3'
      )}
    >
      <span className={cn('shrink-0', ICON_COLOR[toast.type])}>{TYPE_ICONS[toast.type]}</span>
      <span className="flex-1">{toast.message}</span>
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
