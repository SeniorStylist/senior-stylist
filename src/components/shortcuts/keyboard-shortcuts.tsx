'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/modal'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { useIsMobile } from '@/hooks/use-is-mobile'

const SHORTCUTS = [
  { key: 'N', description: 'New booking' },
  { key: '?', description: 'Show keyboard shortcuts' },
  { key: 'Esc', description: 'Close dialog / cancel' },
  { key: '⌘K', description: 'Command palette (search)' },
]

function isInputFocused() {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable
}

export function KeyboardShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false)
  const router = useRouter()
  const isMobile = useIsMobile()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when modifier keys are held (except Shift for ?)
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // Ignore when typing in an input
      if (isInputFocused()) return

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        router.push('/dashboard?new=1')
      } else if (e.key === '?') {
        e.preventDefault()
        setHelpOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [router])

  const content = (
    <div className="space-y-1" data-tour="shortcuts-overlay">
      {SHORTCUTS.map(({ key, description }) => (
        <div key={key} className="flex items-center justify-between py-2.5 px-1 border-b border-stone-100 last:border-0">
          <span className="text-sm text-stone-700">{description}</span>
          <kbd className="inline-flex items-center rounded-lg border border-stone-200 bg-stone-50 px-2 py-1 font-mono text-xs font-medium text-stone-600 shadow-sm">
            {key}
          </kbd>
        </div>
      ))}
    </div>
  )

  if (isMobile) {
    return (
      <BottomSheet isOpen={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard Shortcuts">
        <div className="px-4 pb-6">{content}</div>
      </BottomSheet>
    )
  }

  return (
    <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard Shortcuts">
      <div className="p-6 pt-0">{content}</div>
    </Modal>
  )
}
