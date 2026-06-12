'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

type Category = 'bug' | 'idea' | 'praise' | 'other'

const CATEGORIES: Array<{ id: Category; label: string; emoji: string }> = [
  { id: 'bug', label: 'Bug', emoji: '🐞' },
  { id: 'idea', label: 'Idea', emoji: '💡' },
  { id: 'praise', label: 'Love it', emoji: '❤️' },
  { id: 'other', label: 'Other', emoji: '💬' },
]

// Minimal typings for the Web Speech API (not in lib.dom for all TS configs)
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

export function FeedbackWidget() {
  const isMobile = useIsMobile()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<Category>('idea')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  // Text committed before the current dictation session — interim results render after it.
  const baseTextRef = useRef('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const speechSupported = !!getSpeechRecognition()

  // Stop dictation when the panel closes/unmounts.
  useEffect(() => {
    if (!open && recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
      setListening(false)
    }
  }, [open])

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const SR = getSpeechRecognition()
    if (!SR) return
    const rec = new SR()
    rec.lang = 'en-US'
    rec.continuous = true
    rec.interimResults = true
    baseTextRef.current = message ? message.replace(/\s+$/, '') + ' ' : ''
    rec.onresult = (e) => {
      let txt = ''
      // Start from resultIndex so we don't replay already-committed transcripts.
      for (let i = e.resultIndex; i < e.results.length; i++) {
        txt += e.results[i][0].transcript
      }
      setMessage((baseTextRef.current + txt).slice(0, 2000))
    }
    rec.onend = () => {
      setListening(false)
      recognitionRef.current = null
    }
    rec.onerror = (e) => {
      setListening(false)
      recognitionRef.current = null
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast.error('Microphone access denied — check your browser settings')
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not start microphone'
      toast.error(msg)
    }
  }

  const submit = async () => {
    const text = message.trim()
    if (text.length < 2 || sending) return
    recognitionRef.current?.stop()
    setSending(true)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          message: text,
          pagePath: window.location.pathname.slice(0, 200),
        }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(typeof json.error === 'string' ? json.error : 'Could not send feedback')
        return
      }
      setSent(true)
      setTimeout(() => {
        setOpen(false)
        // reset after the close animation
        setTimeout(() => {
          setSent(false)
          setMessage('')
          setCategory('idea')
        }, 350)
      }, 1300)
    } catch {
      toast.error('Network error — feedback not sent')
    } finally {
      setSending(false)
    }
  }

  const form = sent ? (
    <div className="flex flex-col items-center justify-center gap-2 py-10 px-5 text-center">
      <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-stone-900">Thank you!</p>
      <p className="text-xs text-stone-500">We read every note — it really helps.</p>
    </div>
  ) : (
    <div className="flex flex-col gap-3 p-5">
      <p className="text-sm text-stone-600">
        Spotted a bug? Have an idea? Tell us — it goes straight to the team.
      </p>
      <div className="flex gap-1.5 flex-wrap">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategory(c.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors min-h-[36px] ${
              category === c.id
                ? 'bg-[#8B2E4A] text-white border-[#8B2E4A]'
                : 'bg-white text-stone-600 border-stone-200 hover:border-stone-300'
            }`}
          >
            {c.emoji} {c.label}
          </button>
        ))}
      </div>
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
          rows={4}
          placeholder={listening ? 'Listening… speak now' : 'Type here, or tap the mic and just talk…'}
          className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 pr-11 text-base md:text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all resize-none"
        />
        {speechSupported && (
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={listening ? 'Stop dictation' : 'Dictate feedback'}
            title={listening ? 'Stop dictation' : 'Dictate feedback'}
            className={`absolute right-2 top-2 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
              listening
                ? 'bg-red-500 text-white shadow-[0_0_0_4px_rgba(239,68,68,0.2)] animate-pulse'
                : 'bg-white border border-stone-200 text-stone-500 hover:text-[#8B2E4A] hover:border-[#C4687A]'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-stone-400">{message.length}/2000</span>
        <Button size="sm" loading={sending} disabled={message.trim().length < 2} onClick={submit}>
          Send Feedback
        </Button>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      {/* Trigger — small, semi-transparent, above the FAB/nav stack */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        title="Send feedback"
        data-tour="feedback-button"
        className="fixed z-30 w-10 h-10 rounded-full flex items-center justify-center text-white shadow-[var(--shadow-md)] opacity-45 hover:opacity-100 focus-visible:opacity-100 active:scale-95 transition-all duration-200"
        style={{
          right: '0.875rem',
          bottom: 'calc(var(--app-floating-bottom) + 64px)',
          backgroundColor: '#1C0A12',
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
        </svg>
      </button>

      {/* Panel */}
      {isMobile ? (
        <BottomSheet isOpen={open} onClose={() => setOpen(false)} title="Send Feedback">
          {form}
        </BottomSheet>
      ) : (
        open && (
          <>
            <div className="fixed inset-0 z-[85]" onClick={() => setOpen(false)} aria-hidden />
            <div
              className="fixed z-[86] w-[360px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-xl)] overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-[160ms]"
              style={{ right: '1.25rem', bottom: 'calc(var(--app-floating-bottom) + 64px)' }}
              role="dialog"
              aria-label="Send feedback"
            >
              <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-stone-100">
                <h2 className="text-sm font-semibold text-stone-900">Send Feedback</h2>
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
              {form}
            </div>
          </>
        )
      )}
    </>,
    document.body,
  )
}
