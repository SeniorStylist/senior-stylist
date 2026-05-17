'use client'
import { useEffect, useState } from 'react'
export function ViewportDebug() {
  const [info, setInfo] = useState<string[]>([])
  useEffect(() => {
    function measure() {
      const lines: string[] = []
      lines.push(`window.innerHeight: ${window.innerHeight}`)
      lines.push(`window.visualViewport.height: ${window.visualViewport?.height ?? 'n/a'}`)
      lines.push(`document.documentElement.clientHeight: ${document.documentElement.clientHeight}`)
      lines.push(`document.body.clientHeight: ${document.body.clientHeight}`)
      lines.push(`screen.height: ${screen.height}`)
      const shell = document.querySelector('[data-debug-shell]') as HTMLElement | null
      if (shell) {
        const r = shell.getBoundingClientRect()
        lines.push(`shell top/bottom/height: ${r.top}/${r.bottom}/${r.height}`)
        lines.push(`shell computed position: ${getComputedStyle(shell).position}`)
      }
      const nav = document.querySelector('[data-debug-nav]') as HTMLElement | null
      if (nav) {
        const r = nav.getBoundingClientRect()
        lines.push(`nav top/bottom/height: ${r.top}/${r.bottom}/${r.height}`)
        lines.push(`nav computed position: ${getComputedStyle(nav).position}`)
        lines.push(`nav background: ${getComputedStyle(nav).backgroundColor}`)
        const gapFromBottom = window.innerHeight - r.bottom
        lines.push(`>>> GAP BELOW NAV: ${gapFromBottom}px <<<`)
      }
      lines.push(`safe-area-bottom: ${getComputedStyle(document.documentElement).getPropertyValue('--app-safe-bottom') || 'unset'}`)
      lines.push(`display-mode standalone: ${window.matchMedia('(display-mode: standalone)').matches}`)
      lines.push(`navigator.standalone: ${(navigator as any).standalone ?? 'n/a'}`)
      lines.push(`userAgent: ${navigator.userAgent.slice(0, 80)}`)
      setInfo(lines)
    }
    measure()
    const id = setInterval(measure, 500)
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    return () => { clearInterval(id); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure) }
  }, [])
  return (
    <div style={{ position: 'fixed', top: 60, left: 8, right: 8, zIndex: 99999, background: 'rgba(0,0,0,0.85)', color: '#0f0', font: '10px/1.3 monospace', padding: 6, borderRadius: 4, pointerEvents: 'none', maxHeight: '40vh', overflow: 'auto' }}>
      {info.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  )
}
