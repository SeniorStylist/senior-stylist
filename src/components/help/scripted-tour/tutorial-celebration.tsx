'use client'

import { useRouter } from 'next/navigation'

const CONFETTI_COLORS = ['#8B2E4A', '#E8A0B0', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6']

interface TutorialCelebrationProps {
  tourTitle: string
  learnings: string[]
  onClose: () => void
}

export function TutorialCelebration({ tourTitle, learnings, onClose }: TutorialCelebrationProps) {
  const router = useRouter()

  return (
    <>
      <style>{`
        @keyframes confetti-fall {
          0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(80px) rotate(720deg); opacity: 0; }
        }
        @keyframes scripted-backdrop-enter {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scripted-celebration-enter {
          from { opacity: 0; transform: translateY(16px) scale(0.92); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .confetti-dot,
          .scripted-backdrop-enter,
          .scripted-celebration-card { animation: none !important; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        className="scripted-backdrop-enter"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9020,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          animation: 'scripted-backdrop-enter 0.2s ease both',
        }}
        onClick={onClose}
      >
        {/* Card */}
        <div
          className="scripted-celebration-card"
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'white',
            borderRadius: 24,
            padding: '32px 28px',
            maxWidth: 360,
            width: '100%',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
            animation: 'scripted-celebration-enter 0.28s cubic-bezier(0.34,1.56,0.64,1) 0.05s both',
          }}
        >
          {/* Confetti burst */}
          <div style={{ position: 'absolute', top: 20, left: 0, right: 0, height: 0, overflow: 'visible', pointerEvents: 'none' }}>
            {Array.from({ length: 12 }).map((_, i) => {
              const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? '#8B2E4A'
              const left = 10 + (i / 12) * 80
              const delay = (i * 0.08).toFixed(2)
              const dur = (1.2 + (i % 3) * 0.3).toFixed(1)
              return (
                <div
                  key={i}
                  className="confetti-dot"
                  style={{
                    position: 'absolute',
                    left: `${left}%`,
                    top: 0,
                    width: 8,
                    height: 8,
                    borderRadius: i % 2 === 0 ? '50%' : 2,
                    background: color,
                    animation: `confetti-fall ${dur}s ${delay}s ease-in forwards`,
                  }}
                />
              )
            })}
          </div>

          {/* Checkmark */}
          <div style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: '#f0fdf4',
            border: '2px solid #86efac',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <p style={{ fontSize: 22, fontWeight: 700, color: '#1c1917', margin: '0 0 6px' }}>
            You did it! 🎉
          </p>
          <p style={{ fontSize: 14, color: '#78716c', margin: '0 0 20px' }}>
            You completed: <strong>{tourTitle}</strong>
          </p>

          {learnings.length > 0 && (
            <div style={{ textAlign: 'left', background: '#fafaf9', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
              {learnings.map((l, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: i < learnings.length - 1 ? 8 : 0 }}>
                  <span style={{ color: '#22c55e', fontSize: 14, flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: 13, color: '#44403c', lineHeight: 1.5 }}>{l}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                padding: '11px 20px',
                borderRadius: 12,
                border: 'none',
                background: '#8B2E4A',
                color: 'white',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Try it for real →
            </button>
            <button
              onClick={() => { onClose(); router.push('/help') }}
              style={{
                padding: '11px 20px',
                borderRadius: 12,
                border: '1.5px solid #e7e5e4',
                background: '#f5f5f4',
                color: '#57534e',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Do another tutorial →
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
