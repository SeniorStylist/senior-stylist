'use client'

// P40 — the assistant chat brain, shared by the floating widget and the
// inline Analytics/Master-Admin card. Holds the conversation, talks to
// POST /api/ai/assistant, and executes CONFIRMED actions from this client
// against the existing REST endpoints (user's own session — all server
// guards run exactly as the normal UI) behind the shared ACTION_RULES
// allowlist (src/lib/ai-assistant/action-allowlist.ts).

import { useEffect, useRef, useState } from 'react'
import { useToast } from '@/components/ui/toast'
import { actionAllowed, type PendingAction, type AssistantActionKind } from '@/lib/ai-assistant/action-allowlist'

export interface ChatMsg {
  role: 'user' | 'model'
  text: string
}

const DONE_LABEL: Record<AssistantActionKind, string> = {
  book: 'Booked',
  cancel: 'Cancelled',
  reschedule: 'Moved',
  update_appointment: 'Updated',
  create_resident: 'Added',
  update_resident: 'Updated',
  set_stylist_hours: 'Hours saved',
  add_time_off: 'Time off added',
  decide_time_off: 'Done',
  add_to_waitlist: 'Added to waitlist',
  add_signup_entry: 'Added to sign-up sheet',
  create_service: 'Service created',
  update_service: 'Service updated',
  update_stylist: 'Updated',
  reply_to_feedback: 'Reply sent',
  send_receipt: 'Receipt sent',
  switch_facility: 'Switched',
}

export function useAssistantChat() {
  const { toast } = useToast()
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [confirming, setConfirming] = useState(false)
  const logRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    // keep the newest message in view
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages, pendingAction, sending])

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim()
    if (!text || sending) return
    setSending(true)
    setPendingAction(null)
    const nextMessages: ChatMsg[] = [...messages, { role: 'user', text }]
    setMessages(nextMessages)
    setInput('')
    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages.slice(-8).map((m) => ({ role: m.role, text: m.text.slice(0, 1500) })),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // keep the typed message recoverable
        setMessages(messages)
        setInput(text)
        toast.error(typeof json.error === 'string' ? json.error : "The assistant couldn't respond — try again.")
        return
      }
      const answer = typeof json.data?.answer === 'string' ? json.data.answer : '…'
      setMessages([...nextMessages, { role: 'model', text: answer }])
      const pa = json.data?.pendingAction as PendingAction | null | undefined
      if (pa && actionAllowed(pa)) setPendingAction(pa)
    } catch {
      setMessages(messages)
      setInput(text)
      toast.error('Network error — try again.')
    } finally {
      setSending(false)
    }
  }

  const runAction = async () => {
    const a = pendingAction
    if (!a || confirming) return
    if (!actionAllowed(a)) {
      setPendingAction(null)
      return
    }
    if (new Date(a.expiresAt).getTime() < Date.now()) {
      toast.error('This proposal expired — just ask again.')
      setPendingAction(null)
      return
    }
    setConfirming(true)
    try {
      const res = await fetch(a.request.path, {
        method: a.request.method,
        ...(a.request.body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a.request.body) }
          : {}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = typeof json.error === 'string' ? json.error : "That didn't go through."
        setMessages((prev) => [...prev, { role: 'model', text: `That didn't work: ${msg}` }])
        setPendingAction(null)
        return
      }
      // P41 — a confirmed facility switch changes the whole app's context:
      // hard reload (the P23 facility-switch rule — router.refresh() leaves
      // client useState(initialProps) stale).
      if (a.kind === 'switch_facility') {
        toast.success('Switching…')
        window.location.reload()
        return
      }
      const doneLabel = DONE_LABEL[a.kind] ?? 'Done'
      setMessages((prev) => [...prev, { role: 'model', text: `[done] ${doneLabel}: ${a.summary.lines[0] ?? ''}` }])
      toast.success(`${doneLabel}!`)
      setPendingAction(null)
    } catch {
      toast.error('Network error — nothing was changed.')
    } finally {
      setConfirming(false)
    }
  }

  const expired = pendingAction ? new Date(pendingAction.expiresAt).getTime() < Date.now() : false

  return {
    messages,
    input,
    setInput,
    sending,
    pendingAction,
    setPendingAction,
    confirming,
    expired,
    send,
    runAction,
    logRef,
    textareaRef,
  }
}

export type AssistantChatState = ReturnType<typeof useAssistantChat>
