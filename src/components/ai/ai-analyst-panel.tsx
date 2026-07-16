'use client'

// P35 — "Ask AI" business analyst panel (the GlossGenius borrow). Pure UI:
// the server decides the real data scope from the caller's role; the `scope`
// prop only picks which suggested-question chips to show.

import { useRef, useState } from 'react'
import { useToast } from '@/components/ui/toast'

interface Turn {
  q: string
  a: string
}

const FACILITY_CHIPS = [
  'What was our revenue this month vs last month?',
  'Which service earns the most?',
  'Who owes us the most right now?',
  'How busy are the next two weeks?',
]

const MASTER_CHIPS = [
  'Which facility owes us the most right now?',
  'Which facility earned the most this month?',
  'How much did we collect across all facilities in the last 30 days?',
  'Which facilities have the fewest visits this month?',
]

export function AiAnalystPanel({ scope }: { scope: 'facility' | 'master' }) {
  const { toast } = useToast()
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [thinking, setThinking] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const chips = scope === 'master' ? MASTER_CHIPS : FACILITY_CHIPS

  async function ask(q: string) {
    const trimmed = q.trim()
    if (trimmed.length < 3 || thinking) return
    setThinking(true)
    setQuestion('')
    try {
      const res = await fetch('/api/ai/analyst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          history: turns.slice(-3).map((t) => ({ q: t.q, a: t.a.slice(0, 2000) })),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast(typeof json.error === 'string' ? json.error : 'The analyst is unavailable right now', 'error')
        return
      }
      setTurns((prev) => [...prev, { q: trimmed, a: json.data.answer }])
      // Scroll the newest answer into view after paint
      requestAnimationFrame(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
      })
    } catch {
      toast('Network error — try again', 'error')
    } finally {
      setThinking(false)
    }
  }

  return (
    <div
      data-tour="ai-analyst"
      className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#F9EFF2] flex items-center justify-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
              <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-stone-900">Ask AI</p>
            <p className="text-xs text-stone-500">
              Plain-English questions about {scope === 'master' ? 'every facility' : 'this facility'} — answered from your real numbers
            </p>
          </div>
        </div>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-stone-400 transition-transform ${collapsed ? '' : 'rotate-180'}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {!collapsed && (
        <div className="px-5 pb-5 space-y-3">
          {turns.length === 0 && !thinking && (
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => void ask(c)}
                  className="text-xs px-3 py-1.5 rounded-full bg-stone-50 border border-stone-200 text-stone-600 hover:bg-[#F9EFF2] hover:border-[#C4687A] hover:text-[#8B2E4A] transition-colors"
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {(turns.length > 0 || thinking) && (
            <div ref={logRef} className="max-h-80 overflow-y-auto overscroll-contain space-y-3 pr-1">
              {turns.map((t, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-end">
                    <p className="max-w-[85%] bg-[#8B2E4A] text-white text-sm rounded-2xl rounded-br-md px-3.5 py-2">
                      {t.q}
                    </p>
                  </div>
                  <div className="flex">
                    <p className="max-w-[85%] bg-stone-50 border border-stone-100 text-stone-800 text-sm rounded-2xl rounded-bl-md px-3.5 py-2 whitespace-pre-wrap leading-relaxed">
                      {t.a}
                    </p>
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex items-center gap-2 text-xs text-stone-400 px-1">
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-stone-200 border-t-[#8B2E4A] animate-spin" />
                  Crunching your numbers…
                </div>
              )}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void ask(question)
            }}
            className="flex gap-2"
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={scope === 'master' ? 'e.g. Which facility grew the most?' : 'e.g. What was our best service last month?'}
              maxLength={500}
              className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
            />
            <button
              type="submit"
              disabled={thinking || question.trim().length < 3}
              className="shrink-0 min-h-[42px] px-4 rounded-xl bg-[#8B2E4A] text-white text-sm font-semibold hover:bg-[#72253C] transition-colors disabled:opacity-40"
            >
              Ask
            </button>
          </form>
          <p className="text-[10.5px] text-stone-400">
            Answers are computed from completed visits and current billing data. Double-check anything important on its own page.
          </p>
        </div>
      )}
    </div>
  )
}
