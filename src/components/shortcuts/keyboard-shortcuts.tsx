'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { Modal } from '@/components/ui/modal'
import { BottomSheet } from '@/components/ui/bottom-sheet'

const SHORTCUTS = [
  { key: 'N', description: 'New booking' },
  { key: '?', description: 'Keyboard shortcuts' },
  { key: 'Esc', description: 'Close modal / drawer' },
  { key: '⌘K / Ctrl+K', description: 'Command palette' },
]

function ShortcutsHelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const isMobile = useIsMobile()
  const content = (
    <div className="space-y-2">
      {SHORTCUTS.map((s) => (
        <div key={s.key} className="flex items-center gap-4 py-2 border-b border-stone-100 last:border-0">
          <kbd className="shrink-0 inline-flex items-center px-2.5 py-1 rounded-lg bg-stone-100 text-stone-700 text-xs font-mono font-semibold min-w-[40px] justify-center">
            {s.key}
          </kbd>
          <span className="text-sm text-stone-700">{s.description}</span>
        </div>
      ))}
    </div>
  )

  if (isMobile) {
    return (
      <BottomSheet isOpen={open} onClose={onClose} title="Keyboard Shortcuts">
        <div className="px-4 pb-6">{content}</div>
      </BottomSheet>
    )
  }
  return (
    <Modal open={open} onClose={onClose} title="Keyboard Shortcuts">
      <div className="px-6 pb-6">{content}</div>
    </Modal>
  )
}

export function KeyboardShortcuts() {
  const router = useRouter()
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
      if ((e.target as HTMLElement).isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        router.push('/dashboard?new=1')
      } else if (e.key === '?') {
        e.preventDefault()
        setHelpOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [router])

  return (
    <ShortcutsHelpOverlay
      open={helpOpen}
      onClose={() => setHelpOpen(false)}
    />
  )
}
