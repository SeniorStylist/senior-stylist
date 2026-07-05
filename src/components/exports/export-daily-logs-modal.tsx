'use client'

import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useToast } from '@/components/ui/toast'
import { downloadExportFile } from '@/lib/exports/download-export'

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

interface Props {
  open: boolean
  onClose: () => void
  facilityId: string
  facilityName: string
}

export function ExportDailyLogsModal({ open, onClose, facilityId, facilityName }: Props) {
  const isMobile = useIsMobile()
  const { toast } = useToast()
  const [startDate, setStartDate] = useState(firstOfMonthIso())
  const [endDate, setEndDate] = useState(todayIso())
  const [mailSubject, setMailSubject] = useState(`Senior Stylist – ${facilityName}`)
  const [exporting, setExporting] = useState(false)

  const error = useMemo<string | null>(() => {
    if (!startDate || !endDate) return null
    const d = diffDays(startDate, endDate)
    if (d < 0) return 'End date must be on or after start date.'
    if (d > 366) return 'Range cannot exceed 366 days.'
    return null
  }, [startDate, endDate])

  const handleExport = async () => {
    if (error || exporting) return
    const url = `/api/exports/daily-logs?facilityIds=${encodeURIComponent(facilityId)}&startDate=${startDate}&endDate=${endDate}&mailSubject=${encodeURIComponent(mailSubject.trim() || 'Senior Stylist Export')}`
    setExporting(true)
    const result = await downloadExportFile(url, `daily-logs_${startDate}_to_${endDate}.xlsx`)
    setExporting(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    onClose()
  }

  const body = (
    <div className="flex flex-col gap-4 p-5">
      <p className="text-sm text-stone-600">
        Download all completed daily log entries for{' '}
        <span className="font-semibold text-stone-900">{facilityName}</span> in the selected range as an Excel file.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Input
          id="export-start"
          label="Start date"
          type="date"
          value={startDate}
          max={endDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <Input
          id="export-end"
          label="End date"
          type="date"
          value={endDate}
          min={startDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Input
        id="export-mail-subject"
        label="Mail Subject (column B in the export)"
        type="text"
        value={mailSubject}
        maxLength={200}
        onChange={(e) => setMailSubject(e.target.value)}
        placeholder="Senior Stylist Export"
      />
    </div>
  )

  const footer = (
    <div className="flex gap-2 px-5 py-4 border-t border-stone-100 bg-white">
      <Button variant="ghost" onClick={onClose} className="flex-1">
        Cancel
      </Button>
      <Button onClick={handleExport} disabled={!!error || exporting} className="flex-1">
        {exporting ? 'Preparing export…' : 'Export'}
      </Button>
    </div>
  )

  if (isMobile) {
    return (
      <BottomSheet isOpen={open} onClose={onClose} title="Export Daily Log" footer={footer}>
        {body}
      </BottomSheet>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Export Daily Log">
      {body}
      {footer}
    </Modal>
  )
}
