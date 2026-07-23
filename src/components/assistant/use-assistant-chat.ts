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
import type { GuidedWalkPayload } from '@/lib/ai-assistant/tools'

export interface ChatMsg {
  role: 'user' | 'model'
  text: string
}

// P42 — Quick/Smart pill. 'fast' = gemini flash (default, cheap), 'smart' =
// pro (deeper, slower). Per-device preference; the route whitelists the enum.
export type AssistantModelChoice = 'fast' | 'smart'
const MODEL_KEY = 'ss_assistant_model'
function loadModelPref(): AssistantModelChoice {
  if (typeof window === 'undefined') return 'fast'
  try {
    return localStorage.getItem(MODEL_KEY) === 'smart' ? 'smart' : 'fast'
  } catch {
    return 'fast'
  }
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
  // P45 — coworker mode: a server-validated guided walk to run on-screen.
  const [activeGuide, setActiveGuide] = useState<GuidedWalkPayload | null>(null)
  const [model, setModelState] = useState<AssistantModelChoice>(loadModelPref)
  const setModel = (m: AssistantModelChoice) => {
    setModelState(m)
    try {
      localStorage.setItem(MODEL_KEY, m)
    } catch {
      /* private mode — session-only */
    }
  }
  const logRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    // keep the newest message in view
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages, pendingAction, sending])

  // P45 — run the guided walk via the tour runtime (real-data mode: no
  // tutorial cookie, no demo data — startGuidedWalk guards all of that).
  // 'guided-walk-done' fires on both completion and the user closing it.
  useEffect(() => {
    if (!activeGuide) return
    let cancelled = false
    import('@/lib/help/scripted-tour')
      .then((m) => {
        if (!cancelled) m.startGuidedWalk(activeGuide)
      })
      .catch(() => setActiveGuide(null))
    const onDone = () => setActiveGuide(null)
    window.addEventListener('guided-walk-done', onDone)
    return () => {
      cancelled = true
      window.removeEventListener('guided-walk-done', onDone)
    }
  }, [activeGuide])

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
          model,
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
      // P45 — a guided walk starts immediately (server already validated the
      // steps against the anchor allowlist).
      const g = json.data?.guide as GuidedWalkPayload | null | undefined
      if (g && typeof g.title === 'string' && Array.isArray(g.steps) && g.steps.length > 0) {
        setActiveGuide(g)
      }
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
    activeGuide,
    model,
    setModel,
    send,
    runAction,
    logRef,
    textareaRef,
  }
}

export type AssistantChatState = ReturnType<typeof useAssistantChat>
