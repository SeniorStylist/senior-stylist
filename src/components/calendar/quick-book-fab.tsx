'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface QuickBookFABProps {
  onOpen: () => void
}

export function QuickBookFAB({ onOpen }: QuickBookFABProps) {
  const [bounce, setBounce] = useState(false)

  const handleClick = () => {
    setBounce(true)
    setTimeout(() => setBounce(false), 700)
    onOpen()
  }

  return (
    <button
      onClick={handleClick}
      aria-label="Quick book appointment"
      className={cn(
        'md:hidden fixed right-5 bottom-4 w-14 h-14 rounded-full bg-[#8B2E4A] text-white',
        'shadow-lg flex items-center justify-center active:scale-95 transition-transform z-40',
        bounce && 'animate-fab-bounce'
      )}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  )
}
