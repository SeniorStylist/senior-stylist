'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, X } from 'lucide-react'
import { ONBOARDING_CHECKLIST, startTour, isTourCompleted } from '@/lib/help/tours'

interface OnboardingChecklistProps {
  role: string
  completedTours: string[]
  isMaster: boolean
  userId: string
}

const COLLAPSED_KEY = 'onboardingChecklistCollapsed'

export function OnboardingChecklist({ role, completedTours, isMaster, userId }: OnboardingChecklistProps) {
  const normalizedRole = role === 'super_admin' ? 'admin' : role
  const items = ONBOARDING_CHECKLIST[normalizedRole] ?? []
  const DISMISSED_KEY = `onboardingChecklistDismissed:${userId}`

  const [localCompleted, setLocalCompleted] = useState<string[]>(completedTours)
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(`onboardingChecklistDismissed:${userId}`) === 'true'
  })
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(COLLAPSED_KEY) === 'true'
  })
  const [visible, setVisible] = useState(false)
  const [allDoneMsg, setAllDoneMsg] = useState(false)

  const completedCount = items.filter((item) => isTourCompleted(item.tourId, localCompleted)).length
  const totalCount = items.length

  // Entrance delay — slide up 1s after mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 1000)
    return () => clearTimeout(t)
  }, [])

  // Live update from tour-completed CustomEvent (Phase 12Q)
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ tourId: string }>).detail?.tourId
      if (id) setLocalCompleted((prev) => (prev.includes(id) ? prev : [...prev, id]))
    }
    window.addEventListener('tour-completed', handler)
    return () => window.removeEventListener('tour-completed', handler)
  }, [])

  // Auto-dismiss when all items complete
  useEffect(() => {
    if (completedCount === totalCount && totalCount > 0) {
      setAllDoneMsg(true)
      const t = setTimeout(() => {
        localStorage.setItem(DISMISSED_KEY, 'true')
        setDismissed(true)
      }, 1500)
      return () => clearTimeout(t)
    }
  }, [completedCount, totalCount, DISMISSED_KEY])

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, 'true')
    setDismissed(true)
  }, [DISMISSED_KEY])

  const handleToggleCollapse = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem(COLLAPSED_KEY, String(next))
  }

  if (isMaster || items.length === 0) return null
  if (dismissed) return null

  return (
    <div
      role="complementary"
      aria-label="Getting started checklist"
      className="fixed right-4 md:right-6 bottom-4 z-[100] w-72 bg-white rounded-2xl border border-stone-200 shadow-lg transition-transform duration-300"
      style={{
        transform: visible ? 'translateY(0)' : 'translateY(120%)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100">
        <span
          className="flex-1 text-sm font-semibold text-stone-900 truncate"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          {allDoneMsg ? '🎉 You\'re all set!' : '🚀 Getting Started'}
        </span>
        <span className="text-xs text-stone-500 tabular-nums shrink-0">
          {completedCount} / {totalCount}
        </span>
        <button
          type="button"
          onClick={handleToggleCollapse}
          aria-label={collapsed ? 'Expand checklist' : 'Collapse checklist'}
          className="p-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors shrink-0"
        >
          {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss checklist"
          className="p-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors shrink-0"
        >
          <X size={15} />
        </button>
      </div>

      {/* Progress bar — always visible */}
      <div className="h-1 bg-stone-100">
        <div
          className="h-full bg-[#8B2E4A] rounded-full transition-all duration-500"
          style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
        />
      </div>

      {/* Checklist items */}
      {!collapsed && (
        <ul className="px-4 py-3 space-y-3">
          {items.map((item) => {
            const done = isTourCompleted(item.tourId, localCompleted)
            return (
              <li key={item.tourId} className="flex items-center gap-3">
                <CheckCircle2
                  size={18}
                  className={done ? 'text-[#8B2E4A] shrink-0' : 'text-stone-300 shrink-0'}
                />
                <span className={`flex-1 text-sm ${done ? 'line-through text-stone-400' : 'text-stone-700'}`}>
                  {item.label}
                </span>
                {!done && (
                  <button
                    type="button"
                    onClick={() => void startTour(item.tourId)}
                    className="text-xs font-medium text-[#8B2E4A] hover:underline shrink-0"
                  >
                    Start →
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
