'use client'

// P60 — pick EXISTING stylists by name or ST-code (client-side filter over
// the directory the page shipped). The "always create" affordance on
// /stylists is how duplicate ST-codes got minted; this is its "pick existing"
// sibling.

import { useMemo, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import type { DirectoryStylist } from './wizard-types'

interface Props {
  directory: DirectoryStylist[]
  excludeIds: Set<string>
  onPick: (s: DirectoryStylist) => void
  onCreateNew: (typed: string) => void
  inputClassName: string
}

export function StylistTypeahead({ directory, excludeIds, onPick, onCreateNew, inputClassName }: Props) {
  const [q, setQ] = useState('')

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const pool = directory.filter((s) => !excludeIds.has(s.id))
    if (!needle) return pool.slice(0, 8)
    return pool
      .filter((s) => s.name.toLowerCase().includes(needle) || s.stylistCode.toLowerCase().includes(needle))
      .slice(0, 8)
  }, [q, directory, excludeIds])

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or ST-code…"
        aria-label="Search stylists"
        data-tour="wizard-stylist-search"
        className={inputClassName}
      />
      <div className="rounded-2xl border border-stone-200 divide-y divide-stone-100 overflow-hidden">
        {results.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#F9EFF2] transition-colors duration-[120ms]"
          >
            <Avatar name={s.name} color={s.color} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-stone-900 leading-snug truncate">{s.name}</span>
              <span className="block text-[11.5px] text-stone-500 leading-snug mt-0.5 font-mono">{s.stylistCode}</span>
            </span>
            <span className="text-sm font-semibold text-[#8B2E4A]">Add</span>
          </button>
        ))}
        {results.length === 0 && (
          <div className="px-4 py-5 text-center">
            <p className="text-sm font-semibold text-stone-700">
              {q.trim() ? 'No stylist matches' : 'No stylists to pick from yet'}
            </p>
            <p className="text-xs text-stone-500 mt-1">
              {q.trim() ? 'Try the ST-code, or create them below.' : 'Create the first one below.'}
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => onCreateNew(q.trim())}
          className="w-full px-4 py-3 text-left text-sm font-semibold text-[#8B2E4A] hover:bg-[#F9EFF2] transition-colors"
        >
          ➕ Create a new stylist{q.trim() ? ` "${q.trim()}"` : ''}
        </button>
      </div>
    </div>
  )
}
