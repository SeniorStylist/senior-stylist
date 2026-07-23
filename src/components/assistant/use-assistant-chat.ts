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
import { isAnswerCard, MAX_CARDS_PER_TURN, type AnswerCard } from '@/lib/ai-assistant/answer-cards'

export interface ChatMsg {
  role: 'user' | 'model'
  text: string
  /** P47 — tool-built answer cards rendered under the bubble. */
  cards?: AnswerCard[]
}

/** P47 — validate an untrusted cards value (done payload / restored blob). */
function sanitizeCards(v: unknown): AnswerCard[] | undefined {
  if (!Array.isArray(v)) return undefined
  const cards = v.filter(isAnswerCard).slice(0, MAX_CARDS_PER_TURN)
  return cards.length > 0 ? cards : undefined
}

// P46 — conversation persistence: the thread survives reloads (incl. our own
// switch_facility hard reload). Device-local like the read cache — cleared on
// sign-out via clearAssistantChat() (chats can contain resident names).
const CHAT_KEY = 'ss_assistant_chat'
const CHAT_MAX = 30
function loadSavedChat(): ChatMsg[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((m): m is ChatMsg => !!m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string')
      .map((m) => ({ role: m.role, text: m.text, cards: sanitizeCards(m.cards) }))
      .slice(-CHAT_MAX)
  } catch {
    return []
  }
}
/** Called from the sign-out teardown (offline-session) — never leave a chat
 * with resident names behind on a shared device. */
export function clearAssistantChat(): void {
  try {
    localStorage.removeItem(CHAT_KEY)
  } catch {
    /* best-effort */
  }
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
  const [messages, setMessages] = useState<ChatMsg[]>(loadSavedChat)
  // P46 — a failed turn renders an inline Retry bubble instead of toast-only.
  const [lastError, setLastError] = useState<{ text: string; message: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [confirming, setConfirming] = useState(false)
  // P45 — coworker mode: a server-validated guided walk to run on-screen.
  const [activeGuide, setActiveGuide] = useState<GuidedWalkPayload | null>(null)
  // P46 — live status line streamed from the server while a turn runs.
  const [statusLabel, setStatusLabel] = useState<string | null>(null)
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

  // P46 — persist the thread (capped) so reloads/facility switches keep it.
  useEffect(() => {
    try {
      if (messages.length === 0) localStorage.removeItem(CHAT_KEY)
      else localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-CHAT_MAX)))
    } catch {
      /* private mode / quota — session-only */
    }
  }, [messages])

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
    setStatusLabel(null)
    setPendingAction(null)
    setLastError(null)
    const controller = new AbortController()
    abortRef.current = controller
    const nextMessages: ChatMsg[] = [...messages, { role: 'user', text }]
    setMessages(nextMessages)
    setInput('')
    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: text,
          history: messages.slice(-8).map((m) => ({ role: m.role, text: m.text.slice(0, 1500) })),
          model,
          // P46 — page context ("this page" awareness + smarter routing)
          page: typeof window !== 'undefined' ? window.location.pathname.slice(0, 100) : undefined,
        }),
      })
      if (!res.ok || !res.body) {
        // Pre-stream failures (auth/rate-limit/validation) stay plain JSON.
        const json = await res.json().catch(() => ({}))
        setMessages(messages)
        setInput(text)
        setLastError({ text, message: typeof json.error === 'string' ? json.error : "The assistant couldn't respond." })
        return
      }

      // P46 — NDJSON stream: {type:'status',label} lines while the assistant
      // works (rendered live in the thinking bubble), then one terminal
      // {type:'done',data} or {type:'error',error} line.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      interface DoneData {
        answer?: unknown
        pendingAction?: PendingAction | null
        guide?: GuidedWalkPayload | null
        cards?: unknown
      }
      const out: { finalData: DoneData | null; streamError: string | null } = { finalData: null, streamError: null }
      const handleLine = (line: string) => {
        if (!line) return
        try {
          const evt = JSON.parse(line) as { type?: string; label?: string; data?: DoneData; error?: string }
          if (evt.type === 'status' && typeof evt.label === 'string') setStatusLabel(evt.label)
          else if (evt.type === 'done') out.finalData = evt.data ?? null
          else if (evt.type === 'error') out.streamError = typeof evt.error === 'string' ? evt.error : 'error'
        } catch {
          /* partial line — ignore */
        }
      }
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          handleLine(buffer.slice(0, nl).trim())
          buffer = buffer.slice(nl + 1)
        }
      }
      handleLine(buffer.trim())

      const fd = out.finalData
      if (out.streamError || !fd) {
        setMessages(messages)
        setInput(text)
        setLastError({ text, message: out.streamError ?? "The assistant couldn't respond." })
        return
      }
      const answer = typeof fd.answer === 'string' ? fd.answer : '…'
      setMessages([...nextMessages, { role: 'model', text: answer, cards: sanitizeCards(fd.cards) }])
      const pa = fd.pendingAction
      if (pa && actionAllowed(pa)) setPendingAction(pa)
      // P45 — a guided walk starts immediately (server already validated the
      // steps against the anchor allowlist).
      const g = fd.guide
      if (g && typeof g.title === 'string' && Array.isArray(g.steps) && g.steps.length > 0) {
        setActiveGuide(g)
      }
    } catch (e) {
      setMessages(messages)
      setInput(text)
      if (e instanceof DOMException && e.name === 'AbortError') {
        // User pressed Stop — quiet restore, no error bubble.
      } else {
        setLastError({ text, message: 'Network error.' })
      }
    } finally {
      abortRef.current = null
      setSending(false)
      setStatusLabel(null)
    }
  }

  /** P46 — cancel the in-flight turn (Stop button). */
  const stop = () => {
    abortRef.current?.abort()
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
      // P46 — cancels get one-tap Undo (the daily-log booking-cancel pattern:
      // PUT the status back to scheduled).
      if (a.kind === 'cancel') {
        const bookingPath = a.request.path
        toast.success('Cancelled', {
          action: {
            label: 'Undo',
            onClick: () => {
              void fetch(bookingPath, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'scheduled' }),
              }).then((r) => {
                if (r.ok) {
                  toast.success('Appointment restored')
                  setMessages((prev) => [...prev, { role: 'model', text: '[done] Undone — the appointment is back on the schedule.' }])
                } else {
                  toast.error("Couldn't restore it — rebook from the calendar.")
                }
              }).catch(() => toast.error("Couldn't restore it — rebook from the calendar."))
            },
          },
        })
      } else {
        toast.success(`${doneLabel}!`)
      }
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
    statusLabel,
    lastError,
    model,
    setModel,
    send,
    stop,
    runAction,
    logRef,
    textareaRef,
  }
}

export type AssistantChatState = ReturnType<typeof useAssistantChat>
