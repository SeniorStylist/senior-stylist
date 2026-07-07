'use client'

// Phase 16 G8 — clone one salon day onto another date. Explicit confirm (bulk
// write); conflicts and inactive residents are skipped and reported.

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useToast } from '@/components/ui/toast'

export function CopyDayModal({
  open,
  onClose,
  defaultSourceDate,
  onCopied,
}: {
  open: boolean
  onClose: () => void
  defaultSourceDate: string // YYYY-MM-DD (the day currently in view)
  onCopied?: () => void
}) {
  const isMobile = useIsMobile()
  const { toast } = useToast()
  const [sourceDate, setSourceDate] = useState(defaultSourceDate)
  const [targetDate, setTargetDate] = useState('')
  const [copying, setCopying] = useState(false)
  const [result, setResult] = useState<{ created: number; skipped: { residentName: string; reason: string }[] } | null>(null)

  useEffect(() => {
    if (open) {
      setSourceDate(defaultSourceDate)
      setTargetDate('')
      setResult(null)
    }
  }, [open, defaultSourceDate])

  const copy = async () => {
    if (!sourceDate || !targetDate) return
    setCopying(true)
    try {
      const res = await fetch('/api/bookings/copy-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceDate, targetDate }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : 'Copy failed')
        return
      }
      setResult(j.data)
      toast.success(`${j.data.created} appointment${j.data.created === 1 ? '' : 's'} booked${j.data.skipped.length ? ` · ${j.data.skipped.length} skipped` : ''}`)
      onCopied?.()
    } catch {
      toast.error('Network error')
    } finally {
      setCopying(false)
    }
  }

  const inputCls = 'w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-1 focus:ring-[#8B2E4A]/20 transition-all'
  const labelCls = 'text-xs font-semibold text-stone-500 uppercase tracking-wide block mb-1'

  const body = (
    <div className="px-6 pb-6 pt-2 space-y-4">
      <p className="text-sm text-stone-500">
        Re-book everyone from one salon day onto a new date at the same times. Conflicts are skipped, not double-booked.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Copy from</label>
          <input type="date" value={sourceDate} onChange={(e) => setSourceDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>To</label>
          <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={inputCls} />
        </div>
      </div>
      {result && result.skipped.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 space-y-1 max-h-36 overflow-y-auto">
          <p className="font-semibold">Skipped:</p>
          {result.skipped.map((s, i) => (
            <p key={i}>{s.residentName} — {s.reason}</p>
          ))}
        </div>
      )}
      <Button
        onClick={copy}
        loading={copying}
        disabled={!sourceDate || !targetDate || sourceDate === targetDate}
        className="w-full"
      >
        Copy day
      </Button>
    </div>
  )

  if (isMobile) {
    return (
      <BottomSheet isOpen={open} onClose={onClose} title="Copy a Salon Day">
        {body}
      </BottomSheet>
    )
  }
  return (
    <Modal open={open} onClose={onClose} title="Copy a Salon Day">
      {body}
    </Modal>
  )
}
