'use client'

// P38 — floating AI personal assistant (every role). Text + voice in, chat out;
// proposed actions render as a confirm card and are executed BY THIS CLIENT
// against the existing REST endpoints (user's own session — all server guards
// run exactly as the normal UI). The widget validates each proposal against a
// hard method/path/body allowlist before fetching (defense-in-depth; the
// server builds bodies only from resolved entities).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { useToast } from '@/components/ui/toast'

interface PendingAction {
  kind: 'book' | 'cancel' | 'reschedule'
  summary: { title: string; lines: string[] }
  request: { method: 'POST' | 'PUT' | 'DELETE'; path: string; body: Record<string, unknown> | null }
  expiresAt: string
}

interface ChatMsg {
  role: 'user' | 'model'
  text: string
}

// ---- pendingAction client allowlist (never execute anything outside it) ----
const PATH_RE = /^\/api\/bookings(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i
const ALLOWED_BODY_KEYS: Record<PendingAction['kind'], string[]> = {
  book: ['residentId', 'serviceId', 'startTime', 'stylistId', 'notes'],
  cancel: [],
  reschedule: ['startTime'],
}
function actionAllowed(a: PendingAction): boolean {
  if (!['POST', 'PUT', 'DELETE'].includes(a.request.method)) return false
  if (!PATH_RE.test(a.request.path)) return false
  const keys = Object.keys(a.request.body ?? {})
  const allowed = ALLOWED_BODY_KEYS[a.kind] ?? []
  return keys.every((k) => allowed.includes(k))
}

// ---- Web Speech API (same minimal typings + iOS pattern as feedback-widget) ----
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((e: SpeechRecognitionErrorLike) => void) | null
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}
interface SpeechRecognitionErrorLike {
  error: string
  message?: string
}
function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const CHIPS: Record<string, string[]> = {
  admin: ["What's on the schedule today?", 'Who owes us the most right now?', "How's revenue this month?"],
  facility_staff: ["What's on the schedule today?", 'Book an appointment for a resident', "Who's coming tomorrow?"],
  bookkeeper: ['Who owes us the most right now?', 'How much did we collect this month?', "What's on the schedule today?"],
  stylist: ["What's my day look like tomorrow?", 'How much have I made this month?', 'Book an appointment'],
  master: ['Which facility owes us the most?', "How's the network doing this month?", 'Numbers for F177'],
}

export function AssistantWidget({ role, isMaster }: { role: string; isMaster?: boolean }) {
  const isMobile = useIsMobile()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [listening, setListening] = useState(false)
  const [micDenied, setMicDenied] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const baseTextRef = useRef('')
  const finalTextRef = useRef('')
  const logRef = useRef<HTMLDivElement | null>(null)
  const speechSupported = !!getSpeechRecognition()
  const chips = CHIPS[isMaster ? 'master' : role] ?? CHIPS.admin

  useEffect(() => {
    if (!open && recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
      setListening(false)
    }
  }, [open])

  useEffect(() => {
    // keep the newest message in view
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages, pendingAction, sending])

  const toggleVoice = async () => {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const SR = getSpeechRecognition()
    if (!SR) return
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((t) => t.stop())
        setMicDenied(false)
      } catch {
        setMicDenied(true)
        toast.error('Microphone access denied')
        return
      }
    }
    const rec = new SR()
    rec.lang = 'en-US'
    rec.continuous = true
    rec.interimResults = true
    baseTextRef.current = input ? input.replace(/\s+$/, '') + ' ' : ''
    finalTextRef.current = ''
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalTextRef.current += r[0].transcript.replace(/\s+$/, '') + ' '
        else interim += r[0].transcript
      }
      setInput((baseTextRef.current + finalTextRef.current + interim).slice(0, 600))
    }
    rec.onend = () => {
      setListening(false)
      recognitionRef.current = null
    }
    rec.onerror = (e) => {
      setListening(false)
      recognitionRef.current = null
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setMicDenied(true)
        toast.error('Microphone access denied')
      } else if (e.error === 'audio-capture') {
        toast.error('No microphone found')
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        toast.error(`Voice input error: ${e.error}`)
      }
    }
    try {
      rec.start()
      recognitionRef.current = rec
      setListening(true)
    } catch {
      toast.error('Could not start microphone')
    }
  }

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim()
    if (!text || sending) return
    recognitionRef.current?.stop()
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
        const msg = typeof json.error === 'string' ? json.error : 'That didn\'t go through.'
        setMessages((prev) => [...prev, { role: 'model', text: `That didn't work: ${msg}` }])
        setPendingAction(null)
        return
      }
      const doneLabel =
        a.kind === 'book' ? 'Booked' : a.kind === 'cancel' ? 'Cancelled' : 'Moved'
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

  const panel = (
    <div className="flex flex-col" style={{ height: isMobile ? '70dvh' : '480px' }}>
      {/* Chat log */}
      <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-2.5">
        {messages.length === 0 && (
          <div className="pt-2">
            <p className="text-sm text-stone-600 mb-3">
              Ask me anything about your day, residents, or numbers — or tell me to book an appointment. You can type or tap the mic and talk.
            </p>
            <div className="flex flex-col items-start gap-1.5">
              {chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => void send(c)}
                  className="text-left text-xs font-medium text-[#8B2E4A] bg-[#F9EFF2] border border-[#E8CDD5] rounded-full px-3 py-1.5 hover:bg-[#F2E0E6] transition-colors"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[85%] rounded-2xl rounded-br-md bg-[#8B2E4A] text-white px-3.5 py-2 text-sm whitespace-pre-wrap'
                  : 'max-w-[85%] rounded-2xl rounded-bl-md bg-stone-50 border border-stone-100 text-stone-800 px-3.5 py-2 text-sm whitespace-pre-wrap'
              }
            >
              {m.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-stone-50 border border-stone-100 text-stone-400 px-3.5 py-2 text-sm inline-flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-stone-200 border-t-[#8B2E4A] animate-spin" />
              Thinking…
            </div>
          </div>
        )}
        {/* Confirm card */}
        {pendingAction && (
          <div className="rounded-2xl border border-[#D4A0B0] bg-[#F9EFF2] p-3.5">
            <p className="text-sm font-semibold text-stone-900 mb-1.5">{pendingAction.summary.title}</p>
            <ul className="space-y-0.5 mb-3">
              {pendingAction.summary.lines.map((l, i) => (
                <li key={i} className="text-sm text-stone-700">{l}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void runAction()}
                disabled={confirming || expired}
                className="flex-1 min-h-[44px] text-sm font-semibold bg-[#8B2E4A] text-white rounded-xl hover:bg-[#72253C] disabled:opacity-50 transition-colors"
              >
                {confirming ? 'Working…' : expired ? 'Expired — ask again' : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                disabled={confirming}
                className="flex-1 min-h-[44px] text-sm font-semibold text-stone-600 border border-stone-200 bg-white rounded-xl hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-stone-100 p-3">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 600))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={2}
            placeholder={listening ? 'Listening… speak now' : 'Ask, or say what to book…'}
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 pr-20 text-base md:text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all resize-none"
          />
          <div className="absolute right-2 top-2 flex items-center gap-1.5">
            {speechSupported && (
              <button
                type="button"
                onClick={() => void toggleVoice()}
                aria-label={micDenied ? 'Retry microphone' : listening ? 'Stop dictation' : 'Dictate'}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                  micDenied
                    ? 'bg-amber-50 border border-amber-200 text-amber-600'
                    : listening
                      ? 'bg-red-500 text-white shadow-[0_0_0_4px_rgba(239,68,68,0.2)] animate-pulse'
                      : 'bg-white border border-stone-200 text-stone-500 hover:text-[#8B2E4A] hover:border-[#C4687A]'
                }`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                  <path d="M19 10v2a7 7 0 01-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || input.trim().length === 0}
              aria-label="Send"
              className="w-8 h-8 rounded-full bg-[#8B2E4A] text-white flex items-center justify-center disabled:opacity-40 hover:bg-[#72253C] transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-[10.5px] text-stone-400">
          Answers come from your real data. Actions always ask you to confirm first.
        </p>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      {/* Trigger — stacked 12px above the feedback bubble */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="AI assistant"
        title="AI assistant"
        data-tour="assistant-button"
        className="fixed z-30 w-10 h-10 rounded-full flex items-center justify-center text-white shadow-[var(--shadow-md)] opacity-45 hover:opacity-100 focus-visible:opacity-100 active:scale-95 transition-all duration-200"
        style={{
          right: '0.875rem',
          bottom: 'calc(var(--app-floating-bottom) + 116px)',
          backgroundColor: '#8B2E4A',
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
          <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
        </svg>
      </button>

      {isMobile ? (
        <BottomSheet isOpen={open} onClose={() => setOpen(false)} title="Assistant">
          {panel}
        </BottomSheet>
      ) : (
        open && (
          <>
            <div className="fixed inset-0 z-[85]" onClick={() => setOpen(false)} aria-hidden />
            <div
              className="fixed z-[86] w-[400px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-xl)] overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-[160ms]"
              style={{ right: '1.25rem', bottom: 'calc(var(--app-floating-bottom) + 64px)' }}
              role="dialog"
              aria-label="AI assistant"
            >
              <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-100">
                <h2 className="text-sm font-semibold text-stone-900 inline-flex items-center gap-1.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
                  </svg>
                  Assistant
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-stone-400 hover:text-stone-600 transition-colors p-1"
                  aria-label="Close"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {panel}
            </div>
          </>
        )
      )}
    </>,
    document.body,
  )
}
