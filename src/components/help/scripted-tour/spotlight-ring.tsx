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
  isAction?: boolean
}

export function SpotlightRing({ targetRect, padding = 8, isAction = false }: SpotlightRingProps) {
  // Small targets (nav icons, the + FAB, the logo) get fully circled/pill-shaped
  // so they read as "circled". Large panels (calendar grid, tables) keep a subtle
  // 16px rounded-rect — a stadium shape there would look odd.
  const minDim = Math.min(targetRect.width, targetRect.height) + padding * 2
  const borderRadius = minDim <= 96 ? minDim / 2 : 16
  return (
    <>
      <style>{`
        @keyframes scripted-tour-pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(139,46,74,0.55), 0 0 0 6px rgba(139,46,74,0.2); opacity: 1; }
          50% { box-shadow: 0 0 0 5px rgba(139,46,74,0.35), 0 0 0 10px rgba(139,46,74,0.1); opacity: 0.85; }
        }
        @keyframes scripted-tour-pulse-action {
          0%, 100% { box-shadow: 0 0 0 3px rgba(255,255,255,0.95), 0 0 0 7px rgba(139,46,74,0.75), 0 0 22px 6px rgba(139,46,74,0.45); opacity: 1; }
          50% { box-shadow: 0 0 0 4px rgba(255,255,255,0.85), 0 0 0 11px rgba(139,46,74,0.45), 0 0 30px 10px rgba(139,46,74,0.25); opacity: 0.9; }
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
          borderRadius,
          // Action steps get a bright white inner highlight + burgundy glow so the
          // clickable target visibly "lights up"; info steps keep the subtle ring.
          boxShadow: isAction
            ? '0 0 0 3px rgba(255,255,255,0.95), 0 0 0 7px rgba(139,46,74,0.75), 0 0 22px 6px rgba(139,46,74,0.45)'
            : '0 0 0 3px rgba(139,46,74,0.55)',
          pointerEvents: 'none',
          zIndex: 9001,
          animation: isAction
            ? 'scripted-tour-pulse-action 1.6s ease-in-out infinite'
            : 'none',
        }}
      />
    </>
  )
}
