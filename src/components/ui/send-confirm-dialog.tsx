'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Modal } from './modal'
import { BottomSheet } from './bottom-sheet'
import { Button } from './button'
import { useIsMobile } from '@/hooks/use-is-mobile'

export type SendChannel = 'email' | 'sms' | 'both'

export interface SendConfirmOptions {
  /** Whether the message goes out as an email, a text, or both. */
  channel: SendChannel
  /** Who it's going to — an email address, phone number, or "12 residents". */
  recipient: string
  /** One-line description of what's being sent. */
  summary: string
  /** Optional amber caution line, e.g. "Last sent Jun 14". */
  warning?: string
  /** Override the confirm button label (default "Send"). */
  confirmLabel?: string
}

const CHANNEL_LABEL: Record<SendChannel, string> = {
  email: 'Email',
  sms: 'Text',
  both: 'Email + text',
}

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3z" />
      <line x1="12" y1="18" x2="12" y2="18" />
    </svg>
  )
}

interface DialogProps extends SendConfirmOptions {
  open: boolean
  onConfirm: () => void
  onClose: () => void
}

export function SendConfirmDialog({
  open,
  channel,
  recipient,
  summary,
  warning,
  confirmLabel = 'Send',
  onConfirm,
  onClose,
}: DialogProps) {
  const isMobile = useIsMobile()

  const body = (
    <div className="flex flex-col gap-4 p-5">
      <p className="text-sm text-stone-600">Are you sure you want to send this?</p>
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3.5">
        <div className="flex items-center gap-2 text-[#8B2E4A]">
          {channel === 'sms' ? <PhoneIcon /> : <MailIcon />}
          <span className="text-xs font-semibold uppercase tracking-wide">{CHANNEL_LABEL[channel]}</span>
        </div>
        <p className="mt-1.5 text-sm font-semibold text-stone-900 break-words">{recipient}</p>
        <p className="mt-1 text-sm text-stone-600 break-words">{summary}</p>
      </div>
      {warning && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-amber-600" aria-hidden>
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12" y2="17" />
          </svg>
          <p className="text-xs text-amber-700">{warning}</p>
        </div>
      )}
    </div>
  )

  const footer = (
    <div className="flex gap-2 px-5 py-4 border-t border-stone-100 bg-white">
      <Button variant="ghost" onClick={onClose} className="flex-1">
        Cancel
      </Button>
      <Button onClick={onConfirm} className="flex-1">
        {confirmLabel}
      </Button>
    </div>
  )

  if (isMobile) {
    return (
      <BottomSheet isOpen={open} onClose={onClose} title="Confirm send" footer={footer}>
        {body}
      </BottomSheet>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Confirm send">
      {body}
      {footer}
    </Modal>
  )
}

/**
 * Promise-based confirmation gate for one-click email/text sends.
 *
 * ```ts
 * const { confirmSend, dialog } = useSendConfirm()
 * // ...in a send handler:
 * if (!(await confirmSend({ channel, recipient, summary }))) return
 * // ...existing fetch/toast logic unchanged...
 * // render {dialog} once in the component tree
 * ```
 */
export function useSendConfirm(): {
  confirmSend: (opts: SendConfirmOptions) => Promise<boolean>
  dialog: ReactNode
} {
  const [pending, setPending] = useState<SendConfirmOptions | null>(null)
  const resolveRef = useRef<((ok: boolean) => void) | null>(null)

  const confirmSend = useCallback(
    (opts: SendConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve
        setPending(opts)
      }),
    [],
  )

  const settle = useCallback((ok: boolean) => {
    resolveRef.current?.(ok)
    resolveRef.current = null
    setPending(null)
  }, [])

  const dialog = pending ? (
    <SendConfirmDialog
      open
      channel={pending.channel}
      recipient={pending.recipient}
      summary={pending.summary}
      warning={pending.warning}
      confirmLabel={pending.confirmLabel}
      onConfirm={() => settle(true)}
      onClose={() => settle(false)}
    />
  ) : null

  return { confirmSend, dialog }
}
