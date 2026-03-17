'use client'

import { useEffect, useRef, useState, ReactNode } from 'react'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** Rendered outside the scroll area — always visible above the home indicator */
  footer?: ReactNode
}

const DISMISS_THRESHOLD = 80

export function BottomSheet({ isOpen, onClose, title, children, footer }: BottomSheetProps) {
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

  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

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
    // Full-screen overlay — flex column pushes sheet to bottom
    <div
      className="bottom-sheet-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(2px)',
          opacity: isOpen ? 1 : 0,
          transition: 'opacity 300ms ease',
        }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="bottom-sheet"
        style={{
          position: 'relative',
          background: 'white',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.10)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '92dvh',
          paddingBottom: 'env(safe-area-inset-bottom)',
          transform: isOpen ? `translateY(${dragY}px)` : 'translateY(100%)',
          transition: dragging ? 'none' : 'transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          willChange: 'transform',
        }}
      >
        {/* Drag handle — never scrolls */}
        <div
          style={{
            flexShrink: 0,
            padding: '12px 16px 0',
            cursor: 'grab',
            userSelect: 'none',
            touchAction: 'none',
          }}
          onTouchStart={(e) => beginDrag(e.touches[0].clientY)}
          onTouchMove={(e) => moveDrag(e.touches[0].clientY)}
          onTouchEnd={(e) => endDrag(e.changedTouches[0].clientY)}
          onMouseDown={(e) => beginDrag(e.clientY)}
          onMouseMove={(e) => dragging && moveDrag(e.clientY)}
          onMouseUp={(e) => endDrag(e.clientY)}
          onMouseLeave={(e) => dragging && endDrag(e.clientY)}
        >
          <div style={{ width: 36, height: 4, background: '#e7e5e4', borderRadius: 2, margin: '0 auto' }} />
        </div>

        {/* Header — never scrolls */}
        {title && (
          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 20px',
              borderBottom: '1px solid #f5f5f4',
            }}
          >
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#1c1917', margin: 0 }}>{title}</h2>
            <button
              onClick={onClose}
              style={{
                width: 44,
                height: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#a8a29e',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                borderRadius: '50%',
                flexShrink: 0,
              }}
              aria-label="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Scrollable content — the ONLY part that scrolls */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
            minHeight: 0,
          } as React.CSSProperties}
        >
          {children}
        </div>

        {/* Footer — never scrolls, always visible above home indicator */}
        {footer != null && (
          <div style={{ flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
