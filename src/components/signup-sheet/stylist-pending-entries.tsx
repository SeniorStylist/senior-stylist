'use client'

import { forwardRef, useState } from 'react'
import { Calendar, ChevronDown, ClipboardList, GripVertical } from 'lucide-react'
import type { SignupSheetEntryWithRelations } from '@/types'
import { cn } from '@/lib/utils'
import { formatDateInTz } from '@/lib/time'

interface StylistPendingEntriesProps {
  entries: SignupSheetEntryWithRelations[]
  onSchedule: (entry: SignupSheetEntryWithRelations) => void
  facilityTimezone: string
  /** When true, render the assigned-stylist name (admin/facility_staff cross-stylist view). */
  viewAsAdmin?: boolean
}

export const StylistPendingEntries = forwardRef<HTMLDivElement, StylistPendingEntriesProps>(
  function StylistPendingEntries({ entries, onSchedule, facilityTimezone, viewAsAdmin = false }, ref) {
    const [expanded, setExpanded] = useState(false)

    if (entries.length === 0) return null

    return (
      <div
        ref={ref}
        data-tour="stylist-pending-panel"
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
                data-tour="stylist-pending-entry"
                data-signup-entry-id={entry.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', entry.id)
                }}
                className="bg-white rounded-xl border border-stone-100 p-3 flex items-start gap-2"
              >
                <span className="hidden md:flex shrink-0 items-center text-stone-300 cursor-grab active:cursor-grabbing pt-0.5">
                  <GripVertical size={14} />
                </span>

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
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {entry.preferredDate && (
                      <span className="inline-flex items-center gap-1 text-xs bg-stone-100 text-stone-600 rounded-full px-2 py-0.5">
                        <Calendar size={12} />
                        {formatDateChip(entry.preferredDate, facilityTimezone)}
                      </span>
                    )}
                    {viewAsAdmin && entry.assignedStylist && (
                      <span className="text-xs text-stone-400">→ {entry.assignedStylist.name}</span>
                    )}
                  </div>
                  {entry.notes && (
                    <p className="text-xs text-stone-500 italic mt-1 truncate">
                      {entry.notes.length > 80 ? entry.notes.slice(0, 80) + '…' : entry.notes}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  data-tour="stylist-pending-convert"
                  onClick={() => onSchedule(entry)}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-[#8B2E4A] text-white text-xs font-semibold hover:bg-[#72253C] transition-colors"
                >
                  Pick time →
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  },
)

function formatHm(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return hhmm
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')}${period}`
}

function formatDateChip(yyyymmdd: string, tz: string): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  if (!y || !m || !d) return yyyymmdd
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  return formatDateInTz(anchor, tz)
}
