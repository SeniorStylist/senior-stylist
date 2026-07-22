'use client'

// P40 — inline "Ask AI" card for /analytics and Master Admin → Reports.
// Replaces the old single-shot AiAnalystPanel: same full assistant brain as
// the floating widget (tools + confirmed actions), rendered in place.

import { useState } from 'react'
import { useAssistantChat } from './use-assistant-chat'
import { AssistantChat, ASSISTANT_CHIPS } from './assistant-chat'

export function AssistantCard({ scope }: { scope: 'facility' | 'master' }) {
  const [openPanel, setOpenPanel] = useState(true)
  const chat = useAssistantChat()
  const chips = ASSISTANT_CHIPS[scope === 'master' ? 'master' : 'admin'] ?? []

  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpenPanel((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <div className="w-10 h-10 rounded-xl bg-[#F9EFF2] flex items-center justify-center shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
            <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-stone-900">Ask AI</p>
          <p className="text-xs text-stone-500">
            {scope === 'master'
              ? 'Questions and actions across the whole network — answered from your real data'
              : 'Questions and actions for this facility — answered from your real data'}
          </p>
        </div>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-stone-400 transition-transform ${openPanel ? '' : 'rotate-180'}`}
        >
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
      {openPanel && (
        <div className="border-t border-stone-100">
          <AssistantChat
            chat={chat}
            chips={chips}
            heightStyle={{ height: 'min(480px, 65dvh)' }}
            intro="Ask anything about your numbers, schedule, or residents — or tell me what to change. Anything that edits data asks you to confirm first."
          />
        </div>
      )}
    </div>
  )
}
