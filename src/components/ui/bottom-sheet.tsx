'use client'

import { useEffect, useRef, useState, ReactNode } from 'react'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

const DISMISS_THRESHOLD = 80

export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  // Keep DOM mounted for 300ms after close so the slide-out animation plays
  const [rendered, setRendered] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startYRef = useRef(0)

  useEffect(() => {
    if (isOpen) {
      setRendered(true)
    } else {
      const t = setTimeout(() => {
        setRendered(false)
        setDragY(0)
      }, 320)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  // Scroll lock
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (isOpen) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const beginDrag = (clientY: number) => {
    setDragging(true)
    startYRef.current = clientY
  }

  const moveDrag = (clientY: number) => {
    if (!dragging) return
    const offset = Math.max(0, clientY - startYRef.current)
    setDragY(offset)
  }

  const endDrag = (clientY: number) => {
    if (!dragging) return
    setDragging(false)
    const offset = clientY - startYRef.current
    if (offset > DISMISS_THRESHOLD) {
      setDragY(0)
      onClose()
    } else {
      setDragY(0)
    }
  }

  if (!rendered) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{
          backgroundColor: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(2px)',
          opacity: isOpen ? 1 : 0,
          transition: 'opacity 300ms ease',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl flex flex-col"
        style={{
          maxHeight: '92dvh',
          transform: isOpen ? `translateY(${dragY}px)` : 'translateY(100%)',
          transition: dragging ? 'none' : 'transform 320ms cubic-bezier(0.32, 0.72, 0, 1)',
          willChange: 'transform',
        }}
      >
        {/* Drag handle — full-width touch zone */}
        <div
          className="flex items-center justify-center pt-3 pb-2 shrink-0 cursor-grab active:cursor-grabbing select-none touch-none"
          onTouchStart={(e) => beginDrag(e.touches[0].clientY)}
          onTouchMove={(e) => moveDrag(e.touches[0].clientY)}
          onTouchEnd={(e) => endDrag(e.changedTouches[0].clientY)}
          onMouseDown={(e) => beginDrag(e.clientY)}
          onMouseMove={(e) => dragging && moveDrag(e.clientY)}
          onMouseUp={(e) => endDrag(e.clientY)}
          onMouseLeave={(e) => dragging && endDrag(e.clientY)}
        >
          <div className="w-9 h-1 bg-stone-300 rounded-full" />
        </div>

        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100 shrink-0">
            <h2 className="text-base font-semibold text-stone-900">{title}</h2>
            <button
              onClick={onClose}
              className="w-11 h-11 flex items-center justify-center -mr-2 text-stone-400 hover:text-stone-700 transition-colors rounded-full"
              aria-label="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
          {children}
        </div>
      </div>
    </>
  )
}
