'use client'

// P40 — the shared chat UI (log + confirm card + composer), rendered by both
// the floating AssistantWidget and the inline AssistantCard. All behavior
// lives in useAssistantChat; this is presentation only.

import type { ReactNode } from 'react'
import type { AssistantChatState } from './use-assistant-chat'
import { segmentMessage } from '@/lib/ai-assistant/app-links'

export const ASSISTANT_CHIPS: Record<string, string[]> = {
  admin: ["What's on the schedule today?", 'Who owes us the most right now?', "Mark this morning's visits as paid", 'Put Mrs. Smith in the next open slot'],
  facility_staff: ["What's on the schedule today?", 'Book an appointment for a resident', 'Add someone to the waitlist'],
  bookkeeper: ['Who owes us the most right now?', 'How much did we collect this month?', "Show me this period's payroll"],
  stylist: ["What's my day look like tomorrow?", 'How much have I made this month?', 'Put a resident in my next open slot'],
  master: ['Which facility owes us the most?', 'Switch me to another facility', 'How do I scan a log sheet?', 'Any new feedback?'],
}

// P42 — created documents (signs, statements) arrive as same-origin relative
// paths; render ONLY allowlisted app paths as tappable links (app-links.ts).
function renderModelText(text: string) {
  const segments = segmentMessage(text)
  if (segments.length === 1 && segments[0].type === 'text') return text
  return segments.map((s, i) =>
    s.type === 'link' ? (
      <a
        key={i}
        href={s.value}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 my-0.5 px-2.5 py-1 rounded-full bg-[#F9EFF2] border border-[#E8CDD5] text-[#8B2E4A] text-xs font-semibold no-underline hover:bg-[#F2E0E6] transition-colors"
      >
        {s.value.startsWith('/signage') ? 'Open your sign' : 'Open printable document'} →
      </a>
    ) : (
      <span key={i}>{s.value}</span>
    ),
  )
}

export function AssistantChat({
  chat,
  chips,
  heightStyle,
  placeholder = 'Ask, or say what to do…',
  intro = 'Ask about your day, residents, or numbers — or tell me what to change. Anything that edits data asks you to confirm first.',
  composerAccessory = null,
}: {
  chat: AssistantChatState
  chips: string[]
  heightStyle: React.CSSProperties
  placeholder?: string
  intro?: string
  composerAccessory?: ReactNode
}) {
  const {
    messages, input, setInput, sending, pendingAction, setPendingAction,
    confirming, expired, model, setModel, statusLabel, send, runAction, logRef, textareaRef,
  } = chat

  return (
    <div className="flex flex-col" style={heightStyle}>
      {/* Chat log */}
      <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-2.5">
        {messages.length === 0 && (
          <div className="pt-2">
            <p className="text-sm text-stone-600 mb-3">{intro}</p>
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
              {m.role === 'model' ? renderModelText(m.text) : m.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-stone-50 border border-stone-100 text-stone-400 px-3.5 py-2 text-sm inline-flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-stone-200 border-t-[#8B2E4A] animate-spin" />
              {/* P46 — live status line streamed from the server, never a bare spinner */}
              <span aria-live="polite">{statusLabel ?? 'Thinking…'}</span>
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
              {/* P41 — cross-facility actions say WHERE they land */}
              {pendingAction.facility && pendingAction.kind !== 'switch_facility' && (
                <li className="text-xs font-semibold text-[#8B2E4A]">At {pendingAction.facility.name}</li>
              )}
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
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 600))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={2}
            placeholder={placeholder}
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 pr-20 text-base md:text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all resize-none"
          />
          <div className="absolute right-2 top-2 flex items-center gap-1.5">
            {composerAccessory}
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
        <div className="mt-1.5 flex items-center gap-2">
          {/* P42 — Quick/Smart model pill (per-device, ss_assistant_model) */}
          <div
            className="shrink-0 inline-flex rounded-full border border-stone-200 bg-stone-50 p-0.5"
            role="group"
            aria-label="Assistant mode"
            title="Quick — fast & cheap · Smart — deeper thinking (a bit slower)"
          >
            {(['fast', 'smart'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModel(m)}
                aria-pressed={model === m}
                className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold transition-colors ${
                  model === m ? 'bg-[#8B2E4A] text-white' : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                {m === 'fast' ? 'Quick' : '✦ Smart'}
              </button>
            ))}
          </div>
          <p className="text-[10.5px] text-stone-400 truncate">
            Answers come from your real data. Actions always ask to confirm.
          </p>
        </div>
      </div>
    </div>
  )
}
