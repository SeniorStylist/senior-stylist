'use client'

import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useIsMobile } from '@/hooks/use-is-mobile'

function todayIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function firstOfMonthIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
}

function diffDays(start: string, end: string): number {
  const s = Date.parse(start + 'T00:00:00Z')
  const e = Date.parse(end + 'T00:00:00Z')
  return Math.round((e - s) / 86_400_000)
}

export interface ExportFacilityOption {
  id: string
  name: string
  facilityCode: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  facilities: ExportFacilityOption[]
  defaultSelectedId?: string | null
}

export function ExportDailyLogsMultiModal({
  open,
  onClose,
  facilities,
  defaultSelectedId,
}: Props) {
  const isMobile = useIsMobile()
  const [startDate, setStartDate] = useState(firstOfMonthIso())
  const [endDate, setEndDate] = useState(todayIso())
  const [selected, setSelected] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    if (defaultSelectedId) initial.add(defaultSelectedId)
    return initial
  })
  const [search, setSearch] = useState('')

  const filteredFacilities = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return facilities
    return facilities.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.facilityCode ?? '').toLowerCase().includes(q),
    )
  }, [facilities, search])

  const dateError = useMemo<string | null>(() => {
    if (!startDate || !endDate) return null
    const d = diffDays(startDate, endDate)
    if (d < 0) return 'End date must be on or after start date.'
    if (d > 366) return 'Range cannot exceed 366 days.'
    return null
  }, [startDate, endDate])

  const noneSelected = selected.size === 0
  const canExport = !dateError && !noneSelected

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(filteredFacilities.map((f) => f.id)))
  const clearAll = () => setSelected(new Set())

  const handleExport = () => {
    if (!canExport) return
    const ids = Array.from(selected).join(',')
    const url = `/api/exports/daily-logs?facilityIds=${encodeURIComponent(
      ids,
    )}&startDate=${startDate}&endDate=${endDate}`
    window.open(url, '_blank')
    onClose()
  }

  const body = (
    <div className="flex flex-col gap-4 p-5">
      <p className="text-sm text-stone-600">
        Download all completed daily log entries for the selected facilities in the chosen date range as an Excel file.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Input
          id="export-multi-start"
          label="Start date"
          type="date"
          value={startDate}
          max={endDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <Input
          id="export-multi-end"
          label="End date"
          type="date"
          value={endDate}
          min={startDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
      {dateError && <p className="text-xs text-red-600">{dateError}</p>}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
            Facilities ({selected.size} selected)
          </label>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={selectAll}
              className="text-[#8B2E4A] hover:underline font-semibold"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="text-stone-500 hover:underline font-semibold"
            >
              Clear
            </button>
          </div>
        </div>
        <input
          type="search"
          placeholder="Search facilities…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:bg-white focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
        />
        <div className="max-h-64 overflow-y-auto border border-stone-200 rounded-xl divide-y divide-stone-100 bg-white">
          {filteredFacilities.length === 0 ? (
            <p className="px-3.5 py-4 text-sm text-stone-400">No facilities match.</p>
          ) : (
            filteredFacilities.map((f) => (
              <label
                key={f.id}
                className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-stone-50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(f.id)}
                  onChange={() => toggle(f.id)}
                  className="accent-[#8B2E4A] w-4 h-4"
                />
                <span className="text-sm text-stone-900 flex-1 truncate">
                  {f.facilityCode && (
                    <span className="font-mono text-xs text-stone-400 mr-1.5">
                      {f.facilityCode}
                    </span>
                  )}
                  {f.name}
                </span>
              </label>
            ))
          )}
        </div>
      </div>
    </div>
  )

  const footer = (
    <div className="flex gap-2 px-5 py-4 border-t border-stone-100 bg-white">
      <Button variant="ghost" onClick={onClose} className="flex-1">
        Cancel
      </Button>
      <Button onClick={handleExport} disabled={!canExport} className="flex-1">
        Export
      </Button>
    </div>
  )

  if (isMobile) {
    return (
      <BottomSheet isOpen={open} onClose={onClose} title="Export Daily Logs" footer={footer}>
        {body}
      </BottomSheet>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Export Daily Logs" className="max-w-lg">
      {body}
      {footer}
    </Modal>
  )
}
