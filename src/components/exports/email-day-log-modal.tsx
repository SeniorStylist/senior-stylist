'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useToast } from '@/components/ui/toast'

interface Props {
  open: boolean
  onClose: () => void
  date: string
  dateLabel: string
  facilityName: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function EmailDayLogModal({ open, onClose, date, dateLabel, facilityName }: Props) {
  const isMobile = useIsMobile()
  const { toast } = useToast()
  const [to, setTo] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const validEmail = EMAIL_RE.test(to.trim())

  const handleSend = async () => {
    if (!validEmail || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/log/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          to: to.trim(),
          message: message.trim() || undefined,
        }),
      })
      const json = await res.json().catch(() => ({})) as { data?: { count: number }; error?: string }
      if (!res.ok) {
        toast.error(typeof json.error === 'string' ? json.error : 'Failed to send email')
        return
      }
      toast.success(`Day log sent to ${to.trim()}`)
      setTo('')
      setMessage('')
      onClose()
    } catch {
      toast.error('Network error — email not sent')
    } finally {
      setSending(false)
    }
  }

  const body = (
    <div className="flex flex-col gap-4 p-5">
      <p className="text-sm text-stone-600">
        Email a formatted copy of the <span className="font-semibold text-stone-900">{dateLabel}</span> daily
        log for <span className="font-semibold text-stone-900">{facilityName}</span>.
      </p>
      <Input
        id="email-log-to"
        label="Send to"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="facility@example.com"
        value={to}
        onChange={(e) => setTo(e.target.value)}
      />
      <div>
        <label htmlFor="email-log-message" className="block text-xs font-semibold text-stone-600 mb-1">
          Message <span className="font-normal text-stone-400">(optional)</span>
        </label>
        <textarea
          id="email-log-message"
          rows={3}
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Add a short note for the recipient…"
          className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all resize-none"
        />
      </div>
      {to.trim().length > 0 && !validEmail && (
        <p className="text-xs text-red-600">Enter a valid email address.</p>
      )}
    </div>
  )

  const footer = (
    <div className="flex gap-2 px-5 py-4 border-t border-stone-100 bg-white">
      <Button variant="ghost" onClick={onClose} className="flex-1" disabled={sending}>
        Cancel
      </Button>
      <Button onClick={handleSend} disabled={!validEmail} loading={sending} className="flex-1">
        Send Email
      </Button>
    </div>
  )

  if (isMobile) {
    return (
      <BottomSheet isOpen={open} onClose={onClose} title="Email Day Log" footer={footer}>
        {body}
      </BottomSheet>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Email Day Log">
      {body}
      {footer}
    </Modal>
  )
}
