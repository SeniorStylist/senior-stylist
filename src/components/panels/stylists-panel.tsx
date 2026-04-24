'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import type { Stylist } from '@/types'

const PRESET_COLORS = [
  '#0D7377',
  '#7C3AED',
  '#DC2626',
  '#D97706',
  '#059669',
  '#2563EB',
  '#DB2777',
  '#92400E',
]

interface StylistsPanelProps {
  stylists: Stylist[]
  onStylistAdded: (stylist: Stylist) => void
  isAdmin?: boolean
}

export function StylistsPanel({ stylists, onStylistAdded, isAdmin = true }: StylistsPanelProps) {
  const router = useRouter()
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAdd = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setAdding(true)
    setError(null)
    try {
      const res = await fetch('/api/stylists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color }),
      })
      const json = await res.json()
      if (res.ok) {
        onStylistAdded(json.data)
        setName('')
        setColor(PRESET_COLORS[0])
        setShowAdd(false)
      } else {
        setError(json.error ?? 'Failed to add stylist')
      }
    } catch {
      setError('Network error')
    } finally {
      setAdding(false)
    }
  }

  const resetAdd = () => {
    setShowAdd(false)
    setError(null)
    setName('')
    setColor(PRESET_COLORS[0])
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-stone-100">
        {isAdmin && (
          <div className="flex justify-end">
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="w-11 h-11 shrink-0 flex items-center justify-center bg-[#8B2E4A] text-white rounded-xl hover:bg-[#72253C] active:scale-95 transition-all"
              title="Add stylist"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
        )}

        {showAdd && (
          <div className="mt-2 bg-stone-50 rounded-xl border border-stone-200 p-3 space-y-3">
            <p className="text-xs font-semibold text-stone-600">New Stylist</p>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Full name *"
              className="w-full bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all"
            />
            {/* Color picker */}
            <div>
              <p className="text-xs text-stone-400 mb-2">Calendar color</p>
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={cn(
                      'w-7 h-7 rounded-full transition-all duration-150',
                      color === c
                        ? 'ring-2 ring-offset-2 ring-stone-400 scale-110'
                        : 'hover:scale-105'
                    )}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={resetAdd} disabled={adding}>
                Cancel
              </Button>
              <Button size="sm" loading={adding} onClick={handleAdd}>
                Add
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Stylist list */}
      <div className="flex-1 overflow-y-auto">
        {stylists.length === 0 ? (
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
                <polygon points="18 1.5 19 3.5 21 4 19.5 5.5 19.8 7.8 18 6.7 16.2 7.8 16.5 5.5 15 4 17 3.5" />
              </svg>
            }
            title="No stylists yet"
          />
        ) : (
          stylists.map((stylist) => (
            <button
              key={stylist.id}
              onClick={() => router.push(`/stylists/${stylist.id}`)}
              className="w-full flex items-center gap-3 px-4 py-3.5 min-h-[44px] text-left hover:bg-[#F9EFF2] transition-colors duration-[120ms] ease-out border-b border-stone-50 last:border-0"
            >
              <Avatar name={stylist.name} color={stylist.color} size="md" />
              <div className="flex-1 min-w-0">
                <span className="block text-[13.5px] font-semibold text-stone-900 leading-snug truncate">
                  {stylist.name}
                </span>
                {stylist.commissionPercent > 0 && (
                  <span className="block text-[11.5px] text-stone-400 leading-snug mt-0.5">{stylist.commissionPercent}% commission</span>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
