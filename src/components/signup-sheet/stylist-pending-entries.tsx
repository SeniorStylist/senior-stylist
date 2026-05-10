'use client'

import { useState } from 'react'
import { ClipboardList, ChevronDown } from 'lucide-react'
import type { SignupSheetEntryWithRelations } from '@/types'
import { cn } from '@/lib/utils'

interface StylistPendingEntriesProps {
  entries: SignupSheetEntryWithRelations[]
  onSchedule: (entry: SignupSheetEntryWithRelations) => void
}

export function StylistPendingEntries({ entries, onSchedule }: StylistPendingEntriesProps) {
  const [expanded, setExpanded] = useState(false)

  if (entries.length === 0) return null

  return (
    <div
      data-tour="stylist-signup-sheet-panel"
      className="rounded-2xl border border-amber-200 bg-amber-50/50 px-4 py-3 mb-3"
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <ClipboardList size={16} className="text-amber-700" />
          <span className="text-sm font-semibold text-amber-900">
            {entries.length} pending sign-up{entries.length === 1 ? '' : 's'}
          </span>
        </div>
        <ChevronDown
          size={16}
          className={cn('text-amber-700 transition-transform', expanded && 'rotate-180')}
        />
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="bg-white rounded-xl border border-stone-100 p-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-stone-900 leading-snug">
                  {entry.residentName}
                  {entry.roomNumber && (
                    <span className="text-stone-400 ml-2 text-xs font-normal">Rm {entry.roomNumber}</span>
                  )}
                </p>
                <p className="text-[12.5px] text-stone-600 leading-snug mt-0.5">
                  {entry.serviceName}
                  {entry.requestedTime && (
                    <span className="text-stone-500 ml-2">@ {formatHm(entry.requestedTime)}</span>
                  )}
                </p>
                {entry.notes && <p className="text-[11.5px] text-stone-500 mt-1">{entry.notes}</p>}
              </div>
              <button
                type="button"
                onClick={() => onSchedule(entry)}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-[#8B2E4A] text-white text-xs font-semibold hover:bg-[#72253C] transition-colors"
              >
                Schedule
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatHm(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return hhmm
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')}${period}`
}
