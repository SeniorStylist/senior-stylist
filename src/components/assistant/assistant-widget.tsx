'use client'

// P38/P40 — floating AI personal assistant (every role). The chat brain lives
// in useAssistantChat (shared with the inline Analytics/Master-Admin card);
// this shell owns the floating trigger, the sheet/popover chrome, and voice
// dictation. Confirmed actions execute from the CLIENT against existing REST
// endpoints behind the shared ACTION_RULES allowlist.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { isNativeApp } from '@/lib/detect-device'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { useToast } from '@/components/ui/toast'
import { useAssistantChat } from './use-assistant-chat'
import { AssistantChat, ASSISTANT_CHIPS } from './assistant-chat'

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

export function AssistantWidget({ role, isMaster }: { role: string; isMaster?: boolean }) {
  const isMobile = useIsMobile()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const chat = useAssistantChat()
  const { input, setInput, textareaRef } = chat

  const [listening, setListening] = useState(false)
  const [micDenied, setMicDenied] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const baseTextRef = useRef('')
  const finalTextRef = useRef('')
  // P38d — 'audio-capture' auto-retry (the priming stream sometimes hasn't
  // released the mic yet when recognition starts, esp. iOS).
  const captureRetriedRef = useRef(false)
  // P38d — inside the Capacitor shell (WKWebView) webkitSpeechRecognition is
  // defined but non-functional ('audio-capture'). The iOS/Android KEYBOARD mic
  // works everywhere, so there the button routes to keyboard dictation.
  const speechSupported = !!getSpeechRecognition() || isNativeApp()

  const chips = ASSISTANT_CHIPS[isMaster ? 'master' : role] ?? ASSISTANT_CHIPS.admin

  // Focus the composer and point the user at the keyboard's own mic key —
  // the always-works dictation path on phones.
  const keyboardDictationFallback = () => {
    textareaRef.current?.focus()
    toast.info('Tap the mic key on your keyboard to talk — it types right in here.')
  }

  useEffect(() => {
    if (!open && recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
      setListening(false)
    }
  }, [open])

  const startRecognition = () => {
    const SR = getSpeechRecognition()
    if (!SR) {
      keyboardDictationFallback()
      return
    }
    const rec = new SR()
    rec.lang = 'en-US'
    rec.continuous = true
    rec.interimResults = true
    baseTextRef.current = input ? input.replace(/\s+$/, '') + ' ' : ''
    finalTextRef.current = ''
    rec.onresult = (e) => {
      captureRetriedRef.current = false // audio is flowing — reset the retry
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
        // P38d — usually NOT a missing mic: either the permission-priming
        // stream hasn't released it yet (retry once) or this engine can't
        // capture in this shell at all (→ keyboard dictation).
        if (!captureRetriedRef.current) {
          captureRetriedRef.current = true
          setTimeout(() => {
            if (!recognitionRef.current) startRecognition()
          }, 400)
        } else {
          captureRetriedRef.current = false
          keyboardDictationFallback()
        }
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        toast.error(`Voice input error: ${e.error}`)
      }
    }
    try {
      rec.start()
      recognitionRef.current = rec
      setListening(true)
    } catch {
      keyboardDictationFallback()
    }
  }

  const toggleVoice = async () => {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    // Capacitor shell: WKWebView's SpeechRecognition can't capture audio —
    // route straight to the keyboard mic (works natively on iOS + Android).
    if (isNativeApp()) {
      keyboardDictationFallback()
      return
    }
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
    captureRetriedRef.current = false
    startRecognition()
  }

  const micButton = speechSupported ? (
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
  ) : null

  const panel = (
    <AssistantChat
      chat={chat}
      chips={chips}
      heightStyle={{ height: isMobile ? '70dvh' : '480px' }}
      placeholder={listening ? 'Listening… speak now' : 'Ask, or say what to do…'}
      composerAccessory={micButton}
    />
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
