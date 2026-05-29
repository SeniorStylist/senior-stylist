'use client'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface SpotlightRingProps {
  targetRect: Rect
  padding?: number
  pulse?: boolean
}

export function SpotlightRing({ targetRect, padding = 8, pulse = false }: SpotlightRingProps) {
  return (
    <>
      <style>{`
        @keyframes scripted-tour-pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(139,46,74,0.55), 0 0 0 6px rgba(139,46,74,0.2); opacity: 1; }
          50% { box-shadow: 0 0 0 5px rgba(139,46,74,0.35), 0 0 0 10px rgba(139,46,74,0.1); opacity: 0.85; }
        }
        @media (prefers-reduced-motion: reduce) {
          .scripted-tour-ring { animation: none !important; }
        }
      `}</style>
      <div
        className="scripted-tour-ring"
        style={{
          position: 'fixed',
          left: targetRect.x - padding,
          top: targetRect.y - padding,
          width: targetRect.width + padding * 2,
          height: targetRect.height + padding * 2,
          borderRadius: 12,
          boxShadow: '0 0 0 3px rgba(139,46,74,0.55)',
          pointerEvents: 'none',
          zIndex: 9001,
          animation: pulse ? 'scripted-tour-pulse 1.8s ease-in-out infinite' : 'none',
        }}
      />
    </>
  )
}
